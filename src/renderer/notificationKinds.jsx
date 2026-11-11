import {
  AlarmClock,
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Bug,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  CalendarX,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Gavel,
  Lock,
  Mail,
  MessageSquare,
  Notebook,
  ShieldAlert,
  Tags,
  UserX
} from 'lucide-react'
import { NOTIFICATION_FAMILIES, familyOf } from '../shared/notificationFamilies'

// How each kind of notification looks, how it is named, which family it belongs
// to and, in notificationSound.js, how it sounds.
//
// The bell and the notifications page render the same rows, so the icon, the
// label and the accent live here once: a row can never be an amber "missed
// class" in the bell and a green "observation" on the page.
//
// Colour is never the only signal — every row also carries its label, its icon
// and its own chime.
const EMBER = {
  border: 'color-mix(in srgb, var(--color-ember-500) 45%, transparent)',
  background: 'color-mix(in srgb, var(--color-ember-500) 14%, transparent)',
  color: 'var(--color-ember-600)',
  text: 'var(--color-ember-600)'
}
const DANGER = {
  border: 'color-mix(in srgb, var(--color-danger) 35%, transparent)',
  background: 'var(--color-danger-bg)',
  color: 'var(--color-danger-ink)',
  text: 'var(--color-danger-ink)'
}
const JADE = {
  border: 'color-mix(in srgb, var(--color-jade-500) 40%, transparent)',
  background: 'var(--color-success-bg)',
  color: 'var(--color-success-ink)',
  text: 'var(--color-jade-600)'
}
const NEUTRAL = {
  border: 'var(--color-line-strong)',
  background: 'var(--color-surface-muted)',
  color: 'var(--color-ink-2)',
  text: 'var(--color-ink-2)'
}

const KIND = {
  // Students' own records
  ABSENCE: { label: 'Absence', icon: UserX, ...DANGER },
  OBSERVATION: { label: 'Observation', icon: Notebook, ...JADE },
  DISCIPLINARY: { label: 'Punishment / reward', icon: Gavel, ...DANGER },
  ABSENCE_THRESHOLD: { label: 'Absence threshold', icon: AlertTriangle, ...DANGER },

  // Sessions and the schedule
  TEACHER_REMINDER: { label: 'Attendance reminder', icon: AlarmClock, ...EMBER },
  TEACHER_MISSING: { label: 'Missed class', icon: CalendarX, ...EMBER },
  SCHEDULE_CHANGE: { label: 'Schedule change', icon: CalendarClock, ...EMBER },
  SESSION_ASSIGNED: { label: 'Class assigned', icon: CalendarPlus, ...EMBER },
  EXAM_DUTY: { label: 'Invigilation duty', icon: ClipboardCheck, ...JADE },

  // The teaching file
  MARKS_MISSING: { label: 'Marks missing', icon: Award, ...EMBER },
  EXAM_SCHEDULED: { label: 'Exam scheduled', icon: ClipboardList, ...NEUTRAL },
  LESSON_MATERIAL: { label: 'New material', icon: BookOpen, ...JADE },
  LIBRARY_REVIEW: { label: 'Library decision', icon: BookOpen, ...JADE },
  LIBRARY_REVIEW_REQUEST: { label: 'Library review request', icon: ClipboardCheck, ...EMBER },
  ATTENDANCE_DIGEST: { label: 'Attendance digest', icon: CalendarRange, ...NEUTRAL },
  ATTENDANCE_LOW: { label: 'Low attendance rate', icon: BarChart3, ...DANGER },

  // Accounts and the support desk
  ACCOUNT_ALERT: { label: 'Account alert', icon: ShieldAlert, ...DANGER },
  ACCOUNT_SECURITY: { label: 'Account security', icon: Lock, ...DANGER },
  CATEGORIES_CHANGED: { label: 'Categories changed', icon: Tags, ...NEUTRAL },
  DEPARTMENTS_CHANGED: { label: 'Departments changed', icon: Tags, ...NEUTRAL },
  BETA_PROBLEM: { label: 'Beta problem', icon: FlaskConical, ...EMBER },
  BUG_STATUS: { label: 'Bug report status', icon: Bug, ...JADE },

  // Messages
  DIRECT_MESSAGE: { label: 'Direct message', icon: MessageSquare, ...NEUTRAL },
  INBOX_MESSAGE: { label: 'Inbox mail', icon: Mail, ...JADE }
}

const FALLBACK = KIND.OBSERVATION

export const notificationKind = (recordType) => KIND[recordType] || FALLBACK

export const isMessageNotification = (recordType) =>
  recordType === 'DIRECT_MESSAGE' || recordType === 'INBOX_MESSAGE'

// Both kinds of session alert hang off the same register: the reminder while the
// class is running, the missed-class alarm once it is over. They carry the same
// detail and are answered the same way.
export const isSessionNotification = (recordType) =>
  recordType === 'TEACHER_REMINDER' || recordType === 'TEACHER_MISSING'

// Director comments exist only for the two records a director reads and
// discusses: an absence and an observation.
export const isCommentableNotification = (recordType) =>
  recordType === 'ABSENCE' || recordType === 'OBSERVATION'

// The page families the notifications page offers as tabs, and the same five
// families the settings page mutes. One tab per kind would be nineteen buttons;
// the family list lives in one shared module so the two cannot drift apart.
export const NOTIFICATION_GROUPS = NOTIFICATION_FAMILIES

export const groupOf = (recordType) => familyOf(recordType)

// Where a notification leads. Only pages the audience of that kind certainly has
// are used: a link that opens "not found" is worse than no link at all, and
// everything else opens its own record on the notifications page.
const TARGETS = {
  MARKS_MISSING: '/exam-marks',
  LESSON_MATERIAL: '/lessons',
  LIBRARY_REVIEW: '/library?tab=mine',
  LIBRARY_REVIEW_REQUEST: '/library?tab=review',
  SCHEDULE_CHANGE: '/teacher-schedule',
  SESSION_ASSIGNED: '/teacher-schedule',
  ATTENDANCE_DIGEST: '/teacher-schedule',
  ATTENDANCE_LOW: '/teacher-attendance',
  ABSENCE_THRESHOLD: '/student-history',
  BETA_PROBLEM: '/beta-test-reports',
  ACCOUNT_ALERT: '/suspended-accounts',
  ACCOUNT_SECURITY: '/settings',
  BUG_STATUS: '/report-bug',
  DIRECT_MESSAGE: '/messages',
  INBOX_MESSAGE: '/inbox'
}

export const notificationTarget = (recordType, recordKey) =>
  TARGETS[recordType] || `/notifications?focus=${encodeURIComponent(recordKey || '')}`
