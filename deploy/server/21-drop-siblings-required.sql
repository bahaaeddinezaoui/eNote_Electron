-- The number of siblings is optional: the sisters and the birth order can be
-- recorded without it. 12-student-family-counts.sql made a total mandatory as
-- soon as either of the other two was recorded (student_detail_siblings_
-- required_check); that rule is dropped here so a save may leave the total
-- blank and keep the rest.
--
-- The other family-count constraints are untouched: when a total is present it
-- still has to be at least the sisters and one less than the birth order, and
-- each count still has to be a usable number.
--
-- Idempotent: a constraint that is already gone is skipped.

BEGIN;

ALTER TABLE public.student_detail
  DROP CONSTRAINT IF EXISTS student_detail_siblings_required_check;

COMMIT;
