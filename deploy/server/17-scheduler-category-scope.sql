-- 17-scheduler-category-scope.sql
--
-- Schedulers become category-scoped, exactly like secretaries.
--
--   1. A teaching group now belongs to one teaching category, so every weekly
--      session (which always sits in a group) can be attributed to a category.
--      Existing groups take the category of their promotion when it is set.
--   2. Every SCHEDULER account is given every teaching category, so the
--      restriction does not lock out schedulers that already work today. An
--      administrator narrows the set afterwards on the Secretaries page.
--
-- The account/scope rows stay in user_has_teaching_category (the same table the
-- secretary scope uses); nothing new is created for that.
--
-- Re-running is safe: the column, constraint and index are guarded, the
-- backfill only fills NULLs, and the grants use ON CONFLICT DO NOTHING.

BEGIN;

ALTER TABLE teaching_group ADD COLUMN IF NOT EXISTS teaching_category_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'teaching_group_teaching_category_id_fkey'
       AND conrelid = 'teaching_group'::regclass
  ) THEN
    ALTER TABLE teaching_group
      ADD CONSTRAINT teaching_group_teaching_category_id_fkey
      FOREIGN KEY (teaching_category_id)
      REFERENCES teaching_category (teaching_category_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_teaching_group_teaching_category
  ON teaching_group (teaching_category_id);

-- Groups whose promotion already names a category inherit it. A group with no
-- promotion, or a promotion with no category, stays unassigned: restricted
-- accounts may not schedule in it until an administrator assigns one.
UPDATE teaching_group tg
   SET teaching_category_id = pr.teaching_category_id
  FROM promotion pr
 WHERE pr.promotion_id = tg.promotion_id
   AND tg.teaching_category_id IS NULL
   AND pr.teaching_category_id IS NOT NULL;

-- Existing schedulers keep full reach on day one.
INSERT INTO user_has_teaching_category (user_id, teaching_category_id)
SELECT u.user_id, tc.teaching_category_id
  FROM "user" u
  JOIN "role" r ON r.role_id = u.role_id AND r.role_code = 'SCHEDULER'
 CROSS JOIN teaching_category tc
ON CONFLICT DO NOTHING;

COMMIT;
