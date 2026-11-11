-- ==============================================================================
-- 32-user-sessions.sql
--
-- One row per signed-in application window: when it started, the device it
-- runs on, when it was last seen and — if it was ended — who ended it and why.
--
-- The desktop client keeps its session id from sign-in and sends a heartbeat
-- while the window is open. Ending a session closes it for good; the next
-- heartbeat of that window signs it out. Every account may read and end its own
-- sessions. An Admin may read and end every session, without exclusions. The
-- Developer role gets the same reach only while the administrator turns on
-- `developer_session_management` in Settings.
--
-- The application also creates this table on first use, so this migration is
-- for installations that prefer to prepare the schema ahead of time.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 32-user-sessions.sql
--
-- Safe to re-run: the table, constraints and indexes are guarded.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.user_session (
    user_session_id bigserial NOT NULL,
    user_id integer NOT NULL,
    started_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at timestamp with time zone,
    ended_by_user_id integer,
    end_reason character varying(40),
    device_name character varying(160),
    device_platform character varying(80),
    app_version character varying(40)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_session_pkey'
       AND conrelid = 'public.user_session'::regclass
  ) THEN
    ALTER TABLE ONLY public.user_session
      ADD CONSTRAINT user_session_pkey PRIMARY KEY (user_session_id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_session_user_id_fkey'
       AND conrelid = 'public.user_session'::regclass
  ) THEN
    ALTER TABLE ONLY public.user_session
      ADD CONSTRAINT user_session_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public."user" (user_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_session_ended_by_user_id_fkey'
       AND conrelid = 'public.user_session'::regclass
  ) THEN
    ALTER TABLE ONLY public.user_session
      ADD CONSTRAINT user_session_ended_by_user_id_fkey
      FOREIGN KEY (ended_by_user_id) REFERENCES public."user" (user_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS user_session_user_idx
    ON public.user_session (user_id, ended_at, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS user_session_open_idx
    ON public.user_session (ended_at, last_seen_at DESC);

COMMENT ON TABLE public.user_session IS
  'Signed-in application windows: one row per sign-in, ended explicitly or left to expire.';

COMMENT ON COLUMN public.user_session.user_id IS
  'The account whose window this is.';

COMMENT ON COLUMN public.user_session.last_seen_at IS
  'Refreshed by the open window''s heartbeat; an open session not seen for ten minutes is shown as inactive.';

COMMENT ON COLUMN public.user_session.ended_at IS
  'When the session was ended. NULL means it is still open (or was abandoned and is shown as inactive).';

COMMENT ON COLUMN public.user_session.ended_by_user_id IS
  'The account that ended the session: the same account on sign-out, or an administrator/developer.';

COMMENT ON COLUMN public.user_session.end_reason IS
  'SIGNED_OUT, ENDED_BY_ADMIN or ENDED_BY_DEVELOPER.';

COMMENT ON COLUMN public.user_session.device_name IS
  'The machine name reported by the client at sign-in.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON TABLE public.user_session TO enote_app;
    GRANT ALL ON SEQUENCE public.user_session_user_session_id_seq TO enote_app;
  END IF;
END
$$;
