// The actions the audit trail records. Services write the codes; the Activity
// log page labels them through this catalogue, so adding an action to a service
// does not require a second list to remember here in the UI.
export const AUDIT_ACTIONS = [
  { code: 'auth.sign_in', label: 'Sign-in attempt', group: 'Security' },
  { code: 'session.end', label: 'User session ended', group: 'Security' },
  { code: 'account.unlock', label: 'Account restored', group: 'Accounts' },
  { code: 'account.password_reset', label: 'Password reset by an administrator', group: 'Accounts' },
  { code: 'account.update', label: 'Account updated', group: 'Accounts' },
  { code: 'account.password_change', label: 'Password changed', group: 'Accounts' },
  { code: 'account.username_change', label: 'Username changed', group: 'Accounts' },
  { code: 'settings.option_change', label: 'Setting changed', group: 'Settings' },
  { code: 'uniform_size.option_change', label: 'Uniform size changed', group: 'Settings' },
  { code: 'permission.page_lock', label: 'Page lock changed', group: 'Permissions' },
  { code: 'permission.teaching_scope', label: 'Teaching scope changed', group: 'Permissions' },
  { code: 'permission.department_scope', label: 'Scheduler department changed', group: 'Permissions' },
  { code: 'permission.message_rule', label: 'Message permission changed', group: 'Permissions' },
  { code: 'student.create', label: 'Student registered', group: 'Students' },
  { code: 'student.update', label: 'Student record updated', group: 'Students' },
  { code: 'student.identity_update', label: 'Student identity updated', group: 'Students' },
  { code: 'person.delete', label: 'Person deleted', group: 'Students' },
  { code: 'person.department_set', label: 'Teacher department changed', group: 'Accounts' },
  { code: 'absence.record', label: 'Absence recorded', group: 'Attendance' },
  { code: 'absence.clear', label: 'Absence cleared', group: 'Attendance' },
  { code: 'exam.marks_save', label: 'Exam marks saved', group: 'Exams' },
  { code: 'library.upload', label: 'Library document added', group: 'Library' },
  { code: 'library.review', label: 'Library document reviewed', group: 'Library' },
  { code: 'library.update', label: 'Library document updated', group: 'Library' },
  { code: 'library.delete', label: 'Library document removed', group: 'Library' },
  { code: 'library.category_change', label: 'Library category changed', group: 'Library' },
  { code: 'teacher_constraint.create', label: 'Teacher constraint declared', group: 'Scheduling' },
  { code: 'teacher_constraint.option_change', label: 'Predefined teacher constraint changed', group: 'Scheduling' },
  { code: 'teacher_constraint.delete', label: 'Teacher constraint removed', group: 'Scheduling' },
  { code: 'audit.view', label: 'Activity log viewed', group: 'Audit' }
]

const LABELS = new Map(AUDIT_ACTIONS.map((entry) => [entry.code, entry.label]))

export function auditActionLabel(code) {
  return LABELS.get(code) || code
}
