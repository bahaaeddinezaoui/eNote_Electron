-- ==============================================================================
-- 31-scheduler-department-scope.sql
--
-- Two related changes:
--
-- 1. A department is responsible for one major category. `department` gains a
--    `major_category_id` that points at `major_category`. The link is required
--    for every new or updated department. Existing departments (if any) are not
--    rewritten: the check constraint is added NOT VALID so old rows may still be
--    NULL until an administrator opens and saves them. When the table is empty,
--    as it is in a fresh installation, the constraint is validated immediately.
--
-- 2. Schedulers are responsible for one or more departments. The grant lives in
--    `user_department_scope`, mirroring `user_teaching_category_scope`, and is
--    combined with the teaching-category scope: a scheduler may only work in a
--    teaching group when BOTH the group's teaching category and the major
--    category of the group's major fall inside their grants.
--
--    A group's major is resolved through `teaching_group.major_id` ->
--    `major.major_category_id` -> `department.major_category_id`. No column is
--    added to `teaching_group`: the department owns the major category, and the
--    major already names that category.
--
-- Existing scheduler accounts receive every existing department, so the new
-- scope does not lock them out on the day the migration runs. Their existing
-- teaching-category scope still applies. An administrator narrows the set
-- afterwards on the Secretaries page.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 31-scheduler-department-scope.sql
--
-- Safe to re-run: columns use IF NOT EXISTS, constraints and indexes are
-- guarded, the check constraint is added only once, and the grants use
-- ON CONFLICT DO NOTHING.
-- ==============================================================================

BEGIN;

-- ---- 1. Department -> major category ---------------------------------------

ALTER TABLE public.department
  ADD COLUMN IF NOT EXISTS major_category_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'department_major_category_id_fkey'
       AND conrelid = 'public.department'::regclass
  ) THEN
    ALTER TABLE public.department
      ADD CONSTRAINT department_major_category_id_fkey
      FOREIGN KEY (major_category_id)
      REFERENCES public.major_category (major_category_id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_department_major_category
  ON public.department (major_category_id);

-- NOT VALID: the rule is enforced for every INSERT and UPDATE, while rows that
-- predate this migration are allowed to stay NULL until an administrator saves
-- them. A fresh database has no rows, so the constraint is validated below.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'department_major_category_required'
       AND conrelid = 'public.department'::regclass
  ) THEN
    ALTER TABLE public.department
      ADD CONSTRAINT department_major_category_required
      CHECK (major_category_id IS NOT NULL) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.department) THEN
    ALTER TABLE public.department
      VALIDATE CONSTRAINT department_major_category_required;
  END IF;
END
$$;

COMMENT ON COLUMN public.department.major_category_id IS
  'The major category this department is responsible for. Required for new and updated departments; NULL only on rows written before 31-scheduler-department-scope.sql.';

-- ---- 2. Scheduler -> department scope --------------------------------------

CREATE TABLE IF NOT EXISTS public.user_department_scope (
    user_id integer NOT NULL,
    department_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    granted_by_user_id integer,
    PRIMARY KEY (user_id, department_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_department_scope_user_id_fkey'
       AND conrelid = 'public.user_department_scope'::regclass
  ) THEN
    ALTER TABLE public.user_department_scope
      ADD CONSTRAINT user_department_scope_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES public."user" (user_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_department_scope_department_id_fkey'
       AND conrelid = 'public.user_department_scope'::regclass
  ) THEN
    ALTER TABLE public.user_department_scope
      ADD CONSTRAINT user_department_scope_department_id_fkey
      FOREIGN KEY (department_id)
      REFERENCES public.department (department_id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_department_scope_granted_by_user_id_fkey'
       AND conrelid = 'public.user_department_scope'::regclass
  ) THEN
    ALTER TABLE public.user_department_scope
      ADD CONSTRAINT user_department_scope_granted_by_user_id_fkey
      FOREIGN KEY (granted_by_user_id)
      REFERENCES public."user" (user_id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_uds_department
  ON public.user_department_scope (department_id);

COMMENT ON TABLE public.user_department_scope IS
  'Department scope for scheduler accounts: the account is responsible for the schedule of the department. No row means no department reach; an ADMIN account is unrestricted whatever rows it holds.';

COMMENT ON COLUMN public.user_department_scope.created_at IS
  'When the grant was written.';

COMMENT ON COLUMN public.user_department_scope.granted_by_user_id IS
  'The administrator account that saved the grant. NULL: that account has since been deleted.';

-- Existing schedulers keep every department on day one. Their category scope is
-- untouched, so the combined rule still lets them work exactly where they did.
INSERT INTO public.user_department_scope (user_id, department_id)
SELECT u.user_id, d.department_id
  FROM public."user" u
  JOIN public."role" r ON r.role_id = u.role_id AND r.role_code = 'SCHEDULER'
 CROSS JOIN public.department d
ON CONFLICT DO NOTHING;

-- ---- Grants ---------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON TABLE public.user_department_scope TO enote_app;
  END IF;
END
$$;

COMMIT;
