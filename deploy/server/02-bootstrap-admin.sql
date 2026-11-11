-- ==============================================================================
-- 02-bootstrap-admin.sql
-- Run against database "eNote" on 192.214.23.15
-- Example: psql -U enote_app -d eNote -f 02-bootstrap-admin.sql
-- ==============================================================================

\c eNote

DO $$
DECLARE
  v_person_id BIGINT;
  v_user_id BIGINT;
  v_role_id BIGINT;
BEGIN
  IF to_regclass('public.person') IS NULL
     OR to_regclass('public."user"') IS NULL
     OR to_regclass('public.role') IS NULL THEN
    RAISE EXCEPTION 'The eNote schema is not installed. Restore a full eNote database backup to database "eNote" before bootstrapping the administrator.';
  END IF;

  -- 1. Check if an admin user already exists
  IF EXISTS (SELECT 1 FROM public."user" WHERE user_username = 'admin') THEN
    RAISE NOTICE 'Administrator account "admin" already exists.';
    RETURN;
  END IF;

  -- 2. Create person record for Administrator. person_id is issued by hand and
  --    is twelve digits (11-person-id-manual.sql), so no sequence supplies it:
  --    take the first free twelve-digit number.
  SELECT COALESCE(MAX(person_id), 100000000000) + 1
    INTO v_person_id
    FROM public.person
   WHERE person_id >= 100000000000;

  INSERT INTO public.person (
    person_id,
    person_first_name_la,
    person_last_name_la,
    person_first_name_ar,
    person_last_name_ar
  ) VALUES (
    v_person_id,
    'Admin',
    'System',
    'مدير',
    'النظام'
  );

  -- 3. Ensure the ADMIN role exists; the account carries it as role_id
  SELECT role_id INTO v_role_id FROM public.role WHERE role_code = 'ADMIN';

  IF v_role_id IS NULL THEN
    INSERT INTO public.role (role_label_en, role_code)
    VALUES ('Administrator', 'ADMIN')
    RETURNING role_id INTO v_role_id;
  END IF;

  -- 4. Create user record with initial password 'admin'
  -- Hash corresponds to bcrypt round 10 of 'admin'
  INSERT INTO public."user" (
    person_id,
    user_username,
    user_password_hash,
    user_email,
    role_id,
    is_active
  ) VALUES (
    v_person_id,
    'admin',
    '$2b$10$almrhu3aAgqNXr3DUMhuTOdMUcTxT3SzcRt28SkhxvQUAagYAbxhy',
    'admin@enote.local',
    v_role_id,
    TRUE
  ) RETURNING user_id INTO v_user_id;

  RAISE NOTICE 'Default administrator created successfully:';
  RAISE NOTICE '  Username: admin';
  RAISE NOTICE '  Password: admin';
  RAISE NOTICE 'IMPORTANT: Sign in immediately and change the administrator password!';
END
$$;
