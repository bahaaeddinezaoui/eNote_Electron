-- ==============================================================================
-- 03-user-role-fk.sql
--
-- An account holds exactly one role, so the role is a column on "user" instead
-- of a separate join table.
--
-- Run against an existing eNote database:
--   psql -U postgres -d eNote -f 03-user-role-fk.sql
--
-- The migration refuses to run if an account somehow holds more than one role,
-- so no assignment is ever dropped silently. It is safe to re-run: a database
-- that already has role_id and no user_has_role is left untouched.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  v_multi INTEGER;
BEGIN
  IF to_regclass('public.user_has_role') IS NULL THEN
    RAISE NOTICE 'user_has_role is already gone; nothing to migrate.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_multi
    FROM (
      SELECT user_id
        FROM public.user_has_role
       GROUP BY user_id
      HAVING count(*) > 1
    ) AS duplicated;

  IF v_multi > 0 THEN
    RAISE EXCEPTION
      'Refusing to migrate: % account(s) hold more than one role. Resolve them first.',
      v_multi;
  END IF;
END
$$;

-- 1. The column itself. Accounts created without a role keep none, exactly as a
--    missing user_has_role row used to mean.
ALTER TABLE public."user" ADD COLUMN IF NOT EXISTS role_id integer;

-- 2. Carry the existing assignments over before the join table goes away.
UPDATE public."user" u
   SET role_id = uhr.role_id
  FROM public.user_has_role uhr
 WHERE uhr.user_id = u.user_id;

-- 3. Same referential rule the join table had for its role side.
ALTER TABLE public."user" DROP CONSTRAINT IF EXISTS fk_user_role;
ALTER TABLE public."user"
  ADD CONSTRAINT fk_user_role FOREIGN KEY (role_id)
  REFERENCES public.role(role_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fk_user_role ON public."user" USING btree (role_id);

-- 4. The redundant table.
DROP TABLE IF EXISTS public.user_has_role;

COMMIT;
