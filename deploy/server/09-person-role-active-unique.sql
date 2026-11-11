-- One active row per role, per person.
--
-- A person's roles live in person_has_role, where a row with no end date is an
-- active role. Assigning a role somebody already holds would leave two active
-- rows: the table's key is (person_id, role_id, role_start_date), so assigning
-- the same role on two different days produces two rows that both fit, and the
-- "already active" guard has until now existed only in application code, which
-- two concurrent calls can both pass. This index makes the invariant the
-- database's to keep.
--
-- Partial, so it constrains only the active rows: the ended ones are history and
-- may repeat freely.
--
-- Idempotent: the cleanup is a no-op once the data is clean, and the index is
-- created only when it is missing.

-- Close all but the most recent active row of any role a person somehow holds
-- twice, so the index can be built on a database that is already dirty. The
-- newest row is kept because it is the one the role was last (re)assigned with.
WITH ranked AS (
  SELECT ctid,
         row_number() OVER (
           PARTITION BY person_id, role_id
           ORDER BY role_start_date DESC, ctid DESC
         ) AS rn
    FROM public.person_has_role
   WHERE role_end_date IS NULL
)
UPDATE public.person_has_role phr
   SET role_end_date = CURRENT_DATE
  FROM ranked
 WHERE ranked.rn > 1
   AND phr.ctid = ranked.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS person_has_role_active_role_uniq
    ON public.person_has_role (person_id, role_id)
 WHERE role_end_date IS NULL;
