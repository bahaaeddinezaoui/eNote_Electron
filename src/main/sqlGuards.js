import { query } from './db'

// PostgreSQL refuses CREATE INDEX and ALTER TABLE to any role that does not own
// the table — even when the statement would change nothing ("must be owner of
// table ...", "doit être le propriétaire de la table ..."). A LAN installation
// is initialized by postgres and then used by enote_app, so the runtime "make
// sure the tables exist" steps must not fail because of that refusal: the schema
// is already usable, only the index or the column addition is left to whoever
// owns the table (see deploy/server/*.sql).

export function isPrivilegeError(error) {
  const code = error?.code || error?.originalError?.code
  const text = String(error?.message || '')
  return code === '42501' ||
    /must be owner|propri[eé]taire|permission denied|no privileges|not the owner/i.test(text)
}

// Runs schema DDL that only the table owner may run. A privilege refusal is
// reported and swallowed so the feature still opens; every other failure still
// throws, because a genuinely broken statement must never pass silently.
export async function tryDdl(sql, params = []) {
  try {
    return await query(sql, params)
  } catch (error) {
    if (isPrivilegeError(error)) {
      console.warn(
        'Skipped a schema statement because the database role does not own the table:',
        error.message
      )
      return null
    }
    throw error
  }
}
