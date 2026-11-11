-- Values in student_detail that have a shape.
--
-- The academic average is a mark out of twenty, so anything outside 0–20 is a
-- data-entry slip (or an average left on another scale). The identifiers below
-- are digits and nothing else; the personal phone and the military helmet
-- number are the two that are written with spaces or codes and stay free text,
-- bounded only by their column length.
--
-- Both rules are added NOT VALID. Rows already on the server stay exactly as
-- they are — nothing is rewritten and no value is guessed — and every new or
-- edited row has to satisfy the rule from now on. A row that predates the rule
-- is corrected the next time it is saved, and the service's message names the
-- value that is wrong. Run VALIDATE CONSTRAINT once the old values have been
-- reviewed, to make the rule apply to the stored rows as well.
--
-- Idempotent: a constraint that is already present is skipped.

DO $$
DECLARE
  item text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_detail_academic_average_range_check'
  ) THEN
    ALTER TABLE public.student_detail
      ADD CONSTRAINT student_detail_academic_average_range_check
      CHECK (student_academic_average IS NULL
             OR (student_academic_average >= 0 AND student_academic_average <= 20))
      NOT VALID;
  END IF;

  FOREACH item IN ARRAY ARRAY[
    'student_baccalaureate_sub_number',
    'student_school_sub_card_number',
    'student_laptop_serial_number',
    'student_national_identification_number',
    'student_postal_account_number',
    'student_insurance_card_number',
    'student_military_card_number'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = item || '_digits_check'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.student_detail ADD CONSTRAINT %I CHECK (%I IS NULL OR %I ~ ''^[0-9]+$'') NOT VALID',
        item || '_digits_check', item, item
      );
    END IF;
  END LOOP;
END
$$;
