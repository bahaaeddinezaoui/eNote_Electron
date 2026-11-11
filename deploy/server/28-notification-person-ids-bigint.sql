-- Person ids are BIGINT (person.person_id), and the interface imports people
-- whose ids come from another system, so an id can be far larger than an int4
-- (student111 carries 123456789012). Four database functions still assumed a
-- 32-bit id. Because they run as triggers on every send, a user with such an id
-- could not send at all: the transaction died with PostgreSQL error 22003,
-- "integer out of range", surfaced in the client as
-- "error invoking remote method 'messaging:send': integer out of range".
--
-- Every function keeps its signature and behaviour; only the local variables and
-- the one cast that carried a person id into an int4 widen to bigint. Safe to
-- re-run.

SET client_encoding = 'UTF8';

-- Direct messages: the trigger ran on direct_message, so the failure blocked the
-- message itself, not just its notification.
CREATE OR REPLACE FUNCTION public.app_notify_person_message(
  p_type character varying,
  p_record_key character varying,
  p_record_type character varying,
  p_actor_person_id bigint,
  p_audience_person_id bigint,
  p_title character varying,
  p_body text,
  p_detail jsonb
)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF p_audience_person_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM app_notification_upsert_person(
    p_type, p_record_key, p_record_type,
    NULL, -- no role: this row belongs to one person
    p_actor_person_id, NULL, NULL, -- the actor id stays bigint: person ids need not fit an int4
    p_title, p_body, p_detail,
    p_audience_person_id
  );
END $function$;

CREATE OR REPLACE FUNCTION public.trg_notify_direct_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_recipient_user int;
  v_recipient_person bigint;
  v_actor_person bigint;
  v_sender text;
BEGIN
  SELECT CASE WHEN c.user_low_id = NEW.sender_user_id THEN c.user_high_id ELSE c.user_low_id END
    INTO v_recipient_user
    FROM direct_conversation c
   WHERE c.conversation_id = NEW.conversation_id;

  IF v_recipient_user IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.person_id INTO v_recipient_person FROM "user" u WHERE u.user_id = v_recipient_user;
  IF v_recipient_person IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.person_id,
         COALESCE(NULLIF(btrim(concat_ws(' ', COALESCE(p.person_first_name_la, p.person_first_name_ar), COALESCE(p.person_last_name_la, p.person_last_name_ar))), ''), u.user_username)
    INTO v_actor_person, v_sender
    FROM "user" u
    LEFT JOIN person p ON p.person_id = u.person_id
   WHERE u.user_id = NEW.sender_user_id;

  PERFORM app_notify_person_message(
    'DIRECT_MESSAGE',
    'DIRECT:' || NEW.conversation_id || ':' || NEW.direct_message_id,
    'DIRECT_MESSAGE',
    v_actor_person,
    v_recipient_person,
    COALESCE(v_sender, 'Direct message'),
    NULL, -- the message body is encrypted; never copy it here
    jsonb_build_object(
      'sender', v_sender,
      'senderUserId', NEW.sender_user_id,
      'conversationId', NEW.conversation_id,
      'messageId', NEW.direct_message_id
    )
  );

  RETURN NEW;
END $function$;

-- Inbox messages: the same narrowing, on message_recipient.
CREATE OR REPLACE FUNCTION public.trg_notify_inbox_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_person bigint;
  v_actor_person bigint;
  v_sender text;
  v_subject varchar(140);
  v_excerpt text;
BEGIN
  SELECT u.person_id INTO v_person FROM "user" u WHERE u.user_id = NEW.user_id;
  IF v_person IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT left(COALESCE(m.message_subject, ''), 140),
         left(NULLIF(btrim(COALESCE(m.message_body, '')), ''), 160),
         u.person_id,
         COALESCE(NULLIF(btrim(concat_ws(' ', COALESCE(p.person_first_name_la, p.person_first_name_ar), COALESCE(p.person_last_name_la, p.person_last_name_ar))), ''), u.user_username)
    INTO v_subject, v_excerpt, v_actor_person, v_sender
    FROM message m
    JOIN "user" u ON u.user_id = m.sender_user_id
    LEFT JOIN person p ON p.person_id = u.person_id
   WHERE m.message_id = NEW.message_id;

  PERFORM app_notify_person_message(
    'INBOX_MESSAGE',
    'INBOX:' || NEW.message_id || ':' || NEW.user_id,
    'INBOX_MESSAGE',
    v_actor_person,
    v_person,
    COALESCE(NULLIF(v_subject, ''), COALESCE(v_sender, 'Inbox')),
    v_excerpt,
    jsonb_build_object(
      'sender', v_sender,
      'senderUserId', (SELECT sender_user_id FROM message WHERE message_id = NEW.message_id),
      'messageId', NEW.message_id,
      'subject', v_subject,
      'excerpt', v_excerpt
    )
  );

  RETURN NEW;
END $function$;

-- Bug report status changes.
CREATE OR REPLACE FUNCTION public.trg_notify_bug_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_person bigint;
BEGIN
  IF NEW.report_status IS NOT DISTINCT FROM OLD.report_status THEN RETURN NEW; END IF;

  SELECT person_id INTO v_person FROM "user" WHERE user_id = NEW.user_id;
  IF v_person IS NULL THEN RETURN NEW; END IF;

  PERFORM app_notification_upsert_person(
    'BUG_STATUS',
    'BUG:' || NEW.report_id || ':' || COALESCE(NEW.report_status, 'open'),
    'BUG_STATUS', NULL,
    NULL, NULL, NULL,
    'Bug report ' || COALESCE(NEW.report_status, 'updated'),
    concat_ws(' · ', NEW.report_subject, NULLIF(btrim(COALESCE(NEW.resolution_note, '')), '')),
    jsonb_build_object(
      'subject', NEW.report_subject,
      'status', NEW.report_status,
      'priority', NEW.report_priority,
      'reportId', NEW.report_id,
      'note', NEW.resolution_note,
      'date', to_char(NEW.updated_at, 'YYYY-MM-DD')
    ),
    v_person
  );

  RETURN NEW;
END $function$;

-- Exam seating: the seat-conflict check read a person id into an int4, so saving
-- a seat for such a student failed as well. The room id stays int (classroom_id).
CREATE OR REPLACE FUNCTION public.check_exam_seat_room_unique_func()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  new_room int;
  other_person bigint;
BEGIN
  IF NEW.seat_number IS NULL OR NEW.examination_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT classroom_id INTO new_room
  FROM examination_group WHERE examination_group_id = NEW.examination_group_id;

  IF new_room IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT phe.person_id INTO other_person
  FROM person_has_examination phe
  JOIN examination_group eg ON eg.examination_group_id = phe.examination_group_id
  WHERE phe.examination_id = NEW.examination_id
    AND phe.seat_number = NEW.seat_number
    AND eg.classroom_id = new_room
    AND (phe.person_id <> NEW.person_id OR phe.examination_id <> NEW.examination_id
         OR phe.examination_group_id IS DISTINCT FROM NEW.examination_group_id)
  LIMIT 1;

  IF other_person IS NOT NULL THEN
    RAISE EXCEPTION 'Seat conflict: seat % in that classroom is already taken by another student of this exam.', NEW.seat_number;
  END IF;

  RETURN NEW;
END $function$;
