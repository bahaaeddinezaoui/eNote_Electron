-- ==============================================================================
-- 07-add-document-uploader.sql
--
-- Records who uploaded a lesson document. The library previously attributed a
-- file only to the lesson it was filed under, so a teacher had no way to see
-- the files they had added themselves. The uploader is the account ("user")
-- that performed the upload, matching document_access.user_id.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 07-add-document-uploader.sql
--
-- Safe to re-run: every statement checks for what already exists.
-- ==============================================================================

ALTER TABLE public.document
    ADD COLUMN IF NOT EXISTS document_uploaded_by_user_id integer;

CREATE INDEX IF NOT EXISTS document_uploaded_by_user_idx
    ON public.document (document_uploaded_by_user_id);

-- Grant to the application role when it exists (the LAN server creates it in
-- 01-init-enote.sql; a local development database often only has postgres).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON TABLE public.document TO enote_app;
  END IF;
END
$$;
