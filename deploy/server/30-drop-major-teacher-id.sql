-- ==============================================================================
-- 30-drop-major-teacher-id.sql
--
-- Drops the legacy `major.major_teacher_id` column and its foreign key.
--
-- Why: a major's teachers are recorded in the `major_teacher` join table, where
-- a major can have any number of teachers. `major.major_teacher_id` is the old
-- single-teacher pointer from the original schema:
--
--   * no service, IPC handler, renderer page, report or export reads it, and
--     createMajor/updateMajor never write it (the Majors dialog sends only code,
--     labels and category; teacher assignments go through major_teacher);
--   * every row in the current database has it NULL;
--   * it cannot express a major with more than one teacher, which the
--     application already supports.
--
-- Its only dependent object is the SQL function `app_teachers_of_major`, which
-- unions `study_session.instructor_id` with `major.major_teacher_id`. The column
-- has never contributed a row, so the function is redefined here with the
-- session-instructor branch only; its two callers (app_notify_lesson_material
-- and app_notify_missed_teacher_sessions) keep working unchanged. Nothing else
-- in the database mentions the column: no view, trigger, index or constraint
-- other than fk_major_teacher.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 30-drop-major-teacher-id.sql
--
-- Fresh installs: the full schema dump restored for a new installation still
-- contains the column and the old function body. Regenerate that dump from a
-- database this migration has been applied to.
--
-- Safe to re-run: the function is replaced, the constraint and column drops are
-- IF EXISTS.
--
-- Rollback, should the column ever be needed again:
--   ALTER TABLE public.major ADD COLUMN IF NOT EXISTS major_teacher_id bigint;
--   ALTER TABLE public.major
--     ADD CONSTRAINT fk_major_teacher FOREIGN KEY (major_teacher_id)
--     REFERENCES public.person(person_id)
--     ON UPDATE CASCADE ON DELETE SET NULL;
--   CREATE OR REPLACE FUNCTION public.app_teachers_of_major(p_major_id integer)
--   RETURNS TABLE(person_id integer)
--   LANGUAGE sql STABLE
--   AS $$
--     SELECT DISTINCT ss.instructor_id
--       FROM study_session ss
--      WHERE ss.major_id = p_major_id
--        AND ss.instructor_id IS NOT NULL
--     UNION
--     SELECT m.major_teacher_id
--       FROM major m
--      WHERE m.major_id = p_major_id
--        AND m.major_teacher_id IS NOT NULL
--   $$;
-- ==============================================================================

BEGIN;

-- 1. Redefine the function without the column. A teacher of a major is whoever
--    the timetable assigns to its sessions; the removed pointer added nothing.
CREATE OR REPLACE FUNCTION public.app_teachers_of_major(p_major_id integer)
RETURNS TABLE(person_id integer)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ss.instructor_id
    FROM public.study_session ss
   WHERE ss.major_id = p_major_id
     AND ss.instructor_id IS NOT NULL
$$;

-- 2. Drop the foreign key first, then the column it guards.
ALTER TABLE public.major DROP CONSTRAINT IF EXISTS fk_major_teacher;
ALTER TABLE public.major DROP COLUMN IF EXISTS major_teacher_id;

COMMIT;
