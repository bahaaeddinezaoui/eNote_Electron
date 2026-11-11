-- ==============================================================================
-- 22-conduct-add-rights.sql
--
-- Splits the conduct ledger rights into add / edit / delete.
--
-- Why: `secretary_detail` has always carried two rights per entity — one that
-- guarded writing an entry and one that guarded removing it — and the writing
-- one covered both adding a new entry and changing one already recorded. The
-- two are separate acts now: a secretary may be allowed to add an entry without
-- being allowed to change one somebody else filed.
--
-- The new columns carry the add right; `can_edit_*` keeps its name and now
-- guards a change to an existing entry only. The columns are backfilled from
-- `can_edit_*`, so every account keeps exactly the ability it had before this
-- migration.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 22-conduct-add-rights.sql
--
-- Idempotent: the columns are only added, and the backfill only runs, when
-- `can_add_punishments` is not there yet. Re-running therefore never overwrites
-- rights an administrator has set since.
-- ==============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'secretary_detail'
      AND column_name = 'can_add_punishments'
  ) THEN
    ALTER TABLE public.secretary_detail
      ADD COLUMN can_add_punishments boolean NOT NULL DEFAULT false,
      ADD COLUMN can_add_rewards     boolean NOT NULL DEFAULT false;

    UPDATE public.secretary_detail
       SET can_add_punishments = COALESCE(can_edit_punishments, false),
           can_add_rewards     = COALESCE(can_edit_rewards, false);

    RAISE NOTICE 'Conduct add rights added and backfilled from the edit rights.';
  ELSE
    RAISE NOTICE 'Conduct add rights already present; nothing changed.';
  END IF;
END
$$;

COMMIT;
