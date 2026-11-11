-- ==============================================================================
-- 06-add-session-time-slots.sql
--
-- Predefined session time slots for the weekly schedule's "Schedule new
-- session" dialog. A slot is only a start time and an end time; the Admins
-- create and edit them in Settings -> Registers -> "Session time slots".
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 06-add-session-time-slots.sql
--
-- Safe to re-run: every statement checks for what already exists.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.study_session_time_slot (
    study_session_time_slot_id integer NOT NULL,
    study_session_time_slot_start_time time without time zone NOT NULL,
    study_session_time_slot_end_time time without time zone NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS public.study_session_time_slot_study_session_time_slot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.study_session_time_slot_study_session_time_slot_id_seq
    OWNED BY public.study_session_time_slot.study_session_time_slot_id;

ALTER TABLE ONLY public.study_session_time_slot
    ALTER COLUMN study_session_time_slot_id
    SET DEFAULT nextval('public.study_session_time_slot_study_session_time_slot_id_seq'::regclass);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'study_session_time_slot_pkey'
  ) THEN
    ALTER TABLE ONLY public.study_session_time_slot
      ADD CONSTRAINT study_session_time_slot_pkey
      PRIMARY KEY (study_session_time_slot_id);
  END IF;
END
$$;

-- Grant to the application role when it exists (the LAN server creates it in
-- 01-init-enote.sql; a local development database often only has postgres).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON public.study_session_time_slot TO enote_app;
    GRANT ALL ON SEQUENCE public.study_session_time_slot_study_session_time_slot_id_seq TO enote_app;
  END IF;
END
$$;
