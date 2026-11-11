-- A person may hold more than one account.
--
-- The person is who the records belong to; an account is one way to sign in as
-- them. One person can legitimately need several: a director login and a
-- secretary login (the roles and the teaching categories belong to the account,
-- not to the person, so the two are not interchangeable), a replacement
-- username, or a second duty with its own password and its own suspension
-- state. Only the username and the email have to be unique — they already are,
-- per user_user_username_key and user_user_email_key.
--
-- user_person_id_key (UNIQUE on person_id) made the second account impossible:
-- the INSERT in authService.register failed with a unique violation, and the
-- application's own reading of the design — register(), the personnel list, the
-- teaching-scope notes — has always assumed the account, not the person, is
-- what is unique. Dropping it is what makes the database agree.
--
-- The plain index replaces the unique one so lookups by person stay indexed
-- (the foreign key on person does not provide that direction).
--
-- Idempotent: both statements are no-ops once the change has been made.

ALTER TABLE public."user" DROP CONSTRAINT IF EXISTS user_person_id_key;

CREATE INDEX IF NOT EXISTS user_person_id_idx ON public."user" (person_id);
