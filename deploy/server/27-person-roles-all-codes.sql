-- ==============================================================================
-- 27-person-roles-all-codes.sql
--
-- People can now be recorded with any role the school defines — Director,
-- Secretary, Scheduler, Admin and Developer as well as Teacher and Student.
--
-- Until now a trigger (15-person-role-codes.sql) closed person_has_role to the
-- two "person" codes, so a staff code could not be written there at all. That
-- rule is lifted: person_has_role describes who somebody is in the institution,
-- which is a wider question than which role they sign in with.
--
-- What a login may DO is still decided only by user.role_id. Person roles are
-- descriptive everywhere in the application (navigation and every server check
-- read the account role), so writing a staff code here never grants authority.
--
-- The foreign key on person_has_role.role_id already guarantees that only a
-- role which exists can be stored, so the trigger has nothing left to enforce.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 27-person-roles-all-codes.sql
--
-- Safe to re-run: both drops are conditional.
-- ==============================================================================

BEGIN;

DROP TRIGGER IF EXISTS person_has_role_person_code ON public.person_has_role;
DROP FUNCTION IF EXISTS public.person_role_must_be_person_code();

COMMIT;
