# Multilingual attribute plan (English / Arabic / French)

Scope: the PostgreSQL schema used by the app (`eNote_pg.sql` plus the migrations,
mirrored in the `eNote.sql` dump). The goal is to name every table attribute that
must hold language-specific values and to record which variant set each one uses.

## The two schemes

| Scheme | Columns | Used for | Existing examples |
| --- | --- | --- | --- |
| **A — three labels** | `<attr>_en`, `<attr>_ar`, `<attr>_fr` | Reference/lookup labels and any value the UI must display in the user's language | `military_grade_*`, `country_name_*`, `punishment_label_*`, `changelog.title_*`, `feature.feature_text_*` |
| **B — latin + Arabic** | `<attr>_la`, `<attr>_ar` | Person names: a Latin transliteration plus the Arabic original. There is no "French" version of a person's name. (Addresses already follow this scheme too) | `address_street_la/_ar`, `father_first_name_la/_ar`, `contact_last_name_la/_ar` |

`_la` is deliberately not `_en`: a Latin-script name is not an English translation
(e.g. `Boulahia`, `بن لحية`). French users read the Latin form.

Rule of thumb applied below: **controlled vocabulary / labels -> A**, **person
names -> B**. Every attribute is still listed separately so the choice can be
changed per attribute. During review, `student_detail.student_ecn_school_name` was
explicitly confirmed as a label (scheme A) even though it names a school.

> **Later change —** `student_detail.student_ecn_school_name` (and its `_en/_ar/_fr`
> columns) has since been **removed**. Who recruited a student is now the
> `recruitment_source` lookup (`recruitment_source_id`, `recruitment_source_code`,
> `recruitment_source_label_en/_ar/_fr`) referenced by
> `student_detail.student_recruitment_source_id` — see
> `migration_recruitment_source.sql`. `student_detail.student_country_id` is gone
> too, so the i18n list below has 30 scheme-A attributes rather than 31; it is kept
> as the record of the review, not as the current schema.
>
> **Later change —** `person_history` (and its `after_person_update_history`
> trigger and `after_person_update_history_func()` function) has since been
> **removed** by `deploy/server/23-drop-person-history.sql`. No application code
> read the table; name changes are covered by `audit_log`. The two
> `person_history` rows below are kept as the record of the review, not as the
> current schema.

## Already multilingual — no action needed

| Table | Columns |
| --- | --- |
| `military_grade` | `military_grade_label_en/_ar/_fr`, `military_grade_name_en/_ar/_fr`, `military_grade_type_en/_ar/_fr` |
| `army` | `army_label_en/_ar/_fr`, `army_name_en/_ar/_fr` |
| `country` | `country_name_en/_ar/_fr` |
| `wilaya` | `wilaya_name_en/_ar/_fr` |
| `daira` | `daira_name_en/_ar/_fr` |
| `commune` | `commune_name_en/_ar/_fr` |
| `address` | `address_street_la`, `address_street_ar` |
| `punishment_type` | `punishment_label_en/_ar/_fr` |
| `reward_type` | `reward_label_en/_ar/_fr` |
| `health_status` | `health_status_en/_ar/_fr` |
| `hobby` | `hobby_name_en/_ar/_fr` |
| `profession` | `profession_name_en/_ar/_fr` |
| `relation` | `relation_name_en/_ar/_fr` |
| `educational_certificate` | `educational_certificate_label_en/_ar/_fr` |
| `academic_level` | `academic_level_en/_ar/_fr` |
| `student_speciality` | `speciality_name_en/_ar/_fr` |
| `changelog` | `title_en/_ar/_fr` |
| `feature` | `feature_text_en/_ar/_fr` |
| `student_parent_info` | `father_first_name_la/_ar`, `father_last_name_la/_ar`, `mother_first_name_la/_ar`, `mother_last_name_la/_ar` |
| `student_emergency_contact` | `contact_first_name_la/_ar`, `contact_last_name_la/_ar` |

## Nominated attributes

### A. Reference labels — confirmed `_en` + `_ar` + `_fr`

| # | Table | Current attribute | Note |
| --- | --- | --- | --- |
| 1 | `role` | `role_label` | Roles are seeded from `role_code` (`ADMIN`, `TEACHER`, ...) |
| 2 | `permission` | `permission_label` | Permission names shown in admin screens |
| 3 | `absence_justification` | `absence_justification_label` | Seeded vocabulary (`EXCUSED`, `MEDICAL`, ...) |
| 4 | `academic_grade` | `academic_grade_label` | Lookup, distinct from `military_grade` |
| 5 | `observation_motif` | `observation_motif_label` | Seeded vocabulary (`LATE`, `DISRUPTIVE`, ...) |
| 6 | `direction` | `direction_label` | Administrative unit name |
| 7 | `department` | `department_label` | Administrative unit name |
| 8 | `service` | `service_label` | Administrative unit name |
| 9 | `major_category` | `major_category_label` | Academic taxonomy |
| 10 | `major` | `major_label` | Academic taxonomy |
| 11 | `teaching_category` | `teaching_category_label` | Academic taxonomy |
| 12 | `promotion` | `promotion_label` | Academic taxonomy |
| 13 | `section` | `section_label` | Section name |
| 14 | `section` | `section_description` | Displayed on the Sections page; optional but same audience |
| 15 | `teaching_section` | `teaching_section_label` | Teaching-section name |
| 16 | `classroom_category` | `classroom_category_label` | Room category (Amphi, Lab, ...) |
| 17 | `classroom` | `classroom_label` | Room name (Amphi A, Salle 12, ...) |
| 18 | `study_year` | `study_year_label` | Calendar label |
| 19 | `study_semester` | `study_semester_label` | Calendar label |
| 20 | `study_week` | `study_week_label` | Calendar label |
| 21 | `teaching_group` | `teaching_group_label` | Group name (Group A, ...) |
| 22 | `study_session_type` | `study_session_type_label` | Lecture / Practical / Seminar |
| 23 | `examination_type` | `examination_type_label` | Written / Practical / Oral |
| 24 | `examination` | `examination_label` | Exam title shown to students and guards |
| 25 | `examination_group` | `examination_group_label` | Shuffled exam group name |
| 26 | `document_type` | `document_type_label` | PDF / Word / Image |
| 27 | `document` | `document_label` | Uploaded file title |
| 28 | `chapter` | `chapter_label` | Course chapter title |
| 29 | `lesson` | `lesson_label` | Lesson title |
| 30 | `student_military_certificate` | `military_certificate_label` | edutrack models this as a `military_certificate` lookup with `_en/_ar/_fr`; this inline column should follow the same three-label scheme (and can later be normalised into that lookup) |
| 31 | `student_detail` | `student_ecn_school_name` | Name of a school; confirmed as a translated label rather than a proper name |

### B. Person names — confirmed `_la` + `_ar`

| # | Table | Current attribute | Note |
| --- | --- | --- | --- |
| 32 | `person` | `person_first_name` | Same treatment as the parent/contact names already in the schema |
| 33 | `person` | `person_last_name` | Same |
| 34 | `person_history` | `old_first_name` | **Removed** with the table; the row is kept as review history |
| 35 | `person_history` | `old_last_name` | **Removed** with the table; the row is kept as review history |

## Columns deliberately not nominated

These hold **content typed by users**, a **single snapshot**, or a **machine code**;
duplicating them per language would create three divergent copies of the same record:

- `bug_report.report_subject`, `report_description`, `resolution_note`
- `message.message_subject`, `message_body`
- `direct_message.message_body`
- `beta_test_report.overall_comment`, `beta_test_feature.feature_text`, `description`
- `secretary_punishes_student.punishment`, `punishment_note`
- `secretary_rewards_student.reward_note`
- `director_comment.comment_text`
- `student_gets_absent.teacher_absence_note`
- `student_undergoes_observation_by_teacher.teacher_observation_note`
- `app_option.option_value`
- all `*_code`, `*_id`, `system_action`, `*_status`, `*_priority`, `person_sex`,
  and the enum-like flags on `student_detail` (`student_blood_type`,
  `student_parents_situation`, `student_orphan_status`,
  `student_military_necklace`). Two former entries here have since stopped being
  text: `student_is_foreign` is a boolean and `student_recruitment_source` is a
  foreign key to the `recruitment_source` lookup (see
  `migration_student_is_foreign_boolean.sql` and
  `migration_recruitment_source.sql`).

## Conventions kept in the implementation

1. `*_code` remains the stable unique key; translated labels are **not** unique
   (two values can legitimately share a label).
2. The old single-language column is kept as a **`STORED GENERATED` alias** of
   the new columns (`COALESCE(_en, _ar, _fr)` / `COALESCE(_la, _ar)`), so every
   existing query, report and `ORDER BY` keeps working and can be switched to
   the explicit language columns later without a flag day.
3. `_ar` and `_fr` are nullable; `_en`/`_la` mirror today's nullability.
4. `person_history` and its trigger wrote the same pair of name columns as
   `person`; the table has since been dropped (see the note at the top).
5. The application writes only the explicit language columns; the generated
   base column rejects direct writes, which is what catches a forgotten path.

## Decisions log

All 35 attributes were reviewed. Final outcome:

- **Scheme A (`_en` + `_ar` + `_fr`) — 31 attributes:** all reference labels
  (#1-#31 above), including `direction`/`department`/`service`, `classroom_label`,
  `document_label`, `military_certificate_label` and
  `student_detail.student_ecn_school_name`.
- **Scheme B (`_la` + `_ar`) — 4 attributes:** `person.person_first_name`,
  `person.person_last_name`, `person_history.old_first_name`,
  `person_history.old_last_name` (the two `person_history` entries have since
  been dropped with the table).

No attribute was left on a single-language column.

## Implementation status

Applied in this change:

- **Schema** — `eNote_pg.sql` (fresh installs) and `migration_student_profile.sql`
  define the new columns plus the generated alias (`student_ecn_school_name` was
  part of this and has since been removed — see the note above);
  the seed data for roles, document types, session types, examination types,
  absence justifications and observation motifs carries all three languages.
- **Migration** — `migration_i18n_attributes.sql` converts an existing database:
  it adds the language columns, backfills the current value into `_en`/`_la`,
  replaces the old column with the generated alias, recreates `v_person` and
  rewrote `after_person_update_history_func()` (the trigger and its function
  have since been dropped — see the note at the top). It is idempotent, wrapped
  in a transaction, skips tables that do not exist yet, and only fills
  translations that are still empty. **Applied to the local `eNote` database on
  2026-10-22** (pre-migration backup: `backup_eNote_before_i18n.sql`); 34
  generated aliases are live, and reference labels gained their Arabic/French
  values. Rows created through the application afterwards get their missing
  labels from `fill_i18n_reference_translations.sql` (idempotent, only writes
  empty cells), reversed by `revert_i18n_reference_translations.sql` if needed.
- **Main process** — every create/update path writes the language columns
  (`academicService`, `examinationService`, `documentService`, `personService`,
  `profileService`, `studentReportService`), with legacy-key shims for older
  callers. The person-history trigger recorded both name variants until it was
  dropped.
- **Reference labels at runtime** — `localization.js` rewrites alias columns from
  the `_en` / `_ar` / `_fr` / `_la` columns returned by a query. Queries that
  select only the generated alias (joined labels such as `m.MAJOR_LABEL`, or an
  aggregate) have no variants to switch, so `labelCatalog.js` indexes every
  migrated reference attribute from `information_schema` by primary key and by
  label value and resolves those aliases too. The catalog is built lazily (one
  pass over the reference tables), reuses the exact rows the database holds and
  is dropped when a label table is written, so an administrator's edit is
  visible on the next read. Multi-value strings (exam group lists, exam room
  lists, statistics chart labels) select their `_ar` / `_fr` variants explicitly
  and are localized by the same rule.
- **Renderer** — `ui/LocalizedInput.jsx` renders the three (or two) inputs in one
  row with `dir="rtl"` for Arabic; all reference-data forms and the person forms
  use it, and require the primary language before saving.

## UI language switch (English / العربية / Français)

Implemented as a device-local preference, like the light/dark theme:

- `src/renderer/i18n/` holds the runtime (`I18nProvider`, `useI18n`, `t`) and the
  `ar` / `fr` dictionaries. English is the key language: a missing translation
  falls back to the English text.
- `src/renderer/components/ui/LanguageToggle.jsx` is the header button (also on
  the sign-in and landing pages). Choosing a language stores it in
  `localStorage` (`enote-language`), sets `<html lang>` / `<html dir>` (RTL for
  Arabic) and re-mounts the screen tree so every page reloads its data.
- Database labels: `src/main/localization.js` receives the choice through the
  `i18n:setLanguage` IPC channel and rewrites alias columns (`country_name`,
  `section_label`, ...) from the matching `_en` / `_ar` / `_fr` (or `_la` / `_ar`)
  value before rows reach the renderer. Display code that reads an explicit
  `_EN` column uses `localizedLabel(row, 'BASE')` instead, which prefers the
  active language and keeps form fields (`_EN` inputs) untouched.
- Interface coverage: the application shell (sidebar, header, status), sign-in
  and landing pages, dashboard, shared UI components (dialogs, paging, filters,
  empty states) and every page body — 1,485 dictionary entries (batches
  `ar-1`…`ar-8`, `fr-1`…`fr-8`) covering all 1,347 strings referenced through
  `tr()` / `t()`. That includes status words and messages that live inside
  JavaScript expressions (ternaries such as `busy ? tr('Saving…') : …`,
  `showMessage`/`setError`/`setNotice` text, `label`/`title`/`hint` objects and
  weekday arrays), not only JSX text. Option lists declared as module-level
  constants are translated where they render (`tr(item.label)`), because a
  `tr()` call in a module constant would freeze the first language.
- Still inline English: messages produced by the main process (validation
  errors such as "Conversation not found.") are built from SQL/domain logic and
  reach the renderer through `err.message`; `tr()` only falls back to English
  for text it never sees.
- Person names joined into a display string (`INSTRUCTOR_NAME`, `STUDENT_NAME`)
  are Latin-script names (`_la`) and are not switched to the Arabic spelling;
  rows that select `PERSON_FIRST_NAME` / `PERSON_LAST_NAME` with their `_AR`
  variants are localized as usual.
