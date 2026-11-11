-- ==============================================================================
-- 18-teaching-category-scope-provenance.sql
--
-- Renames user_has_teaching_category to user_teaching_category_scope, and
-- records who wrote each grant and when.
--
-- Why the rename: the old name listed the two nouns a row contains and said
-- nothing about what the row does. A student "has" a teaching category in this
-- schema (through their section), a teaching group "has" one, and only this
-- table holds an authorisation: the account is responsible for the category, and
-- a missing row means no reach at all. "Scope" is the word the code already uses
-- for that idea — teachingScopeService.loadScope() returns { restricted,
-- categoryIds } — so the table now names the relation instead of the endpoints.
-- The neighbouring role_has_permission follows the same rule: a grant is named
-- for what it grants, not for the lookup it points at.
--
-- Why the provenance: a grant could not answer "who gave this secretary LMD 2,
-- and when". The audit log carries a whole before/after set per save
-- (permission.teaching_scope), enough to reconstruct a history but not to read
-- one row.
--
-- Existing rows keep NULL in both new columns. Nothing is invented: the rows in
-- the live database were written either by the earlier admin form or by
-- 17-scheduler-category-scope.sql, which replaced the set wholesale and recorded
-- no grantor. NULL means exactly that — granted before provenance was tracked.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 18-teaching-category-scope-provenance.sql
--
-- Safe to re-run: the rename happens only while the old name exists and the new
-- one does not, every constraint and index rename checks the old name first, and
-- the columns are added with IF NOT EXISTS.
--
-- Must run after 17-scheduler-category-scope.sql, which writes to the old name.
-- Migrations already applied are not rewritten: 17 stays as it was released.
-- ==============================================================================

BEGIN;

-- ---- The rename ------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'user_has_teaching_category'
       AND c.relkind = 'r'
  ) AND NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'user_teaching_category_scope'
       AND c.relkind = 'r'
  ) THEN
    ALTER TABLE public.user_has_teaching_category
      RENAME TO user_teaching_category_scope;
  END IF;
END
$$;

-- The constraints and the index carry the old table name, so they are renamed
-- with it. A half-renamed table (new name, user_has_teaching_category_pkey) is
-- the kind of thing a later migration greps for and does not find.
-- Renaming the primary key also renames the index it owns.

DO $$
BEGIN
  IF to_regclass('public.user_teaching_category_scope') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_has_teaching_category_pkey'
       AND conrelid = to_regclass('public.user_teaching_category_scope')
  ) THEN
    ALTER TABLE public.user_teaching_category_scope
      RENAME CONSTRAINT user_has_teaching_category_pkey TO user_teaching_category_scope_pkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_has_teaching_category_user_id_fkey'
       AND conrelid = to_regclass('public.user_teaching_category_scope')
  ) THEN
    ALTER TABLE public.user_teaching_category_scope
      RENAME CONSTRAINT user_has_teaching_category_user_id_fkey
      TO user_teaching_category_scope_user_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_has_teaching_category_teaching_category_id_fkey'
       AND conrelid = to_regclass('public.user_teaching_category_scope')
  ) THEN
    ALTER TABLE public.user_teaching_category_scope
      RENAME CONSTRAINT user_has_teaching_category_teaching_category_id_fkey
      TO user_teaching_category_scope_teaching_category_id_fkey;
  END IF;

  -- PostgreSQL 18 keeps NOT NULL as a named constraint; earlier versions do not
  -- have these rows, so the guards simply do not fire there.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_has_teaching_category_user_id_not_null'
       AND conrelid = to_regclass('public.user_teaching_category_scope')
  ) THEN
    ALTER TABLE public.user_teaching_category_scope
      RENAME CONSTRAINT user_has_teaching_category_user_id_not_null
      TO user_teaching_category_scope_user_id_not_null;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_has_teaching_category_teaching_category_id_not_null'
       AND conrelid = to_regclass('public.user_teaching_category_scope')
  ) THEN
    ALTER TABLE public.user_teaching_category_scope
      RENAME CONSTRAINT user_has_teaching_category_teaching_category_id_not_null
      TO user_teaching_category_scope_teaching_category_id_not_null;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.idx_uhtc_teaching_category') IS NOT NULL
     AND to_regclass('public.idx_utcs_teaching_category') IS NULL THEN
    ALTER INDEX public.idx_uhtc_teaching_category
      RENAME TO idx_utcs_teaching_category;
  END IF;
END
$$;

-- ---- Provenance ------------------------------------------------------------
-- Both columns are added without a DEFAULT so that rows written before this
-- migration stay NULL. created_at then takes its default for new rows only;
-- adding the column WITH a default would have stamped every existing grant with
-- the migration's own timestamp, which is a claim the data does not support.

ALTER TABLE public.user_teaching_category_scope
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone;

ALTER TABLE public.user_teaching_category_scope
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.user_teaching_category_scope
  ADD COLUMN IF NOT EXISTS granted_by_user_id integer;

-- ON DELETE SET NULL, not the default NO ACTION: deleting an administrator must
-- neither be blocked by the grants they made nor erase them. The grant survives
-- and forgets who wrote it, which is the accurate outcome.
DO $$
BEGIN
  IF to_regclass('public.user_teaching_category_scope') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_teaching_category_scope_granted_by_user_id_fkey'
  ) THEN
    ALTER TABLE public.user_teaching_category_scope
      ADD CONSTRAINT user_teaching_category_scope_granted_by_user_id_fkey
      FOREIGN KEY (granted_by_user_id)
      REFERENCES public."user" (user_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMENT ON TABLE public.user_teaching_category_scope IS
  'Teaching-category scope: the account is responsible for the category. No row means no reach; an ADMIN account is unrestricted whatever rows it holds.';

COMMENT ON COLUMN public.user_teaching_category_scope.created_at IS
  'When the grant was written. NULL: granted before 18- tracked provenance.';

COMMENT ON COLUMN public.user_teaching_category_scope.granted_by_user_id IS
  'The administrator account that saved the grant. NULL: granted before 18- tracked provenance, or that account has since been deleted.';

-- ---- Grants ----------------------------------------------------------------
-- Renaming a table keeps its privileges, so this is only a safety net for a
-- database where the table was created after the application role.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app')
     AND to_regclass('public.user_teaching_category_scope') IS NOT NULL THEN
    GRANT ALL ON TABLE public.user_teaching_category_scope TO enote_app;
  END IF;
END
$$;

COMMIT;
