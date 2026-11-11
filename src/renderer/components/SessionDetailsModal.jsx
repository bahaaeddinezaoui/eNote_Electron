import React from 'react'
import { Clock, MapPin, BookOpen, Users, User, Calendar, Tag, GraduationCap } from 'lucide-react'
import { formatDateLabel, sessionTypeLabel } from '../scheduleUtils'
import { tr } from '../i18n'
import Modal from './ui/Modal'

// Details modal for any event on the schedule timetable:
//   - a study session (session.STUDY_SESSION_ID set), or
//   - an exam block (session.EXAMINATION_ID set) — fixed event, shows its
//     rooms, the teaching groups taking it, and its factor.
// The shell is the shared Modal (overlay, title bar, focus trap, Escape), so the
// plate matches every other dialog in the app; only the body is schedule-specific.
const SessionDetailsModal = ({ session, onClose }) => {
  if (!session) return null

  const isExam = session.EXAMINATION_ID != null

  const dayLabel = session.STUDY_DAY_DATE
    ? formatDateLabel(session.STUDY_DAY_DATE)
    : isExam && session.EXAMINATION_START_DATETIME
      ? formatDateLabel(session.EXAMINATION_START_DATETIME)
      : ''

  const pad = (n) => String(n).padStart(2, '0')
  const timeOf = (dt) => {
    const d = new Date(dt)
    return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const examTimeLabel = isExam
    ? `${timeOf(session.EXAMINATION_START_DATETIME)} - ${timeOf(session.EXAMINATION_END_DATETIME)}`
    : ''

  const rows = isExam
    ? [
        { icon: BookOpen, label: tr('Major'), value: session.MAJOR_LABEL },
        { icon: GraduationCap, label: tr('Exam'), value: session.EXAMINATION_LABEL },
        { icon: Tag, label: tr('Exam Code'), value: session.EXAMINATION_CODE },
        { icon: Calendar, label: tr('Day'), value: dayLabel },
        { icon: Clock, label: tr('Time'), value: examTimeLabel },
        { icon: MapPin, label: tr('Classroom(s)'), value: session.CLASSROOM_LABEL },
        { icon: Users, label: tr('Teaching Group(s)'), value: session.TEACHING_GROUPS },
        { icon: Users, label: tr('Exam Group(s) in Room'), value: session.GROUP_COUNT > 1 ? `${session.GROUP_COUNT} groups` : null }
      ]
    : [
        { icon: BookOpen, label: tr('Major'), value: session.MAJOR_LABEL },
        { icon: Tag, label: tr('Session Type'), value: sessionTypeLabel(session) },
        { icon: Users, label: tr('Teaching Group'), value: session.TEACHING_GROUP_LABEL },
        { icon: Calendar, label: tr('Day'), value: dayLabel },
        { icon: Clock, label: tr('Time'), value: `${session.STUDY_SESSION_START_TIME} - ${session.STUDY_SESSION_END_TIME}` },
        { icon: MapPin, label: tr('Classroom'), value: session.CLASSROOM_LABEL },
        { icon: User, label: tr('Instructor'), value: session.INSTRUCTOR_NAME },
        { icon: Calendar, label: tr('Study Week'), value: session.STUDY_WEEK_LABEL }
      ].filter(row => row.value)

  const title = isExam ? tr('Exam Details') : tr('Session Details')
  const heading = isExam ? session.EXAMINATION_LABEL || session.EXAMINATION_CODE || tr('Exam') : session.MAJOR_LABEL
  const badge = isExam ? session.EXAMINATION_CODE : sessionTypeLabel(session)

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      description={heading}
      maxWidth="max-w-[460px]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[9.5px] text-ink-3">
            {isExam ? `EXAM · ${session.EXAMINATION_ID}` : `SESSION · ${session.STUDY_SESSION_ID}`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted"
          >
            {tr('Close')}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{heading}</h3>
          {badge ? (
            <span
              className={`kicker shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[9px] ${
                isExam
                  ? 'border-danger/30 bg-danger-bg text-danger-ink'
                  : 'border-line-strong bg-selection text-ink-2'
              }`}
            >
              {badge}
            </span>
          ) : null}
        </div>

        <dl className="divide-y divide-line overflow-hidden rounded-[4px] border border-line">
          {rows.map((row, index) => (
            <div key={`${tr(row.label)}-${index}`} className="flex items-start gap-2.5 px-2.5 py-2 odd:bg-surface-muted/60">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[3px] ${isExam ? 'bg-danger-bg text-danger-ink' : 'bg-surface-muted text-ink-3'}`}>
                <row.icon size={12} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <dt className="kicker text-[9px] leading-tight">{tr(row.label)}</dt>
                <dd className="mt-0.5 break-words text-[12.5px] font-medium leading-snug text-ink">
                  {row.value || <span className="text-ink-3">—</span>}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  )
}

export default SessionDetailsModal
