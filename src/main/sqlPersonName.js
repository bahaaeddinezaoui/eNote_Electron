// Person names in SQL, in one place.
//
// The person table has no `person_first_name`: each name is stored twice, as
// `person_first_name_la` (the Latin form) and `person_first_name_ar` (the Arabic
// one), and the same for the last name. A query that reads the bare column fails
// with 42703 and takes the page that ran it down with it, so joins build the name
// through these helpers instead.
//
//   ${personFullName('p')} AS INSTRUCTOR_NAME   one column, Latin first
//   ${personNameColumns('p', 'STUDENT_NAME')}   base + language variants, which
//                                               localizeRows() translates
//
// The Latin form falls back to the Arabic one, so a person recorded only in
// Arabic still has a name to print.

const pick = (alias, column) =>
  `COALESCE(NULLIF(${alias}.PERSON_${column}_LA, ''), ${alias}.PERSON_${column}_AR, '')`

const latinPick = (alias, column) => `COALESCE(${alias}.PERSON_${column}_LA, '')`
const arabicPick = (alias, column) => `COALESCE(${alias}.PERSON_${column}_AR, '')`

export const personFullName = (alias) =>
  `(${pick(alias, 'FIRST_NAME')} || ' ' || ${pick(alias, 'LAST_NAME')})`

// Base name plus both language variants: localizeRow() overwrites the base with
// the interface language and names the other form in brackets, exactly as it
// does for rows selected with `person.*`.
export const personNameColumns = (alias, name) => `${personFullName(alias)} AS ${name},
      ${latinPick(alias, 'FIRST_NAME')} || ' ' || ${latinPick(alias, 'LAST_NAME')} AS ${name}_LA,
      ${arabicPick(alias, 'FIRST_NAME')} || ' ' || ${arabicPick(alias, 'LAST_NAME')} AS ${name}_AR`
