-- One birth date, kept in one place.
--
-- person.person_birthdate is the source; student_detail.student_birth_date is the
-- copy the student file carries. Until now only a change to the detail row was
-- copied (trigger sync_student_birthdate), so correcting the identity left the
-- detail row stale and the two could disagree — the record screen and the
-- student list would then show different birthdays for the same person.
--
-- Two triggers now keep them equal, in both directions, each with a DISTINCT
-- guard so the pair cannot ping-pong: whichever side is written first wins and
-- the other follows in the same statement. The forms edit the person's date
-- (Identity), and the detail row is the mirror.
--
-- Existing rows are reconciled first so nothing is lost: a missing person date
-- is taken from the detail row, and then every detail row follows the person.
--
-- Idempotent: re-running replaces the functions and the trigger, and the
-- reconciliation is a no-op once the two sides agree.

-- 1. Reconcile what is already stored ----------------------------------------

UPDATE public.person p
   SET person_birthdate = sd.student_birth_date
  FROM public.student_detail sd
 WHERE sd.person_id = p.person_id
   AND p.person_birthdate IS NULL
   AND sd.student_birth_date IS NOT NULL;

UPDATE public.student_detail sd
   SET student_birth_date = p.person_birthdate
  FROM public.person p
 WHERE p.person_id = sd.person_id
   AND sd.student_birth_date IS DISTINCT FROM p.person_birthdate;

-- 2. detail -> person --------------------------------------------------------
-- The guard asks whether the person already holds this date; when it does, the
-- update is skipped, which is what ends the chain started by the trigger below.

CREATE OR REPLACE FUNCTION public.sync_student_birthdate_func() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.student_birth_date IS NOT NULL
     AND NEW.student_birth_date IS DISTINCT FROM OLD.student_birth_date
     AND (SELECT person_birthdate FROM person WHERE person_id = NEW.person_id)
         IS DISTINCT FROM NEW.student_birth_date THEN
    UPDATE person SET person_birthdate = NEW.student_birth_date
     WHERE person_id = NEW.person_id;
  END IF;
  RETURN NULL;
END;
$$;

-- 3. person -> detail --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sync_person_birthdate_to_student_func() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE student_detail
     SET student_birth_date = NEW.person_birthdate
   WHERE person_id = NEW.person_id
     AND student_birth_date IS DISTINCT FROM NEW.person_birthdate;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_person_birthdate_to_student ON public.person;

CREATE TRIGGER sync_person_birthdate_to_student
    AFTER UPDATE OF person_birthdate ON public.person
    FOR EACH ROW EXECUTE FUNCTION public.sync_person_birthdate_to_student_func();
