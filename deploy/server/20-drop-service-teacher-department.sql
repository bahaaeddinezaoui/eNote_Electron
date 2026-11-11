-- ==============================================================================
-- 20-drop-service-teacher-department.sql
--
-- Two changes:
--
-- 1. The `service` table is not used. It has never held a row and no code path
--    reads or writes it. Its only dependent object is `person_belongs_to_service`
--    (the sole foreign key into it, and itself empty), so the mapping is dropped
--    first and then the table.
--
-- 2. A person who holds the TEACHER role belongs to a department.
--    A department already belongs to a direction: `department.direction_id` is
--    NOT NULL and references `direction` (fk_department_direction), so no schema
--    change is needed for that half.
--
--    The TEACHER role is read from `person_has_role`, not from `user.role_id`:
--      * `person_has_role` is the person's identity role. It is dated
--        (role_start_date / role_end_date), a person can hold more than one
--        person role, and it exists whether or not the person has a login.
--      * `user.role_id` is the sign-in account's role. It exists only when an
--        account exists and can hold only one role, so a teacher without an
--        account would be invisible if the relation were keyed off it.
--    The department is therefore stored on the TEACHER role row itself, which
--    keeps the assignment with the role it qualifies and lets an ended role keep
--    its history.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 20-drop-service-teacher-department.sql
--
-- Safe to re-run: the drops are IF EXISTS, the column uses IF NOT EXISTS, the
-- constraint and index are guarded, and the function/trigger are replaced.
--
-- Rollback, should the old shape ever be needed again:
--   DROP TRIGGER IF EXISTS person_has_role_department_teacher ON public.person_has_role;
--   DROP FUNCTION IF EXISTS public.person_role_department_must_be_teacher();
--   DROP INDEX IF EXISTS public.idx_person_has_role_department;
--   ALTER TABLE public.person_has_role DROP CONSTRAINT IF EXISTS fk_person_role_department;
--   ALTER TABLE public.person_has_role DROP COLUMN IF EXISTS department_id;
--   CREATE TABLE service (
--     service_id          serial PRIMARY KEY,
--     department_id       integer NOT NULL REFERENCES department(department_id),
--     service_code        varchar(40),
--     service_label_en    varchar(100),
--     service_label_ar    varchar(100),
--     service_label_fr    varchar(100)
--   );
--   CREATE TABLE person_belongs_to_service (
--     person_id   bigint NOT NULL REFERENCES person(person_id) ON UPDATE CASCADE ON DELETE CASCADE,
--     service_id  integer NOT NULL REFERENCES service(service_id) ON DELETE CASCADE,
--     PRIMARY KEY (person_id, service_id)
--   );
-- ==============================================================================

BEGIN;

-- 1. Remove the unused service register and its mapping.
DROP TABLE IF EXISTS public.person_belongs_to_service;
DROP TABLE IF EXISTS public.service;

-- 2. A TEACHER role row may name the department the teacher belongs to.
ALTER TABLE public.person_has_role
  ADD COLUMN IF NOT EXISTS department_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'fk_person_role_department'
       AND conrelid = 'public.person_has_role'::regclass
  ) THEN
    ALTER TABLE public.person_has_role
      ADD CONSTRAINT fk_person_role_department
      FOREIGN KEY (department_id)
      REFERENCES public.department(department_id)
      ON UPDATE CASCADE
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_person_has_role_department
  ON public.person_has_role (department_id);

-- Only a TEACHER role can carry a department. The check is a trigger because
-- the role code lives in another table, which a CHECK constraint cannot read.
CREATE OR REPLACE FUNCTION public.person_role_department_must_be_teacher()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.role r
     WHERE r.role_id = NEW.role_id
       AND UPPER(r.role_code) = 'TEACHER'
  ) THEN
    RAISE EXCEPTION
      'Only a TEACHER role can belong to a department'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS person_has_role_department_teacher ON public.person_has_role;
CREATE TRIGGER person_has_role_department_teacher
  BEFORE INSERT OR UPDATE OF role_id, department_id ON public.person_has_role
  FOR EACH ROW
  EXECUTE FUNCTION public.person_role_department_must_be_teacher();

COMMIT;
