-- Who may read a lesson file.
--
-- Reading rights follow the curriculum rather than a list kept per file: a file
-- is filed under a lesson, the lesson under a major, so the major already says
-- which students and which teachers the file belongs to. This column narrows
-- that for the files that must not reach students, and opens it to the whole
-- school for the occasional file that belongs to no major at all.
--
--   CURRICULUM  follow the major the file is filed under (the default)
--   EVERYONE    every signed-in account, whatever the major
--   TEACHERS    the teaching staff of that major, and administrators
--   ADMINS      administrators only
--
-- Idempotent: safe to run again on a database that already has the column.

ALTER TABLE public.document
  ADD COLUMN IF NOT EXISTS document_visibility_code character varying(16) NOT NULL DEFAULT 'CURRICULUM';
