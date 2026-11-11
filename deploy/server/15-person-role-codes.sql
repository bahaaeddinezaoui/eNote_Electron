-- person_has_role holds who somebody IS in the school: TEACHER or STUDENT.
--
-- Staff roles (ADMIN, DIRECTOR, SECRETARY, SCHEDULER, DEVELOPER) are what a
-- sign-in account may do, and they live on that account (user.role_id). The two
-- stores are now kept apart everywhere: navigation and every server check read
-- the account role, while person roles only describe. A staff code written here
-- would therefore look like an identity with authority it never grants — and
-- the legacy importer used to write exactly that, linking each account's role
-- to its person.
--
-- Existing rows carrying a staff code are closed rather than deleted: the row
-- is history, and ending it keeps the record of what was believed at the time.
-- The trigger only judges a row when its role_id is written, so closing these
-- rows (an update of role_end_date) is not blocked by it.
--
-- Idempotent: the cleanup is a no-op once the data is clean, the function is
-- replaced, and the trigger is recreated.

BEGIN;

WITH invalid AS (
  SELECT phr.ctid
    FROM public.person_has_role phr
    JOIN public.role r ON r.role_id = phr.role_id
   WHERE phr.role_end_date IS NULL
     AND UPPER(r.role_code) NOT IN ('STUDENT', 'TEACHER')
)
UPDATE public.person_has_role phr
   SET role_end_date = CURRENT_DATE
  FROM invalid
 WHERE phr.ctid = invalid.ctid;

CREATE OR REPLACE FUNCTION public.person_role_must_be_person_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.role r
     WHERE r.role_id = NEW.role_id
       AND UPPER(r.role_code) IN ('STUDENT', 'TEACHER')
  ) THEN
    RAISE EXCEPTION
      'person_has_role accepts only person roles (STUDENT, TEACHER); staff roles belong to a sign-in account'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS person_has_role_person_code ON public.person_has_role;
CREATE TRIGGER person_has_role_person_code
  BEFORE INSERT OR UPDATE OF role_id ON public.person_has_role
  FOR EACH ROW
  EXECUTE FUNCTION public.person_role_must_be_person_code();

COMMIT;
