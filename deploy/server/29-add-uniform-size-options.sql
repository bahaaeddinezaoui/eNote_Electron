-- ==============================================================================
-- 29-add-uniform-size-options.sql
--
-- Uniform sizes become an enumeration. Until now a size was free text typed in
-- the student's record; from this migration the administration keeps one list
-- of allowed sizes per uniform item in Settings → Registers → Uniform sizes,
-- and the student forms only offer those values.
--
-- The list covers the combat outfit (both outfit sizes share one list, plus the
-- combat shoe size) and the parade uniform: summer/winter jacket, trousers,
-- shirt and hat, and the summer and winter skirt.
--
-- The winter skirt was also missing from student_parade_uniform; it is added
-- here. A male student never carries either skirt size (the application clears
-- them), which is a rule of the record rather than of the column.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 29-add-uniform-size-options.sql
--
-- Safe to re-run: every statement checks for what already exists.
-- ==============================================================================

SET client_encoding = 'UTF8';

-- ---- The allowed sizes -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.uniform_size_option (
    uniform_size_option_id bigserial NOT NULL,
    uniform_size_kind character varying(32) NOT NULL,
    uniform_size_value character varying(40) NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_by_user_id integer,
    created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uniform_size_option_pkey'
  ) THEN
    ALTER TABLE ONLY public.uniform_size_option
      ADD CONSTRAINT uniform_size_option_pkey
      PRIMARY KEY (uniform_size_option_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS uniform_size_option_order_idx
    ON public.uniform_size_option (uniform_size_kind, sort_order, uniform_size_value);

-- A size is listed once per uniform item. The comparison ignores case so "m"
-- and "M" cannot both be recorded as different sizes.
CREATE UNIQUE INDEX IF NOT EXISTS uniform_size_option_value_key
    ON public.uniform_size_option (uniform_size_kind, lower(uniform_size_value));

-- ---- The winter skirt --------------------------------------------------------
ALTER TABLE IF EXISTS public.student_parade_uniform
    ADD COLUMN IF NOT EXISTS winter_skirt_size character varying(10);

-- A male student has no skirt. Records written before this rule are cleared
-- here; the application does the same when a record is turned male.
UPDATE public.student_parade_uniform pu
   SET summer_skirt_size = NULL,
       winter_skirt_size = NULL
  FROM public.person p
 WHERE p.person_id = pu.person_id
   AND p.person_sex = 'M'
   AND (pu.summer_skirt_size IS NOT NULL OR pu.winter_skirt_size IS NOT NULL);

-- ---- Grants ------------------------------------------------------------------
-- The LAN server creates the application role in 01-init-enote.sql; a local
-- development database often only has postgres.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'enote_app') THEN
    GRANT ALL ON public.uniform_size_option TO enote_app;
    GRANT ALL ON SEQUENCE public.uniform_size_option_uniform_size_option_id_seq TO enote_app;
  END IF;
END
$$;
