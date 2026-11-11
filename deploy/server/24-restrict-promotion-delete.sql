-- Prevent deleting a promotion while sections still refer to it. This keeps
-- student reports from silently losing their promotion label.
--
-- Run after 23-drop-person-history.sql:
--   psql -U postgres -d eNote -f 24-restrict-promotion-delete.sql
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.section
  DROP CONSTRAINT IF EXISTS fk_section_promotion;

ALTER TABLE public.section
  ADD CONSTRAINT fk_section_promotion
  FOREIGN KEY (promotion_id)
  REFERENCES public.promotion (promotion_id)
  ON DELETE RESTRICT;

COMMIT;
