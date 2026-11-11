import { TUTORIAL_ROLES } from './tutorials'

// Step-by-step guides, one per page, written for the roles that use it.
//
// A guide is a short summary plus ordered steps. A step is either a plain
// string (shown to every role that can open the page) or `{ text, roles }`,
// shown only to those role codes. The dialog the header opens filters the list
// with the signed-in account's roles, so the same page reads differently for an
// administrator and for a secretary without duplicating the whole guide.
//
// Keys are route paths. Every path in nav.js has a guide here; a route without
// one simply shows no Guide button.

const ADMIN = 'ADMIN'
const DEV = 'DEVELOPER'
const DIRECTOR = 'DIRECTOR'
const SECRETARY = 'SECRETARY'
const SCHEDULER = 'SCHEDULER'
const TEACHER = 'TEACHER'
const STUDENT = 'STUDENT'

const GUIDES = {
  '/': {
    title: 'Overview',
    summary: 'What needs your attention today, and the figures behind it.',
    steps: [
      'Read the figure strip first: each cell is a link to the page behind the number.',
      'Check the work queue for rows that need you — sessions without a record, students without a section, exams without marks.',
      {
        text: 'The figures cover the whole registry, and "Register student" opens the Student directory with the new-student form already open.',
        roles: [ADMIN]
      },
      {
        text: 'The figures count only the categories assigned to you, and "Register student" opens the directory ready for a new file.',
        roles: [SECRETARY]
      },
      {
        text: 'The figures cover every record in the registry; open a row to read the absences, observations and sessions behind it.',
        roles: [DIRECTOR]
      },
      {
        text: 'Your figures are your own timetable, documents and marks rather than the administrative totals.',
        roles: [TEACHER, STUDENT]
      },
      'The bell, the inbox and the message buttons in the title bar carry anything that arrived while you were working.'
    ]
  },

  '/inbox': {
    title: 'Inbox',
    summary: 'One-way mail addressed to you, and the mail you send to roles.',
    steps: [
      'Open a message to read it; the badge counts the ones you have not seen yet.',
      'Use "New message" to address every active account of the roles you choose. Your own account is never included.',
      {
        text: 'You may write to every role your account can reach; the message is delivered to each active account holding it.',
        roles: [ADMIN, DIRECTOR, SECRETARY]
      },
      {
        text: 'Mail addressed to teachers arrives here; use Direct messages when the exchange needs an answer.',
        roles: [TEACHER]
      },
      'Read a message and it is marked seen; "Mark all seen" clears the badge in one go.',
      'Inbox mail is one-way: recipients cannot reply. Use Direct messages when you need a conversation.'
    ]
  },

  '/messages': {
    title: 'Direct messages',
    summary: 'Conversations with the people the contact matrix lets you reach.',
    steps: [
      'Pick a conversation on the left; the thread opens on the right.',
      'Type in the composer and send — the other person sees it on their next refresh.',
      'The title-bar message button and the sidebar entry share the same unread count.',
      {
        text: 'Who may start a conversation with whom is decided in Settings → Message permissions; as an administrator you can change it there.',
        roles: [ADMIN]
      },
      {
        text: 'You can start a conversation only with the roles the matrix allows you to reach; the permitted contacts are listed when you compose.',
        roles: [TEACHER, STUDENT, SECRETARY, DIRECTOR, SCHEDULER]
      }
    ]
  },

  '/student-records': {
    title: 'Student directory',
    summary: 'The register of students, their sections and their files.',
    steps: [
      'Search by name or reference, or filter by teaching category and section.',
      'Select a row to read the inspector on the right; right-click a row for the actions your role allows.',
      {
        text: 'Use "Register new student" for the full file: identity, address, contacts, hobbies and section.',
        roles: [ADMIN, SECRETARY]
      },
      {
        text: 'A secretary sees and edits only the students inside the categories an administrator assigned to them.',
        roles: [SECRETARY]
      },
      {
        text: '"Assign section" moves a student between sections, and deletion is refused while student deletion is turned off in Settings.',
        roles: [ADMIN]
      },
      {
        text: 'You read the file of a student you teach; registering, assigning and deleting are administrative actions and are not offered to teachers.',
        roles: [TEACHER]
      },
      {
        text: 'Read a student’s file and open their history from here; corrections belong to the administration or to the secretary of the category.',
        roles: [DIRECTOR]
      },
      'Export CSV writes the rows currently in view.'
    ]
  },

  '/records': {
    title: 'Records · read-only',
    summary: 'A week of sessions and the records kept against them, for oversight.',
    steps: [
      'Choose a year, a semester and a week; that week’s sessions are listed.',
      'Filter the list by day, major and teacher to narrow it down.',
      'Open a session to read its absences and observations, and the comments left on them.',
      {
        text: 'Comment on an absence or an observation from its line; every director reads the same thread.',
        roles: [DIRECTOR]
      },
      {
        text: 'You read the same records as a director; adding a comment is a director privilege, so the comment box is not offered here.',
        roles: [ADMIN]
      },
      'Nothing is edited from this page: records are entered by teachers on their own pages.'
    ]
  },

  '/rewards-punishments': {
    title: 'Rewards & punishments',
    summary: 'Rewards and punishments recorded against a student or a group.',
    steps: [
      'Search for a student on the left; only students in the categories your account may act on are listed.',
      {
        text: 'Every category is open to you, and the conduct rights of each secretary are managed in Secretary accounts.',
        roles: [ADMIN]
      },
      {
        text: '"New entry" records a reward or a punishment for a student in your categories; each action follows the conduct rights set for your account.',
        roles: [SECRETARY]
      },
      'Choose Rewards or Punishments, then "New entry" to record the type, the reason, the date and a comment.',
      'Switch to the group tab to apply the same entry to several students at once with "Add all".',
      'Existing entries can be edited or deleted from the student panel; your rights are re-checked for each action.'
    ]
  },

  '/schedule': {
    title: 'Master schedule',
    summary: 'The weekly timetable every section follows.',
    steps: [
      'Choose a study year, a semester and a week; the grid fills with the sessions placed that week.',
      'Open "Volume" to set a group’s target hours and read the hours its sessions have already scheduled, by session type and by section.',
      'Use "Create session" to place a session in a free slot: type, teacher, room and group.',
      {
        text: 'You can change any group’s week; the study year, semester and weeks a timetable hangs from are built on Academic years.',
        roles: [ADMIN]
      },
      {
        text: 'You build and correct the timetable of the teaching categories an administrator gave you; a session or group outside them is refused.',
        roles: [SCHEDULER]
      },
      'Delete a session from its cell; teachers and students see the change on their own schedules.'
    ]
  },

  '/session-records': {
    title: 'Session records',
    summary: 'What teachers recorded for each session of a week.',
    steps: [
      'Choose a year, a semester and a week to load that week’s sessions.',
      'Search by student, teacher or session to find a specific record.',
      'Open a session to read its absences and observations, and to confirm the session was held.',
      {
        text: 'Comment on an absence or an observation from its line; every director reads the same thread.',
        roles: [DIRECTOR]
      },
      {
        text: 'You read the same records and the director comments on them; the comment box is a director privilege.',
        roles: [ADMIN]
      },
      'Use "Export report" to print the week for review.'
    ]
  },

  '/teacher-attendance': {
    title: 'Teacher attendance',
    summary: 'Whether teachers took the sessions the timetable gave them.',
    steps: [
      'Choose a study period to load the report.',
      '"Filter by teacher" narrows it to one member of staff; clear it to see the whole staff.',
      'Read the mark per session: held, missed, or not yet decided.',
      {
        text: 'Every member of staff is included; narrow to one teacher before following up a session that was not held.',
        roles: [ADMIN]
      },
      {
        text: 'Use the report to review the week; teachers confirm their own sessions from My schedule.',
        roles: [DIRECTOR]
      }
    ]
  },

  '/teacher-schedule': {
    title: 'My schedule',
    summary: 'Your own teaching sessions for the week.',
    steps: [
      'Choose a week at the top; the grid shows your sessions with their rooms and groups.',
      'Open a session to see the students expected in it.',
      'Use it to confirm a session you held, or to see what closes next.',
      'Attendance opens on its own when a session starts.'
    ]
  },

  '/student-schedule': {
    title: 'My schedule',
    summary: 'The classes scheduled for your section.',
    steps: [
      'Choose a week at the top to see that week’s classes.',
      'Each cell shows the session type, the room and the teacher.',
      'A week with no classes is explained under the grid; choose another week above.'
    ]
  },

  '/exams': {
    title: 'Exams',
    summary: 'The examinations scheduled per major, with their seating.',
    steps: [
      'Choose the study year and semester, then a major.',
      'Use "Add Examination" to schedule one: type, date, classroom and coefficient.',
      '"Manage seating" shuffles students into exam groups and assigns the room seats.',
      {
        text: 'Scheduling and seating are your work here; the study year and its semesters come from Academic years.',
        roles: [SCHEDULER]
      },
      {
        text: 'An administrator can lock mark editing in Settings; that lock does not stop you scheduling or seating an exam.',
        roles: [ADMIN]
      },
      'Conflicts and missing data are flagged in the list before the exam takes place.'
    ]
  },

  '/exam-marks': {
    title: 'Exam marks',
    summary: 'Enter or review marks per exam; the semester average follows the coefficients.',
    steps: [
      {
        text: 'Choose the exam, type the marks into each student’s row, then press "Save Marks".',
        roles: [TEACHER]
      },
      {
        text: 'Switch between Marks and Semester Averages to review a whole major.',
        roles: [ADMIN, SCHEDULER]
      },
      {
        text: 'Typing the marks is the teacher’s job; you review the result per major before it is locked.',
        roles: [SCHEDULER]
      },
      'A blank mark is excluded from the average rather than counted as zero.',
      'An administrator can lock mark editing in Settings; while locked this page is read-only.'
    ]
  },

  '/student-marks': {
    title: 'My marks',
    summary: 'Your marks, the major averages and your semester mark.',
    steps: [
      'Choose a study year and a semester; your marks appear grouped by exam.',
      'The summary at the top carries the semester mark and the averages.',
      'A mark that has not been entered shows as a dash and is excluded from the average.'
    ]
  },

  '/lessons': {
    title: 'Lessons',
    summary: 'Lesson files: slides, handouts, images and recorded sessions.',
    steps: [
      'Open a lesson from the list to read its description and its files.',
      'Videos play inside the page; slides, handouts and images open or download.',
      {
        text: 'Use "Add files" to upload slides, handouts, images or a recorded session to the lesson.',
        roles: [ADMIN, TEACHER]
      },
      {
        text: 'Delete a file from the lesson to withdraw it for every student.',
        roles: [ADMIN, TEACHER]
      },
      {
        text: 'You read and play the files your teachers publish; only staff add or withdraw them.',
        roles: [STUDENT]
      }
    ]
  },

  '/library': {
    title: 'Library',
    summary: 'Books, novels, lessons and videos that belong to the school, reviewed before they are published.',
    steps: [
      'Search the shelf, narrow it by kind or category, and open a document to read what it is and who added it.',
      'Videos play inside the page; every other document opens in its usual application or downloads as a copy.',
      {
        text: 'Use "Add a document" to submit a book, a novel, a lesson or a video. The file itself decides whether it is a video; the title, category and audience are yours to set.',
        roles: [ADMIN, TEACHER]
      },
      {
        text: 'When review is on, a submission waits under My uploads until an administrator publishes it. A rejected document shows the reviewer\u2019s note so you can correct it and send it back.',
        roles: [TEACHER]
      },
      {
        text: 'The Review shelf lists every submission waiting for a decision, with the catalogue totals and the most recent reading beside it. Settings \u2192 Library sets the upload, review, download and size restrictions and the categories.',
        roles: [ADMIN, DEV]
      },
      {
        text: 'You read and watch what has been published to you. Student accounts cannot add to the Library.',
        roles: [STUDENT]
      },
      {
        text: 'You see the published catalogue for oversight; adding and reviewing stay with teachers and administrators.',
        roles: [DIRECTOR]
      }
    ]
  },

  '/absences': {
    title: 'Attendance',
    summary: 'Mark who attended a session, and why anyone was away.',
    steps: [
      {
        text: 'The page opens automatically when one of your sessions begins and re-checks the clock every fifteen seconds.',
        roles: [TEACHER]
      },
      'Search the roster, then mark a student absent with the justification when there is one.',
      '"Held · nothing to report" confirms a session where nothing happened and withdraws its alert.',
      'Save the record; the page then waits for the next session.'
    ]
  },

  '/observations': {
    title: 'Observations',
    summary: 'Notes recorded about a student in a session.',
    steps: [
      'Choose the section and the session, then search the roster for the student.',
      'Use "New Student Observation" to record the motif, the date and the note.',
      'An absent student cannot receive an observation for that session.',
      'Delete an entry only if it was recorded by mistake; directors keep the full history.'
    ]
  },

  '/notifications': {
    title: 'Notifications',
    summary: 'Everything addressed to you, in one list.',
    steps: [
      'Absences, observations, missed classes, inbox mail and direct messages all arrive here.',
      'Open a notification to act on it; the page it points to opens with the record in context.',
      {
        text: 'Notifications about your own sessions — a class to confirm, an observation, a message — arrive here.',
        roles: [TEACHER]
      },
      {
        text: 'Absences, observations and missed classes reach you for review; open one to read the record behind it.',
        roles: [DIRECTOR]
      },
      {
        text: 'Administrators receive the same oversight items and can open the page behind any of them.',
        roles: [ADMIN]
      },
      '"Mark all read" clears the unread badge. The chime and popup follow Settings → Notifications.',
      'Directors can comment on a record from its notification; every director reads the same thread.'
    ]
  },

  '/student-history': {
    title: 'Student history',
    summary: 'One student’s complete absence and observation history.',
    steps: [
      'Choose a student to load their history.',
      'Filter by date range or record type to isolate a period.',
      'Read the charts for the trend and the table below for the individual records.',
      {
        text: 'Open the records a student accumulated before a decision; nothing is edited from this page.',
        roles: [DIRECTOR]
      },
      'Use Global history when you need every student at once.'
    ]
  },

  '/global-history': {
    title: 'Global history',
    summary: 'Absences and observations across the whole registry.',
    steps: [
      'Set the filters first: date range, record type, major and section.',
      'Read the charts for the trend, then the table for the individual records.',
      'Reset the filters to return to the whole period.',
      {
        text: 'This is the cross-registry view: use it to compare a section or a major before narrowing to one student.',
        roles: [DIRECTOR, ADMIN]
      },
      'This is an oversight page: nothing is edited from here.'
    ]
  },

  '/teachers': {
    title: 'People',
    summary: 'The register of people and the roles they hold.',
    steps: [
      'Search, or filter by role, grade or name.',
      'Use "Add person" to create the record; roles are given in the record itself.',
      'Open a person to edit their identity, photo and contact details.',
      'Deleting a person also deletes any account they hold — this is not the place to remove a student.'
    ]
  },

  '/accounts': {
    title: 'Accounts',
    summary: 'Sign-in accounts: active, deactivated and their roles.',
    steps: [
      'Search by username, name or role.',
      'Open an account to change its username, email or password, or to activate and deactivate it; a deactivated account cannot sign in, but its records stay.',
      'Roles such as Admin, Director, Secretary or Teacher come from the account, not the person record.',
      'A manager cannot change their own role, and the last active administrator cannot be demoted or cleared.',
      'A password set here needs no current password; the new username or password is used at the next sign-in.'
    ]
  },

  '/suspended-accounts': {
    title: 'Suspended accounts',
    summary: 'Accounts locked after repeated wrong passwords.',
    steps: [
      'Five wrong passwords in a row suspend an account: it cannot sign in even with the right one.',
      'Search for the account and use "Restore access".',
      'Restoring clears the suspension but leaves a deactivated account deactivated.',
      'Sign-ins and restores are recorded in the Activity log.'
    ]
  },

  '/secretaries': {
    title: 'Secretary & scheduler accounts',
    summary: 'What each secretary or scheduler may do, and for which categories.',
    steps: [
      'Select an account to manage it.',
      'Give the teaching categories it is responsible for: a secretary can then register, edit and delete only students in those sections, and a scheduler can only schedule sessions and create teaching groups there.',
      'Set the conduct rights per action for a secretary, so an account can record a punishment without being able to delete one.',
      'Names, birth dates and photos belong to the person record and are edited on People.'
    ]
  },

  '/statistics': {
    title: 'Statistics',
    summary: 'The registry read as figures, per semester.',
    steps: [
      'Choose a study year and a semester, then read the count cards at the top.',
      'The charts break the semester down by major, attendance and results.',
      'Scroll to the per-major tables for the detail behind a figure.',
      'An empty view means no data has been recorded for that period yet.'
    ]
  },

  '/academic': {
    title: 'Academic years',
    summary: 'The calendar everything else hangs from.',
    steps: [
      'Build the calendar from the top: create a study year, then its semesters, then the weeks.',
      'Use "Generate Weeks" to fill a semester instead of entering its weeks one by one.',
      'Save each plate; a year with no semester is not selectable on the other pages.',
      'Deleting a year or a semester removes everything under it, so do that before data is attached.'
    ]
  },

  '/majors': {
    title: 'Majors',
    summary: 'Majors, their categories, chapters and lessons.',
    steps: [
      'Use "Add Major" for the major itself and "Manage Categories" for the groups they sit in.',
      'Open a major to maintain its chapters and lessons.',
      'The semester factor sets the weight of the major in the semester average — save it per semester.',
      'Prerequisites between majors are set on the major record.'
    ]
  },

  '/sections': {
    title: 'Sections & teaching groups',
    summary: 'Sections, the groups inside them and each group’s roster.',
    steps: [
      'Create a section and choose the teaching category it belongs to.',
      'Define the teaching groups of each major for the semester.',
      '"Manage Members" edits a group’s student roster.',
      'Deleting a section or a group detaches its students instead of deleting them.'
    ]
  },

  '/teaching-categories': {
    title: 'Teaching categories',
    summary: 'The categories secretaries are made responsible for.',
    steps: [
      'Categories group sections, and a secretary works only inside the categories assigned to them.',
      'Add a category with its code and its name in every interface language.',
      'Deleting a category is refused while sections still use it.'
    ]
  },

  '/classrooms': {
    title: 'Classrooms',
    summary: 'Rooms, their capacity and their categories.',
    steps: [
      'Add a classroom with its room code, capacity and category.',
      '"Manage Categories" switches the page to the room categories.',
      'Seats are removed with the classroom, so seat a room before scheduling exams in it.'
    ]
  },

  '/session-types': {
    title: 'Session types',
    summary: 'The kinds of session the timetable can place.',
    steps: [
      'Add the session types the timetable uses (lecture, lab, tutorial…).',
      'Each type carries a code and a label; the schedule and hourly volumes read them.',
      'A type still used by a session cannot be deleted.'
    ]
  },

  '/grades': {
    title: 'Grades',
    summary: 'The reference table of grades behind the people records.',
    steps: [
      'Read the list, or search it to find a grade.',
      'Use "Add Grade" to add one; open a row to rename it.',
      'A grade still assigned to a person cannot be deleted.'
    ]
  },

  '/academic-grades': {
    title: 'Academic grades',
    summary: 'The staff hierarchy used in person records.',
    steps: [
      'Read the list, or search it to find a grade.',
      'Add, rename or remove a grade; the People page offers them in the person record.',
      'Each grade carries a code and a label in every interface language; the English label is required before a grade can be saved.'
    ]
  },

  '/exam-types': {
    title: 'Exam types',
    summary: 'How sittings are classified.',
    steps: [
      'Read the list, or search it to find a type.',
      'Add a type before scheduling an exam that needs it.',
      'A type in use by an examination cannot be deleted.'
    ]
  },

  '/promotions': {
    title: 'Promotions',
    summary: 'Promotions label cohorts attached to sections and shown on student reports.',
    steps: [
      'Read the list, or search it to find a promotion.',
      'Add a cohort code and label in the interface languages.',
      'A promotion assigned to a section cannot be deleted. Move its sections first.'
    ]
  },

  '/report-bug': {
    title: 'Report a bug',
    summary: 'Tell the team what broke, in your own words.',
    steps: [
      'Describe what you were doing, what happened and what you expected.',
      'Attach a screenshot when the problem is visual; it helps more than a paragraph.',
      'Send the report; the team triages it from Bug reports.',
      'Your own reports and their status stay listed under the form.'
    ]
  },

  '/bug-reports': {
    title: 'Bug reports',
    summary: 'What users reported, newest first.',
    steps: [
      'Read the reports submitted by users, newest first.',
      'Triage a report: set its status and priority as you work on it.',
      {
        text: 'Developers and administrators work the same queue; every triage change is recorded against the account that made it.',
        roles: [DEV]
      },
      'Use "Refresh" to pull anything new without leaving the page.',
      'Reports are submitted from the Report a bug page by every role.'
    ]
  },

  '/audit-log': {
    title: 'Activity log',
    summary: 'Every recorded action, append-only.',
    steps: [
      'Filter by date range, actor, action, entity or result to find an event.',
      'Search across actor, action, entity and error text when you are unsure of the filter.',
      {
        text: 'Developers and administrators read the same trail; neither can edit or delete an entry from here.',
        roles: [DEV]
      },
      '"Export CSV" writes the filtered set, capped so an export cannot stall the window.',
      'Entries cannot be edited or deleted from the application, and entries older than 12 months are pruned automatically.'
    ]
  },

  '/sessions': {
    title: 'Sessions',
    summary: 'The computers your account is signed in on, and every account’s sessions for oversight.',
    steps: [
      'Each row is one signed-in window: the device, when it started, when it was last seen and whether it is still open.',
      '"This session" marks the window you are using now; ending it signs this window out immediately.',
      'A session with no heartbeat for ten minutes is shown as inactive; it is not closed automatically, because a sleeping computer or a short outage must not sign anybody out.',
      'Use "End all other sessions" to close every other window of your own account while keeping this one open.',
      {
        text: 'The "All accounts" tab lists every account’s sessions. Ending another account’s session is recorded in the activity log, and your own window is never closed by the bulk action.',
        roles: [ADMIN]
      },
      {
        text: 'The "All accounts" tab is available while the administrator allows developers to manage sessions in Settings; without that switch this page shows your own sessions only.',
        roles: [DEV]
      },
      'Ending a session cannot be undone: the account signs in again to start a new one.'
    ]
  },

  '/changelog': {
    title: 'Changelog',
    summary: 'What changed in each release.',
    steps: [
      'Read the releases newest first; each one lists its features and fixes.',
      {
        text: 'Use "New release" to create an entry with its version, date and notes in every language.',
        roles: [ADMIN, DEV]
      },
      {
        text: 'Open a release to edit or delete it.',
        roles: [ADMIN, DEV]
      },
      {
        text: 'Releases are written by administrators and developers; with your role this page is read-only.',
        roles: [DIRECTOR, SECRETARY, SCHEDULER, TEACHER, STUDENT]
      },
      'Users see the latest release once after it is published.'
    ]
  },

  '/database': {
    title: 'Database',
    summary: 'Connection status and the SQL console.',
    steps: [
      'Check the connection status first; nothing can be queried without it.',
      'Pick a table to browse its columns and rows.',
      'Run a read query in the console to inspect the data before changing anything.',
      'This is a diagnostic page; the application never edits data from here.'
    ]
  },

  '/beta-tests': {
    title: 'Beta tests',
    summary: 'Report what you tested in each version.',
    steps: [
      'For each version, mark the features you tested.',
      'Report the problems you found with a severity, and leave an overall comment.',
      'Use "Save report" to store it against your account and the version.',
      'One report per tester and version; edit it until you are done.'
    ]
  },

  '/beta-test-reports': {
    title: 'Beta test reports',
    summary: 'What testers reported for each version.',
    steps: [
      'Choose a version to read what testers reported.',
      'Each report lists the features marked as tested, the problems with their severity, and the overall comment.',
      {
        text: 'Developers and administrators read the same reports; a version nobody tested is explained in place.',
        roles: [DEV]
      },
      'One report per tester and version; use it to decide what ships in the next release.'
    ]
  },

  '/settings': {
    title: 'Settings',
    summary: 'The account, this computer, and the application-wide options.',
    steps: [
      'Each row states its current value; open one to change it.',
      {
        text: 'Application: the exam-marks lock and student deletion are global and enforced by the server.',
        roles: [ADMIN]
      },
      {
        text: 'Administration: locked pages, user passwords, message permissions and beta testers.',
        roles: [ADMIN, DEV]
      },
      {
        text: 'With your role the rows you can change are your own account and this computer; the application-wide options are set by an administrator.',
        roles: [DIRECTOR, SECRETARY, SCHEDULER, TEACHER, STUDENT]
      },
      'This computer: the notification sound and interface motion are stored locally, not on the account.',
      'Your account: change your own username or password here at any time.'
    ]
  },

  '/profile': {
    title: 'Profile',
    summary: 'Your identity card as the registry holds it.',
    steps: [
      'Read your identity card: name, roles, contact details and photo.',
      {
        text: 'Change your photo from the card; it appears in the roster and in conversations.',
        roles: [ADMIN, DIRECTOR, SECRETARY, TEACHER, STUDENT]
      },
      'Your username and password are changed in Settings, not here.',
      'Details you cannot edit belong to the person record; ask an administrator to correct them.'
    ]
  }
}

// The role label used in the guide footer, from the same role table the
// tutorial videos use. The first role the account holds that has a guide wins.
export function roleLabelFor(user) {
  const roles = user?.roles || []
  const known = TUTORIAL_ROLES.find((role) => roles.includes(role.code))
  return known ? known.label : null
}

function matches(route, pathname) {
  if (route === pathname) return true
  // A record opened from the directory keeps its page guide.
  if (route === '/student-records' && pathname.startsWith('/student-records/')) return true
  return false
}

// The guide for this path, with the steps this account may see. Returns null
// when the route has no guide or every step is written for another role.
export function getPageGuide(pathname, user) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  const key = Object.keys(GUIDES).find((route) => matches(route, path))
  if (!key) return null

  const guide = GUIDES[key]
  const roles = user?.roles || []
  const steps = (guide.steps || [])
    .filter((step) => typeof step === 'string' || !step.roles || step.roles.some((role) => roles.includes(role)))
    .map((step) => (typeof step === 'string' ? step : step.text))

  if (steps.length === 0) return null
  return { title: guide.title, summary: guide.summary, steps }
}
