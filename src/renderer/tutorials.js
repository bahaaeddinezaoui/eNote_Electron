// Tutorial videos, one folder per role.
//
// The files ship with the application (see assets/tutorials/README.md), so they
// are collected at build time rather than fetched: `import.meta.glob` with
// `eager` turns each matching file into a URL Vite copies into the bundle, which
// means dropping a video into a role folder is enough to have it appear — no
// list to update and no chance of naming a file that is not there.
//
// A role with no file is not removed from the list: it keeps its place and the
// page shows a placeholder, so the section has the same shape before and after
// the recordings exist.

const TUTORIAL_FILES = import.meta.glob('./assets/tutorials/*/*.{mp4,webm,m4v,mov,ogv,ogg}', {
  eager: true,
  query: '?url',
  import: 'default'
})

// The role table's codes, in the order the page presents them.
export const TUTORIAL_ROLES = [
  {
    slug: 'administrator',
    code: 'ADMIN',
    label: 'Administrator',
    summary: 'Accounts, settings and the academic structure everything else hangs from.'
  },
  {
    slug: 'director',
    code: 'DIRECTOR',
    label: 'Director',
    summary: 'Absences, observations, sessions and the records kept about them.'
  },
  {
    slug: 'secretary',
    code: 'SECRETARY',
    label: 'Secretary',
    summary: 'Student files, rewards and punishments for the categories you manage.'
  },
  {
    slug: 'scheduler',
    code: 'SCHEDULER',
    label: 'Scheduler',
    summary: 'Weekly timetables, rooms, session types and examinations.'
  },
  {
    slug: 'teacher',
    code: 'TEACHER',
    label: 'Teacher',
    summary: 'Your sessions, attendance, observations and exam marks.'
  },
  {
    slug: 'student',
    code: 'STUDENT',
    label: 'Student',
    summary: 'Your timetable, marks, lessons and messages.'
  },
  {
    slug: 'developer',
    code: 'DEVELOPER',
    label: 'Developer',
    summary: 'Bug reports, beta test reports and release notes.'
  }
]

const nameOf = (path) => String(path).split('/').pop() || ''

const roleVideos = new Map()
for (const [path, url] of Object.entries(TUTORIAL_FILES)) {
  const match = path.match(/tutorials\/([^/]+)\/([^/]+)$/)
  if (!match) continue
  const [, slug, file] = match
  if (!roleVideos.has(slug)) roleVideos.set(slug, [])
  roleVideos.get(slug).push({ url, name: nameOf(file), file })
}

// File-name order, so numbered clips ("01-introduction.mp4") play in the order
// the author numbered them.
for (const list of roleVideos.values()) {
  list.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }))
}

export function getTutorialRoles() {
  return TUTORIAL_ROLES.map((role) => ({
    ...role,
    videos: roleVideos.get(role.slug) || []
  }))
}
