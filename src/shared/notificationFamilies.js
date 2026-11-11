// The notification families, in one place for both processes.
//
// The main process needs them to know what a person has muted (the preference
// is stored per account in user_notification_mute, keyed by family id), and the
// renderer needs them to draw the settings switches and the page tabs. One list
// means a family cannot exist in the switches and be unknown to the filter.
//
// A family is how a person mutes noise in bulk: silencing "Teaching" quiets the
// marks chase, the new-material notices and the attendance summaries while the
// absences they actually act on keep arriving.

export const NOTIFICATION_FAMILIES = [
  {
    id: 'students',
    label: 'Students',
    description: 'Absences, observations, punishments and rewards, and the absence threshold.'
  },
  {
    id: 'sessions',
    label: 'Sessions',
    description: 'Attendance reminders, missed classes, rescheduled or cancelled sessions, invigilation duty.'
  },
  {
    id: 'teaching',
    label: 'Teaching',
    description: 'Examinations whose marks are still empty, new lesson material, Library submissions and review decisions, your weekly attendance summary.'
  },
  {
    id: 'accounts',
    label: 'Accounts & support',
    description: 'Account security and suspensions, editable categories, bug-report statuses, beta-test problems.'
  },
  {
    id: 'messages',
    label: 'Messages',
    description: 'Direct messages and inbox mail.'
  }
]

export const FAMILY_OF_TYPE = {
  // Student records
  ABSENCE: 'students',
  OBSERVATION: 'students',
  DISCIPLINARY: 'students',
  ABSENCE_THRESHOLD: 'students',

  // Sessions and the schedule
  TEACHER_REMINDER: 'sessions',
  TEACHER_MISSING: 'sessions',
  SCHEDULE_CHANGE: 'sessions',
  SESSION_ASSIGNED: 'sessions',
  EXAM_DUTY: 'sessions',

  // The teaching file
  MARKS_MISSING: 'teaching',
  EXAM_SCHEDULED: 'teaching',
  LESSON_MATERIAL: 'teaching',
  LIBRARY_REVIEW: 'teaching',
  LIBRARY_REVIEW_REQUEST: 'teaching',
  ATTENDANCE_DIGEST: 'teaching',
  ATTENDANCE_LOW: 'teaching',

  // Accounts and the support desk
  ACCOUNT_ALERT: 'accounts',
  ACCOUNT_SECURITY: 'accounts',
  CATEGORIES_CHANGED: 'accounts',
  DEPARTMENTS_CHANGED: 'accounts',
  BETA_PROBLEM: 'accounts',
  BUG_STATUS: 'accounts',

  // Messages
  DIRECT_MESSAGE: 'messages',
  INBOX_MESSAGE: 'messages'
}

export const FAMILY_IDS = NOTIFICATION_FAMILIES.map((family) => family.id)

// An unknown type is treated as a student record, the family with the widest
// audience: better to show it than to hide it behind a mute that never named it.
export const familyOf = (recordType) => FAMILY_OF_TYPE[recordType] || 'students'
