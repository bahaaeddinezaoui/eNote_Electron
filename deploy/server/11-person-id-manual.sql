-- person_id is an identifier the user supplies, not a generated number.
--
-- A person is registered with the twelve-digit id the institution issues, the
-- same value on every form and report. The sequence default is removed, so an
-- INSERT that carries no person_id fails instead of quietly inventing the next
-- number: the People page, the student registration form and the legacy
-- importer all supply the value themselves.
--
-- Ids already in the table (1..76) are left as they are.
--
-- The id is issued by hand, so it can also be corrected by hand, and a
-- correction has to follow the person everywhere. Every foreign key that points
-- at person(person_id) is rewritten with ON UPDATE CASCADE, so updating the key
-- re-points the child rows in the same statement instead of leaving orphans.
-- The ON DELETE behaviour of each key is preserved exactly as it was.
--
-- The person_id sequence is left in place: nothing uses it any more, but
-- dropping it is not needed for the rule above.
--
-- Idempotent: dropping a default that is already gone is a no-op, and a
-- constraint that already cascades on update is skipped.

ALTER TABLE public.person ALTER COLUMN person_id DROP DEFAULT;

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conrelid::regclass AS child,
           c.conname,
           pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.person'::regclass
  LOOP
    CONTINUE WHEN position('ON UPDATE CASCADE' in con.def) > 0;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', con.child, con.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s ON UPDATE CASCADE', con.child, con.conname, con.def);
  END LOOP;
END $$;
