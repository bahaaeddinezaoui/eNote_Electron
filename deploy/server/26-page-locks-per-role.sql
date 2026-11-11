-- ==============================================================================
-- 26-page-locks-per-role.sql
--
-- Page locks per role. A lock used to close a page for every account; it can
-- now name the roles it closes the page for, while an Admin or a Developer
-- keeps access (they administer the locks).
--
-- app_locked_page keeps the lock itself (route, who locked it, when). The new
-- child table names the roles it applies to; a lock with no child rows applies
-- to every role, which is exactly what the shared locks of earlier releases
-- mean, so existing rows keep working untouched.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 26-page-locks-per-role.sql
--
-- Safe to re-run: every statement checks for what already exists.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_locked_page_role (
    app_locked_page_role_id bigserial NOT NULL,
    route character varying(120) NOT NULL,
    role_code character varying(24) NOT NULL,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_locked_page_role_pkey'
  ) THEN
    ALTER TABLE ONLY public.app_locked_page_role
      ADD CONSTRAINT app_locked_page_role_pkey
      PRIMARY KEY (app_locked_page_role_id);
  END IF;
END
$$;

-- One row per page and role; it also gives ON CONFLICT (route, role_code) a
-- unique index to infer.
CREATE UNIQUE INDEX IF NOT EXISTS app_locked_page_role_key
    ON public.app_locked_page_role (route, role_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_locked_page_role_route_fkey'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'app_locked_page'
  ) THEN
    ALTER TABLE ONLY public.app_locked_page_role
      ADD CONSTRAINT app_locked_page_role_route_fkey
      FOREIGN KEY (route) REFERENCES public.app_locked_page(route)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON public.app_locked_page_role TO enote_app;
    GRANT ALL ON SEQUENCE public.app_locked_page_role_app_locked_page_role_id_seq TO enote_app;
  END IF;
END
$$;
