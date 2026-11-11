import {
  LayoutDashboard,
  IdCard,
  Gavel,
  Calendar,
  Award,
  FileText,
  Users,
  BarChart3,
  GraduationCap,
  Tags,
  Layers,
  DoorOpen,
  Tag,
  ScrollText,
  Crown,
  UserX,
  Notebook,
  Bell,
  History,
  Activity,
  ClipboardList,
  Bug,
  Database,
  FlaskConical,
  Inbox,
  MessageSquare,
  UserRound,
  Settings,
  UserCog,
  FileBadge,
  CalendarDays,
  CalendarRange,
  BookMarked,
  BookOpen,
  Power,
  Lock,
  UserCheck,
  ListChecks,
  MonitorSmartphone
} from 'lucide-react'

// One source of truth for navigation: the sidebar, the command palette and the
// breadcrumb all read from here, so a route is never reachable in one place and
// invisible in another.
export function buildNav(user) {
  const roles = user?.roles || []
  const isAdmin = roles.includes('ADMIN')
  const isDev = roles.includes('DEVELOPER')
  const isTeacher = roles.includes('TEACHER')
  const isStudent = roles.includes('STUDENT')
  const isDirector = roles.includes('DIRECTOR')
  const isSecretary = roles.includes('SECRETARY')
  const isScheduler = roles.includes('SCHEDULER')

  const groups = []

  // Where a working day starts: the home screen and the way people talk to
  // each other. Inbox and Notifications are pinned in the sidebar footer for
  // every role that can read them, so they are not repeated here.
  const workspace = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/messages', label: 'Direct messages', icon: MessageSquare, badgeKey: 'direct' }
  ]
  groups.push({ id: 'workspace', label: 'Workspace', open: true, items: workspace })

  // The student as a file: who they are, the read-only view of the same
  // records, what was written about their conduct, and their past.
  const students = []
  if (isAdmin || isSecretary || isTeacher || isDirector) {
    students.push({ to: '/student-records', label: 'Student directory', icon: IdCard })
  }
  // The read-only records view is open to Directors and to Admins, who
  // oversee every role and must be able to consult the same pages.
  if (isDirector || isAdmin) {
    students.push({ to: '/records', label: 'Records · read-only', icon: ClipboardList })
  }
  if (isAdmin || isSecretary) {
    students.push({ to: '/rewards-punishments', label: 'Rewards & punishments', icon: Gavel })
  }
  if (isDirector || isAdmin) {
    students.push({ to: '/student-history', label: 'Student history', icon: History })
  }
  if (students.length) groups.push({ id: 'students', label: 'Students', open: true, items: students })

  // The classroom itself: the timetable someone teaches or follows, the
  // material of the course, what a teacher records while teaching it, and the
  // marks that come out of it.
  const teaching = []
  if (isTeacher) teaching.push({ to: '/teacher-schedule', label: 'My schedule', icon: Calendar })
  if (isStudent) teaching.push({ to: '/student-schedule', label: 'My schedule', icon: Calendar })
  if (isAdmin || isTeacher || isStudent) {
    teaching.push({ to: '/lessons', label: 'Lessons', icon: FileText })
  }
  // The Library: books, novels, lessons and videos that belong to the school
  // rather than to one lesson. A Director reads it for oversight; only a
  // Teacher or an Admin adds to it.
  if (isAdmin || isDev || isTeacher || isStudent || isDirector) {
    teaching.push({
      to: '/library',
      label: 'Library',
      icon: BookOpen,
      // Only an administrator has a review queue to be counted.
      ...(isAdmin ? { badgeKey: 'library' } : {})
    })
  }
  if (isTeacher) teaching.push({ to: '/absences', label: 'Attendance', icon: UserX })
  if (isTeacher) teaching.push({ to: '/observations', label: 'Observations', icon: Notebook })
  if (isAdmin || isScheduler) teaching.push({ to: '/exams', label: 'Exams', icon: FileBadge })
  if (isAdmin || isScheduler || isTeacher) {
    teaching.push({ to: '/exam-marks', label: 'Exam marks', icon: Award })
  }
  if (isStudent) teaching.push({ to: '/student-marks', label: 'My marks', icon: Award })
  if (teaching.length) groups.push({ id: 'teaching', label: 'Teaching', open: true, items: teaching })

  // The institution seen from above: the timetable everybody runs on, whether
  // the sessions actually happened, and the trends behind both.
  const oversight = []
  if (isAdmin || isScheduler) {
    oversight.push({ to: '/schedule', label: 'Master schedule', icon: CalendarDays })
  }
  // A week's sessions with their absences and observations.
  if (isAdmin || isDirector) {
    oversight.push({ to: '/session-records', label: 'Session records', icon: CalendarRange })
  }
  // Whether teachers took the sessions the schedule gave them.
  if (isAdmin || isDirector) {
    oversight.push({ to: '/teacher-attendance', label: 'Teacher attendance', icon: UserCheck })
  }
  if (isAdmin || isDirector) {
    oversight.push({ to: '/global-history', label: 'Global history', icon: Activity })
  }
  if (isAdmin) oversight.push({ to: '/statistics', label: 'Statistics', icon: BarChart3 })
  if (oversight.length) {
    groups.push({ id: 'oversight', label: 'Oversight', open: false, items: oversight })
  }

  // The structure everything else is built on: the calendar, the course tree
  // and the sections inside it. The six vocabulary registers that used to live
  // here — teaching categories, classrooms, session types, exam types, grades
  // and academic grades — are edited from Settings now, where they read as part
  // of one reference list instead of six separate destinations.
  if (isAdmin) {
    groups.push({
      id: 'academic-setup',
      label: 'Academic setup',
      open: false,
      items: [
        { to: '/academic', label: 'Academic years', icon: GraduationCap },
        { to: '/majors', label: 'Majors', icon: BookMarked },
        { to: '/sections', label: 'Sections', icon: Layers },
        { to: '/promotions', label: 'Promotions', icon: Layers }
      ]
    })
  }

  // Who the people are and what they may sign in as: one group, because an
  // account without its person (or a person without an account) is exactly the
  // state these four screens exist to fix. A developer reaches the accounts
  // themselves — the account service grants that role — while the person
  // register, the secretaries and the suspensions stay admin work.
  if (isAdmin || isDev) {
    const accountItems = []
    if (isAdmin) accountItems.push({ to: '/teachers', label: 'People', icon: Users })
    accountItems.push({ to: '/accounts', label: 'Accounts', icon: Power })
    if (isAdmin) {
      accountItems.push(
        { to: '/secretaries', label: 'Secretary & scheduler accounts', icon: UserCog },
        { to: '/suspended-accounts', label: 'Suspended accounts', icon: Lock }
      )
    }
    groups.push({
      id: 'accounts',
      label: 'Accounts & access',
      open: false,
      items: accountItems
    })
  }

  const support = [
    { to: '/report-bug', label: 'Report a bug', icon: Bug },
    { to: '/my-bug-reports', label: 'My bug reports', icon: ListChecks }
  ]
  if (isAdmin || isDev) support.push({ to: '/bug-reports', label: 'Bug reports', icon: ClipboardList })
  // The audit trail: sign-ins, permission changes and record changes, for the
  // two roles that are accountable for the application itself.
  if (isAdmin || isDev) support.push({ to: '/audit-log', label: 'Activity log', icon: ScrollText })
  support.push({ to: '/changelog', label: 'Changelog', icon: History })
  // The diagnostic console: connections, tables and read-only inspection. It
  // belongs to the two roles that maintain the application itself.
  if (isAdmin || isDev) support.push({ to: '/database', label: 'Database', icon: Database })
  if (user?.isBetaTester) support.push({ to: '/beta-tests', label: 'Beta tests', icon: FlaskConical })
  if (isAdmin || isDev) support.push({ to: '/beta-test-reports', label: 'Beta test reports', icon: Activity })
  groups.push({ id: 'support', label: 'Support', open: false, items: support })

  return groups
}

// Flat route list for the palette and breadcrumb. The destinations pinned in
// the sidebar footer are pages like any other — hiding them from this list would
// take Inbox, Notifications, Settings and Profile out of the command palette.
export function allRoutes(user) {
  const seen = new Set()
  const routes = []
  const add = (item, group) => {
    if (!item?.to || seen.has(item.to)) return
    seen.add(item.to)
    routes.push({ ...item, group })
  }
  for (const group of buildNav(user)) {
    for (const item of group.items) add(item, group.label)
  }
  for (const item of sidebarFooterItems(user)) {
    add(item, ['/settings', '/profile'].includes(item.to) ? 'Settings' : 'Workspace')
  }
  return routes
}

// Settings → Locked pages is administered by an Admin, but a lock is global:
// it has to reach the pages only a student, a teacher or a director opens.
// Those pages are absent from the Admin's own navigation, so the lock list is
// built from every role at once instead of from the signed-in account.
const ALL_ROLES = ['ADMIN', 'DEVELOPER', 'TEACHER', 'STUDENT', 'DIRECTOR', 'SECRETARY', 'SCHEDULER']
const EVERY_ROLE_USER = { roles: ALL_ROLES, isBetaTester: true }

export function lockableRoutes() {
  return allRoutes(EVERY_ROLE_USER)
}

export const SETTINGS_ITEMS = [
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/profile', label: 'Profile', icon: UserRound }
]

// The sidebar footer, next to Settings and Profile: the account's own
// communication screens. Notifications and the inbox are opened many times a
// day and currently sit inside a collapsed group (a student has no
// notifications link at all), so they are pinned here for every role that can
// open them.
export function sidebarFooterItems(user) {
  const roles = user?.roles || []
  // Mail is addressed to roles, and reading it only needs a signed-in account,
  // so a developer is a recipient like the four staff roles and must be able to
  // open the page its mail points at.
  const canReadInbox = roles.some((role) =>
    ['ADMIN', 'SECRETARY', 'DIRECTOR', 'TEACHER', 'DEVELOPER'].includes(role)
  )
  return [
    { to: '/notifications', label: 'Notifications', icon: Bell },
    ...(canReadInbox ? [{ to: '/inbox', label: 'Inbox', icon: Inbox, badgeKey: 'inbox' }] : []),
    // Every signed-in account may read and end its own sessions; the page also
    // carries the all-accounts view for an Admin or an allowed Developer.
    { to: '/sessions', label: 'Sessions', icon: MonitorSmartphone },
    ...SETTINGS_ITEMS
  ]
}

