-- ==============================================================================
-- 01-init-enote.sql
-- Run as superuser (postgres) on the server 192.214.23.15
-- Example: psql -U postgres -f 01-init-enote.sql
-- ==============================================================================

-- 1. Create dedicated application role if it does not already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    CREATE ROLE enote_app WITH LOGIN PASSWORD 'CHANGE_ME_PASSWORD';
    RAISE NOTICE 'Role enote_app created.';
  ELSE
    RAISE NOTICE 'Role enote_app already exists.';
  END IF;
END
$$;

-- 2. Create the eNote database with enote_app as owner if it does not exist
-- (Note: CREATE DATABASE cannot run inside a multi-command block in older versions,
-- so run with psql or verify existence beforehand).
SELECT 'CREATE DATABASE "eNote" WITH OWNER enote_app ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'eNote')\gexec

-- 3. Grant privileges to enote_app
GRANT ALL PRIVILEGES ON DATABASE "eNote" TO enote_app;

-- Connect to eNote to grant schema privileges
\c eNote

GRANT ALL ON SCHEMA public TO enote_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO enote_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO enote_app;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO enote_app;

-- Ensure future tables created by any user grant full privileges to enote_app
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO enote_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO enote_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO enote_app;

