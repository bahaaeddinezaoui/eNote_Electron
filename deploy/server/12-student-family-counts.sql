-- The three family counts in student_detail describe one family, so they have
-- to agree with each other:
--   * the sisters are among the siblings;
--   * a student's rank among the siblings cannot be later than one place after
--     the last sibling — so an only child (0 siblings) can only be 1.
--
-- A blank field stays blank: "not recorded" is not a claim about the family, so
-- every constraint is written to allow NULL.
--
-- Existing rows are repaired rather than rejected. A negative count, or a rank
-- below one, is not a fact, so it becomes NULL. Where a row contradicts itself
-- the total is raised to fit the sisters and the rank: those are the more
-- specific values, and the total is what they imply.
--
-- Idempotent: the repair is a no-op once the data agrees, and a constraint that
-- is already present is skipped.

BEGIN;

UPDATE public.student_detail
   SET student_number_of_siblings = NULL
 WHERE student_number_of_siblings < 0;

UPDATE public.student_detail
   SET student_number_of_sisters = NULL
 WHERE student_number_of_sisters < 0;

UPDATE public.student_detail
   SET student_order_among_siblings = NULL
 WHERE student_order_among_siblings < 1;

UPDATE public.student_detail
   SET student_number_of_siblings = GREATEST(
         student_number_of_siblings,
         COALESCE(student_number_of_sisters, 0),
         COALESCE(student_order_among_siblings - 1, 0)
       )
 WHERE student_number_of_siblings IS NOT NULL
   AND (
     student_number_of_sisters > student_number_of_siblings
     OR student_order_among_siblings > student_number_of_siblings + 1
   );

-- A total is required as soon as the sisters or the order say something, since
-- those two are counted from it. A blank total becomes the count they imply.
UPDATE public.student_detail
   SET student_number_of_siblings = GREATEST(
         COALESCE(student_number_of_sisters, 0),
         COALESCE(student_order_among_siblings - 1, 0)
       )
 WHERE student_number_of_siblings IS NULL
   AND (student_number_of_sisters IS NOT NULL OR student_order_among_siblings IS NOT NULL);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_detail_siblings_count_check') THEN
    ALTER TABLE public.student_detail
      ADD CONSTRAINT student_detail_siblings_count_check
      CHECK (student_number_of_siblings IS NULL OR student_number_of_siblings >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_detail_sisters_count_check') THEN
    ALTER TABLE public.student_detail
      ADD CONSTRAINT student_detail_sisters_count_check
      CHECK (student_number_of_sisters IS NULL OR student_number_of_sisters >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_detail_sibling_order_check') THEN
    ALTER TABLE public.student_detail
      ADD CONSTRAINT student_detail_sibling_order_check
      CHECK (student_order_among_siblings IS NULL OR student_order_among_siblings >= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_detail_sisters_within_siblings_check') THEN
    ALTER TABLE public.student_detail
      ADD CONSTRAINT student_detail_sisters_within_siblings_check
      CHECK (student_number_of_sisters IS NULL
             OR student_number_of_siblings IS NULL
             OR student_number_of_sisters <= student_number_of_siblings);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_detail_order_within_siblings_check') THEN
    ALTER TABLE public.student_detail
      ADD CONSTRAINT student_detail_order_within_siblings_check
      CHECK (student_order_among_siblings IS NULL
             OR student_number_of_siblings IS NULL
             OR student_order_among_siblings <= student_number_of_siblings + 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_detail_siblings_required_check') THEN
    ALTER TABLE public.student_detail
      ADD CONSTRAINT student_detail_siblings_required_check
      CHECK (student_number_of_siblings IS NOT NULL
             OR (student_number_of_sisters IS NULL AND student_order_among_siblings IS NULL));
  END IF;
END
$$;

COMMIT;
