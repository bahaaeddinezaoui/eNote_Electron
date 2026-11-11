-- ==============================================================================
-- 19-drop-unused-permission-tables.sql
--
-- Drops the permission lookup table and its role_has_permission mapping.
--
-- Why: neither table has ever held a row, and no code path reads or writes
-- them. Authorisation in this application is role-based — user.role_id and
-- person_has_role decide what an account is, and each capability has its own
-- table (`secretary_detail` for the conduct ledger, `message_rule` for who may
-- message whom, `app_locked_page` for locked pages,
-- `user_teaching_category_scope` for teaching categories). Nothing consults a
-- permission code. The pair is a leftover from the original schema, and an empty
-- `role_has_permission` is what blocks dropping `permission` (it carries the
-- only foreign key into it), so the two go together.
--
-- role_has_permission.permission_id is the only dependent object: no view,
-- function or trigger in the database mentions either table.
--
-- Run against the live database:
--   psql -U postgres -d eNote -f 19-drop-unused-permission-tables.sql
--
-- Safe to re-run: both drops are IF EXISTS, and the sequence owned by
-- `permission` (permission_permission_id_seq) is removed with its table.
--
-- Rollback, should a future schema ever need them again:
--   CREATE TABLE permission (
--     permission_id         serial PRIMARY KEY,
--     permission_code       varchar(60) NOT NULL UNIQUE,
--     permission_label_en   varchar(100),
--     permission_label_ar   varchar(100),
--     permission_label_fr   varchar(100)
--   );
--   CREATE TABLE role_has_permission (
--     role_id       integer NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
--     permission_id integer NOT NULL REFERENCES permission(permission_id) ON DELETE CASCADE,
--     PRIMARY KEY (role_id, permission_id)
--   );
--   CREATE INDEX fk_role_perm_map_perm ON role_has_permission (permission_id);
-- ==============================================================================

BEGIN;

DROP TABLE IF EXISTS role_has_permission;
DROP TABLE IF EXISTS permission;

COMMIT;
