-- ==============================================================================
-- 25-add-teacher-constraint-options.sql
--
-- The predefined weekly teacher constraints. A teacher no longer types a window
-- free-hand: the administration keeps one list of hard (unavailable) and soft
-- (not recommended) windows in Settings -> Registers -> "Teacher constraint
-- options", and a teacher only selects from it.
--
-- teacher_constraint keeps the row a teacher declared (day, kind, times, note)
-- so the scheduler, the lock and the reports still read one table; the new
-- column records which predefined entry it came from. Rows declared before
-- this migration keep a NULL option and stay valid.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 25-add-teacher-constraint-options.sql
--
-- Safe to re-run: every statement checks for what already exists.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.teacher_constraint_option (
    teacher_constraint_option_id bigserial NOT NULL,
    constraint_option_code character varying(40),
    constraint_kind character varying(8) NOT NULL DEFAULT 'HARD',
    constraint_start_time time without time zone NOT NULL,
    constraint_end_time time without time zone NOT NULL,
    constraint_option_label_en character varying(160),
    constraint_option_label_ar character varying(160),
    constraint_option_label_fr character varying(160),
    constraint_option_note character varying(500),
    sort_order integer NOT NULL DEFAULT 0,
    created_by_user_id integer,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teacher_constraint_option_pkey'
  ) THEN
    ALTER TABLE ONLY public.teacher_constraint_option
      ADD CONSTRAINT teacher_constraint_option_pkey
      PRIMARY KEY (teacher_constraint_option_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS teacher_constraint_option_order_idx
    ON public.teacher_constraint_option (constraint_kind, sort_order, constraint_start_time);

-- A window may exist once per kind: the same hours cannot be listed twice as
-- hard, nor twice as soft. One hard and one soft entry for the same hours is
-- allowed — they mean different things to the scheduler.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_constraint_option_window_key
    ON public.teacher_constraint_option (constraint_kind, constraint_start_time, constraint_end_time);

-- ---- Starter windows -------------------------------------------------------
-- The list arrives ready to use, so a teacher can declare a constraint on the
-- first day after this migration instead of facing an empty picker. The hours
-- describe a school day that runs from 08:00 to 17:00: five hard blocks (the
-- teacher is unavailable) covering that day, and four soft ones (not
-- recommended) for the periods teachers usually prefer to avoid.
--
-- Nothing here is fixed: an administrator edits, reorders or deletes any entry
-- in Settings -> Registers -> "Teacher constraint options". A window that is
-- already in the list for the same kind is left exactly as the administration
-- arranged it, so re-running this file never overwrites an edit.
--
-- The labels below are Arabic and French as well as English, so the session is
-- told the file is UTF-8; a Windows psql otherwise reads the Arabic literals in
-- the console code page and stores them garbled.
SET client_encoding = 'UTF8';

INSERT INTO public.teacher_constraint_option (
    constraint_option_code, constraint_kind,
    constraint_start_time, constraint_end_time,
    constraint_option_label_en, constraint_option_label_ar, constraint_option_label_fr,
    sort_order
) VALUES
    ('HARD_EARLY_MORNING', 'HARD', '08:00', '10:00',
     'Early morning',      'الصباح الباكر',  'Début de matinée',    10),
    ('HARD_LATE_MORNING',  'HARD', '10:00', '12:00',
     'Late morning',       'آخر الصباح',    'Fin de matinée',      20),
    ('HARD_MIDDAY',        'HARD', '12:00', '14:00',
     'Midday break',       'استراحة الظهر',  'Pause de midi',       30),
    ('HARD_AFTERNOON',     'HARD', '14:00', '16:00',
     'Afternoon',          'بعد الظهر',      'Après-midi',          40),
    ('HARD_END_OF_DAY',    'HARD', '16:00', '17:00',
     'End of the day',     'آخر النهار',     'Fin de journée',      50),
    ('SOFT_FIRST_PERIOD',  'SOFT', '08:00', '09:00',
     'First period',       'الحصة الأولى',   'Première heure',      10),
    ('SOFT_LUNCH_HOUR',    'SOFT', '12:00', '13:00',
     'Lunch hour',         'ساعة الغداء',    'Heure du déjeuner',   20),
    ('SOFT_AFTER_LUNCH',   'SOFT', '13:00', '14:00',
     'After lunch',        'بعد الغداء',     'Après le déjeuner',   30),
    ('SOFT_LAST_PERIOD',   'SOFT', '16:00', '17:00',
     'Last period',        'الحصة الأخيرة',  'Dernière heure',      40)
ON CONFLICT (constraint_kind, constraint_start_time, constraint_end_time) DO NOTHING;

-- teacher_constraint is created on first use by the application, so it may not
-- exist yet on a fresh database; the runtime ensure adds this column in that
-- case and this statement is simply skipped.
ALTER TABLE IF EXISTS public.teacher_constraint
    ADD COLUMN IF NOT EXISTS teacher_constraint_option_id integer;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'teacher_constraint'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teacher_constraint_option_fkey'
  ) THEN
    ALTER TABLE ONLY public.teacher_constraint
      ADD CONSTRAINT teacher_constraint_option_fkey
      FOREIGN KEY (teacher_constraint_option_id)
      REFERENCES public.teacher_constraint_option(teacher_constraint_option_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Grant to the application role when it exists (the LAN server creates it in
-- 01-init-enote.sql; a local development database often only has postgres).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON public.teacher_constraint_option TO enote_app;
    GRANT ALL ON SEQUENCE public.teacher_constraint_option_teacher_constraint_option_id_seq TO enote_app;
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'teacher_constraint'
    ) THEN
      GRANT ALL ON public.teacher_constraint TO enote_app;
    END IF;
  END IF;
END
$$;
