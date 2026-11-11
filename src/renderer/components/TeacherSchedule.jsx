import React, { useState, useEffect } from 'react'
import { formatDate } from '../dateFormat'
import { CalendarDays, Clock, MapPin, Users, Plus, Trash2, ShieldAlert } from 'lucide-react'
import SessionDetailsModal from './SessionDetailsModal'
import Modal from './ui/Modal'
import SearchSelect from './ui/SearchSelect'
import { PageIntro, Panel } from './ui/PageHeader'
import { weekdayName, formatDayShort, formatDateLabel, pickCurrentYearId, pickCurrentSemesterId, pickCurrentWeekId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { usePersistentState } from '../usePersistentState'
import { localizedLabel, tr } from '../i18n'

// One row per teaching hour, 06:00 through the 23:00 row that ends at 24:00.
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6) // 6 AM to midnight
const ROW_H = 80

// A database time comes back as HH:MM:SS; the pickers and the grid use HH:MM.
const timeKey = (value) => String(value || '').slice(0, 5)

const TeacherSchedule = ({ user }) => {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState(null)

  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [weeks, setWeeks] = useState([])
  const [days, setDays] = useState([])
  const [groups, setGroups] = useState([])

  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')

  // The page has two views over the same week: the classes the teacher gives,
  // and the windows the teacher declared. The choice survives navigation.
  const [view, setView] = usePersistentState(
    `teacher-schedule-view:${user?.id || 'anonymous'}`,
    'schedule'
  )

  // Weekly constraints a teacher declares for the selected week. The Admin can
  // switch the whole feature off; then this panel disappears and the scheduler
  // ignores the rows.
  const [constraintSettings, setConstraintSettings] = useState({ enabled: false, forced: false, policy: 'hard' })
  const [constraints, setConstraints] = useState([])
  const [constraintsLoading, setConstraintsLoading] = useState(false)
  const [constraintError, setConstraintError] = useState('')
  const [constraintNotice, setConstraintNotice] = useState('')
  const [savingConstraint, setSavingConstraint] = useState(false)
  const [deletingConstraintId, setDeletingConstraintId] = useState(null)
  const [showConstraintModal, setShowConstraintModal] = useState(false)
  // The windows are a predefined list the administration keeps; a teacher only
  // selects which of them applies, and on which day.
  const [constraintOptions, setConstraintOptions] = useState([])
  const [constraintForm, setConstraintForm] = useState({
    STUDY_DAY_ID: '',
    TEACHER_CONSTRAINT_OPTION_ID: ''
  })

  // With the feature switched off there is only one view, whatever was chosen
  // before; the stored choice returns if the Admin switches it back on.
  const activeView = view === 'constraints' && constraintSettings.enabled
    ? 'constraints'
    : 'schedule'

  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester },
    { rows: weeks, pickId: pickCurrentWeekId, selectedId: selectedWeek, setSelectedId: setSelectedWeek }
  ])

  useEffect(() => {
    loadYears()
    loadGroups()
    loadConstraintSettings()
    loadConstraintOptions()
  }, [])

  useEffect(() => {
    if (selectedYear) {
      loadSemesters(selectedYear)
    } else {
      setSemesters([])
      setSelectedSemester('')
    }
  }, [selectedYear])

  useEffect(() => {
    if (selectedSemester) {
      loadWeeks(selectedSemester)
    } else {
      setWeeks([])
      setSelectedWeek('')
    }
  }, [selectedSemester])

  useEffect(() => {
    if (selectedWeek && selectedGroup) {
      loadSchedule(selectedWeek, selectedGroup)
    } else {
      setSessions([])
    }
  }, [selectedWeek, selectedGroup])

  useEffect(() => {
    if (selectedWeek) {
      loadWeekDays(selectedWeek)
    } else {
      setDays([])
    }
  }, [selectedWeek])

  // The teacher's own rows for the week, reloaded when the feature is switched
  // on from Settings while this page stays open.
  useEffect(() => {
    if (selectedWeek && constraintSettings.enabled && user?.personId) {
      loadConstraints(selectedWeek)
    } else {
      setConstraints([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek, constraintSettings.enabled, user?.personId])

  // Keep the form pointing at a real day of the week being edited.
  useEffect(() => {
    if (days.length === 0) {
      setConstraintForm((prev) => (prev.STUDY_DAY_ID ? { ...prev, STUDY_DAY_ID: '' } : prev))
      return
    }
    setConstraintForm((prev) => (
      days.some((day) => String(day.STUDY_DAY_ID) === String(prev.STUDY_DAY_ID))
        ? prev
        : { ...prev, STUDY_DAY_ID: String(days[0].STUDY_DAY_ID) }
    ))
  }, [days])

  // The predefined hard and soft windows the administration maintains. The
  // declaration form offers only these, so every teacher declares the same
  // catalogue under the same names.
  const loadConstraintOptions = async () => {
    try {
      const result = await window.api.getTeacherConstraintOptions()
      setConstraintOptions(result?.data || [])
    } catch (err) {
      console.error('Failed to load the predefined constraints', err)
      setConstraintOptions([])
    }
  }

  const loadConstraintSettings = async () => {
    try {
      const result = await window.api.getTeacherConstraintSettings()
      setConstraintSettings(result || { enabled: false })
    } catch (err) {
      console.error('Failed to load teacher constraint settings', err)
      setConstraintSettings({ enabled: false })
    }
  }

  const loadConstraints = async (weekId) => {
    setConstraintsLoading(true)
    try {
      const result = await window.api.getTeacherConstraints(weekId, user?.personId)
      setConstraints(result?.data || [])
    } catch (err) {
      console.error('Failed to load teacher constraints', err)
      setConstraints([])
    } finally {
      setConstraintsLoading(false)
    }
  }

  const saveConstraint = async (event) => {
    event.preventDefault()
    setConstraintError('')
    setConstraintNotice('')

    if (!constraintForm.STUDY_DAY_ID) {
      setConstraintError(tr('Choose a day for the constraint.'))
      return
    }
    if (!constraintForm.TEACHER_CONSTRAINT_OPTION_ID) {
      setConstraintError(tr('Choose a predefined constraint.'))
      return
    }

    setSavingConstraint(true)
    try {
      await window.api.createTeacherConstraint(user?.id, {
        STUDY_WEEK_ID: selectedWeek,
        STUDY_DAY_ID: constraintForm.STUDY_DAY_ID,
        TEACHER_CONSTRAINT_OPTION_ID: constraintForm.TEACHER_CONSTRAINT_OPTION_ID
      })
      await loadConstraints(selectedWeek)
      setConstraintNotice(tr('Constraint saved.'))
      setShowConstraintModal(false)
    } catch (err) {
      console.error('Failed to save teacher constraint', err)
      setConstraintError(err?.message || tr('Could not save the constraint.'))
    } finally {
      setSavingConstraint(false)
    }
  }

  // The declaration form lives in a dialog: the timetable stays the page's
  // subject, and the form only appears when the teacher asks for it.
  const openConstraintModal = () => {
    setConstraintError('')
    setConstraintNotice('')
    setShowConstraintModal(true)
  }

  const closeConstraintModal = () => {
    if (savingConstraint) return
    setShowConstraintModal(false)
    setConstraintError('')
  }

  const removeConstraint = async (constraintId) => {
    setDeletingConstraintId(constraintId)
    setConstraintError('')
    setConstraintNotice('')
    try {
      await window.api.deleteTeacherConstraint(user?.id, constraintId)
      await loadConstraints(selectedWeek)
      setConstraintNotice(tr('Constraint removed.'))
    } catch (err) {
      console.error('Failed to delete teacher constraint', err)
      setConstraintError(err?.message || tr('Could not delete the constraint.'))
    } finally {
      setDeletingConstraintId(null)
    }
  }

  const loadYears = async () => {
    try {
      const result = await window.api.getStudyYears()
      const data = result?.data || []
      setYears(data)
      if (data.length > 0 && !selectedYear) {
        setSelectedYear(pickCurrentYearId(data))
      }
    } catch (err) {
      console.error('Failed to load years', err)
    }
  }

  const loadSemesters = async (yearId) => {
    try {
      const result = await window.api.getStudySemesters(yearId)
      const data = result?.data || []
      setSemesters(data)
      if (data.length > 0) {
        setSelectedSemester(pickCurrentSemesterId(data))
      } else {
        setSelectedSemester('')
      }
    } catch (err) {
      console.error('Failed to load semesters', err)
    }
  }

  const loadWeeks = async (semesterId) => {
    try {
      const result = await window.api.getStudyWeeks(semesterId)
      const data = result?.data || []
      setWeeks(data)
      if (data.length > 0) {
        setSelectedWeek(pickCurrentWeekId(data))
      } else {
        setSelectedWeek('')
      }
    } catch (err) {
      console.error('Failed to load weeks', err)
    }
  }

  const loadGroups = async () => {
    try {
      const result = await window.api.getTeachingGroups()
      const data = result?.data || []
      setGroups(data)
      if (data.length > 0 && !selectedGroup) {
        setSelectedGroup(data[0].TEACHING_GROUP_ID)
      }
    } catch (err) {
      console.error('Failed to load teaching groups', err)
    }
  }

  const loadSchedule = async (weekId, teachingGroupId) => {
    setLoading(true)
    try {
      if (!weekId || !teachingGroupId || !user?.personId) {
        setSessions([])
        return
      }

      // Filter the teacher's sessions to the selected teaching group.
      const result = await window.api.getTeacherSchedule(user.personId, weekId, teachingGroupId)
      setSessions(result?.data || [])
    } catch (err) {
      console.error('Failed to load schedule', err)
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  const loadWeekDays = async (weekId) => {
    try {
      const result = await window.api.getStudyWeekDays(weekId)
      setDays(result?.data || [])
    } catch (err) {
      console.error('Failed to load week days', err)
      setDays([])
    }
  }

  const weekLabel = weeks.find(w => String(w.STUDY_WEEK_ID) === String(selectedWeek))?.STUDY_WEEK_LABEL
  const groupLabel = groups.find(g => String(g.TEACHING_GROUP_ID) === String(selectedGroup))?.TEACHING_GROUP_LABEL

  const constraintKindLabel = (kind) => (
    String(kind).toUpperCase() === 'HARD' ? tr('Unavailable') : tr('Not recommended')
  )

  // The option picked in the dialog: shown under the picker with its hours and
  // note, so the teacher reads what they are declaring before saving it.
  const selectedConstraintOption = constraintOptions.find(
    (option) => String(option.TEACHER_CONSTRAINT_OPTION_ID) === String(constraintForm.TEACHER_CONSTRAINT_OPTION_ID)
  )

  // The single line a predefined window is named by in the picker and the list.
  const constraintOptionLabel = (option) => [
    constraintKindLabel(option.CONSTRAINT_KIND),
    `${timeKey(option.CONSTRAINT_START_TIME)}–${timeKey(option.CONSTRAINT_END_TIME)}`,
    localizedLabel(option, 'TEACHER_CONSTRAINT_OPTION_LABEL')
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-4">
      <PageIntro
        kicker={tr('Teaching')}
        title={tr('My schedule')}
        meta={activeView === 'constraints'
          ? `${constraints.length} ${constraints.length === 1 ? tr('constraint') : tr('constraints')}`
          : loading ? null : `${sessions.length} ${sessions.length === 1 ? tr('session') : tr('sessions')}`}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {activeView === 'constraints'
            ? tr('Mark the windows when you are unavailable (hard) or would rather not teach (soft), and read them on the timetable.')
            : tr('View your scheduled teaching sessions')}
        </p>
      </PageIntro>

      {/* Two views over the same week: the classes given, and the windows
          declared. The constraints tab only exists while the Admin allows it. */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={tr('Schedule views')}
          className="inline-flex items-center gap-0.5 rounded-[4px] border border-line-strong bg-surface p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeView === 'schedule'}
            onClick={() => setView('schedule')}
            className={`inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2.5 text-[11px] font-medium transition-colors ${
              activeView === 'schedule'
                ? 'bg-jade-solid text-on-jade'
                : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
            }`}
          >
            <CalendarDays size={12} />
            {tr('Weekly schedule')}
          </button>
          {constraintSettings.enabled && (
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'constraints'}
              onClick={() => setView('constraints')}
              className={`inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2.5 text-[11px] font-medium transition-colors ${
                activeView === 'constraints'
                  ? 'bg-jade-solid text-on-jade'
                  : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
              }`}
            >
              <ShieldAlert size={12} />
              {tr('Constraints')}
              <span className={`mono min-w-[15px] rounded-[2px] px-1 text-[9.5px] font-semibold ${
                activeView === 'constraints' ? 'bg-on-jade text-jade-solid' : 'bg-jade-solid text-on-jade'
              }`}>
                {constraints.length}
              </span>
            </button>
          )}
        </div>
        <span className="mono ms-auto text-[10px] text-ink-3">
          {weekLabel || tr('No week selected')}
        </span>
      </div>

      {/* Period and group: the choices that define the grid below. The group
          filter only narrows the sessions, so it is hidden in the constraint
          view (constraints are declared per teacher and week, not per group). */}
      <Panel>
        <div className={`grid grid-cols-2 gap-2 px-3 py-2.5 ${activeView === 'schedule' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} [&>div]:min-w-0`}>
          <div>
            <label htmlFor="schedule-year" className="kicker mb-1 block text-[8.5px]">{tr('Year')}</label>
            <select
              id="schedule-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="field text-[11px]"
            >
              {years.map(y => (
                <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>{y.STUDY_YEAR_LABEL}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="schedule-semester" className="kicker mb-1 block text-[8.5px]">{tr('Semester')}</label>
            <select
              id="schedule-semester"
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="field text-[11px]"
              disabled={!selectedYear}
            >
              {semesters.map(s => (
                <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>{s.STUDY_SEMESTER_LABEL}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="schedule-week" className="kicker mb-1 block text-[8.5px]">{tr('Week')}</label>
            <select
              id="schedule-week"
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              className="field text-[11px]"
              disabled={!selectedSemester}
            >
              {weeks.map(w => (
                <option key={w.STUDY_WEEK_ID} value={w.STUDY_WEEK_ID}>
                  {w.STUDY_WEEK_LABEL} ({formatDate(new Date(w.STUDY_WEEK_START_DATE))} - {formatDate(new Date(w.STUDY_WEEK_END_DATE))})
                </option>
              ))}
            </select>
          </div>

          {activeView === 'schedule' && (
            <div>
              <label htmlFor="schedule-group" className="kicker mb-1 block text-[8.5px]">{tr('Group')}</label>
              <select
                id="schedule-group"
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="field text-[11px]"
                disabled={groups.length === 0}
              >
                {groups.map(group => (
                  <option key={group.TEACHING_GROUP_ID} value={group.TEACHING_GROUP_ID}>{group.TEACHING_GROUP_LABEL}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Panel>

      {activeView === 'schedule' && (
        <Panel>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-surface-muted px-3 py-2">
            <CalendarDays size={12} className="text-ink-3" aria-hidden="true" />
            <span className="text-[11.5px] font-medium text-ink">{weekLabel || tr('No week selected')}</span>
            {groupLabel && (
              <span className="mono text-[10px] text-ink-3">{tr('Group:')} {groupLabel}</span>
            )}
          </div>

          {loading ? (
            <div role="status" aria-live="polite" className="space-y-1.5 p-3">
              <span className="sr-only">{tr('Loading schedule...')}</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-10 rounded-[3px] bg-surface-muted" aria-hidden="true" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                {days.length === 0 && (
                  <div className="border-b border-line px-3 py-2 text-[11px] text-ink-3">
                    {tr('This week has no study days yet.')}
                  </div>
                )}

                <div
                  style={{ gridTemplateColumns: `repeat(${days.length + 1}, minmax(0, 1fr))` }}
                  className="grid border-b border-line bg-surface-muted"
                >
                  <div className="border-e border-line px-2 py-2">
                    <span className="kicker text-[8.5px]">{tr('Time')}</span>
                  </div>
                  {days.map(day => (
                    <div key={day.STUDY_DAY_ID} className="border-e border-line px-2 py-2 text-center last:border-e-0">
                      <div className="text-[11px] font-medium text-ink">{weekdayName(day.STUDY_DAY_DATE)}</div>
                      <div className="mono text-[9px] text-ink-3">{formatDayShort(day.STUDY_DAY_DATE)}</div>
                    </div>
                  ))}
                </div>

                <div
                  style={{ gridTemplateColumns: `repeat(${days.length + 1}, minmax(0, 1fr))` }}
                  className="grid"
                >
                  {/* Column 0: hour labels */}
                  <div className="border-e border-line bg-surface-muted/40">
                    {HOURS.map(hour => (
                      <div
                        key={hour}
                        style={{ height: `${ROW_H}px` }}
                        className="flex items-start justify-end border-b border-line/70 px-2 py-1 last:border-b-0"
                      >
                        <span className="mono text-[9.5px] leading-none text-ink-3">{String(hour).padStart(2, '0')}:00</span>
                      </div>
                    ))}
                  </div>

                  {/* One column per study day of the selected week */}
                  {days.map(day => {
                    const daySessions = sessions.filter(s => String(s.STUDY_DAY_ID) === String(day.STUDY_DAY_ID))
  
                    return (
                      <div
                        key={day.STUDY_DAY_ID}
                        style={{ height: `${HOURS.length * ROW_H}px` }}
                        className="relative border-e border-line/70 last:border-e-0"
                      >
                        {/* Background hour slots */}
                        {HOURS.map(hour => (
                          <div key={hour} style={{ height: `${ROW_H}px` }} className="border-b border-line/70 last:border-b-0" />
                        ))}
  
                        {/* Session cards, placed by their start and end time */}
                        {daySessions.map(session => {
                          const [startH, startM] = (session.STUDY_SESSION_START_TIME || '08:00').split(':').map(Number)
                          const [rawEndH, endM] = (session.STUDY_SESSION_END_TIME || '10:00').split(':').map(Number)
  
                          const firstHour = HOURS[0] || 6
                          // 00:00 ends the day: treat it as 24:00 so the card reaches midnight.
                          const endH = rawEndH < firstHour ? rawEndH + 24 : rawEndH
                          const startMin = Math.max(0, (startH - firstHour) * 60 + startM)
                          const endMin = Math.min(HOURS.length * 60, (endH - firstHour) * 60 + endM)
  
                          const topPx = (startMin / 60) * ROW_H
                          const heightPx = Math.max(26, ((endMin - startMin) / 60) * ROW_H)
  
                          return (
                            <button
                              type="button"
                              key={session.STUDY_SESSION_ID}
                              onClick={() => setSelectedSession(session)}
                              style={{
                                position: 'absolute',
                                top: `${topPx}px`,
                                height: `${heightPx}px`,
                                left: '4px',
                                width: 'calc(100% - 8px)',
                                zIndex: 10,
                                borderInlineStartWidth: 2,
                                borderInlineStartColor: 'var(--color-jade-500)'
                              }}
                              className="overflow-hidden rounded-[3px] border border-line bg-selection px-1.5 py-1 text-start hover:border-jade-500/50 hover:brightness-110"
                            >
                              <span className="block truncate text-[11px] font-medium leading-tight text-ink">
                                {session.MAJOR_LABEL}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[9.5px] text-ink-2">
                                <MapPin size={9} className="shrink-0" aria-hidden="true" />
                                <span className="truncate">{session.CLASSROOM_LABEL}</span>
                              </span>
                              <span className="flex items-center gap-1 text-[9.5px] text-ink-3">
                                <Clock size={9} className="shrink-0" aria-hidden="true" />
                                <span className="mono truncate">
                                  {session.STUDY_SESSION_START_TIME}–{session.STUDY_SESSION_END_TIME}
                                </span>
                              </span>
                              <span className="flex items-center gap-1 text-[9.5px] text-ink-3">
                                <Users size={9} className="shrink-0" aria-hidden="true" />
                                <span className="truncate">{tr('Group:')} {session.TEACHING_GROUP_ID}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
  
              {sessions.length === 0 && (
                <div className="border-t border-line px-6 py-10 text-center">
                  <p className="text-[12.5px] font-medium text-ink-2">{tr('No sessions scheduled for this week and group.')}</p>
                  <p className="mt-1 text-[11px] text-ink-3">
                    {tr('Choose another week or group above.')}
                  </p>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {/* The same grid, read for the windows the teacher declared instead of
          the classes they give. Hard windows are painted red, soft amber. */}
      {activeView === 'constraints' && constraintSettings.enabled && (
        <Panel>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-surface-muted px-3 py-2">
            <ShieldAlert size={12} className="text-ink-3" aria-hidden="true" />
            <span className="text-[11.5px] font-medium text-ink">{tr('Constraints timetable')}</span>
            <span className="mono text-[10px] text-ink-3">{weekLabel || tr('No week selected')}</span>
            <div className="ms-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-danger)' }} aria-hidden="true" />
                {tr('Hard — unavailable')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-warning)' }} aria-hidden="true" />
                {tr('Soft — not recommended')}
              </span>
            </div>
          </div>

          {constraintsLoading ? (
            <div role="status" aria-live="polite" className="space-y-1.5 p-3">
              <span className="sr-only">{tr('Loading constraints…')}</span>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-10 rounded-[3px] bg-surface-muted" aria-hidden="true" />
              ))}
            </div>
          ) : constraints.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-[12.5px] font-medium text-ink-2">{tr('No constraints to show in the timetable.')}</p>
              <p className="mt-1 text-[11px] text-ink-3">{tr('Add a window below and it appears here.')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                {days.length === 0 && (
                  <div className="border-b border-line px-3 py-2 text-[11px] text-ink-3">
                    {tr('This week has no study days yet.')}
                  </div>
                )}

                <div
                  style={{ gridTemplateColumns: `repeat(${days.length + 1}, minmax(0, 1fr))` }}
                  className="grid border-b border-line bg-surface-muted"
                >
                  <div className="border-e border-line px-2 py-2">
                    <span className="kicker text-[8.5px]">{tr('Time')}</span>
                  </div>
                  {days.map(day => (
                    <div key={day.STUDY_DAY_ID} className="border-e border-line px-2 py-2 text-center last:border-e-0">
                      <div className="text-[11px] font-medium text-ink">{weekdayName(day.STUDY_DAY_DATE)}</div>
                      <div className="mono text-[9px] text-ink-3">{formatDayShort(day.STUDY_DAY_DATE)}</div>
                    </div>
                  ))}
                </div>

                <div
                  style={{ gridTemplateColumns: `repeat(${days.length + 1}, minmax(0, 1fr))` }}
                  className="grid"
                >
                  {/* Column 0: hour labels */}
                  <div className="border-e border-line bg-surface-muted/40">
                    {HOURS.map(hour => (
                      <div
                        key={hour}
                        style={{ height: `${ROW_H}px` }}
                        className="flex items-start justify-end border-b border-line/70 px-2 py-1 last:border-b-0"
                      >
                        <span className="mono text-[9.5px] leading-none text-ink-3">{String(hour).padStart(2, '0')}:00</span>
                      </div>
                    ))}
                  </div>

                  {/* One column per study day of the selected week */}
                  {days.map(day => {
                    const dayConstraints = constraints.filter(c => String(c.STUDY_DAY_ID) === String(day.STUDY_DAY_ID))

                    return (
                      <div
                        key={day.STUDY_DAY_ID}
                        style={{ height: `${HOURS.length * ROW_H}px` }}
                        className="relative border-e border-line/70 last:border-e-0"
                      >
                        {/* Background hour slots */}
                        {HOURS.map(hour => (
                          <div key={hour} style={{ height: `${ROW_H}px` }} className="border-b border-line/70 last:border-b-0" />
                        ))}

                        {/* Constraint blocks, placed by their start and end time */}
                        {dayConstraints.map(constraint => {
                          const hard = String(constraint.CONSTRAINT_KIND).toUpperCase() === 'HARD'
                          const [startH, startM] = (constraint.CONSTRAINT_START_TIME || '08:00').split(':').map(Number)
                          const [rawEndH, endM] = (constraint.CONSTRAINT_END_TIME || '10:00').split(':').map(Number)

                          const firstHour = HOURS[0] || 6
                          // 00:00 ends the day: treat it as 24:00 so the block reaches midnight.
                          const endH = rawEndH < firstHour ? rawEndH + 24 : rawEndH
                          const startMin = Math.max(0, (startH - firstHour) * 60 + startM)
                          const endMin = Math.min(HOURS.length * 60, (endH - firstHour) * 60 + endM)

                          const topPx = (startMin / 60) * ROW_H
                          const heightPx = Math.max(26, ((endMin - startMin) / 60) * ROW_H)
                          const accent = hard ? 'var(--color-danger)' : 'var(--color-warning)'
                          const accentInk = hard ? 'var(--color-danger-ink)' : 'var(--color-warning-ink)'

                          return (
                            <div
                              key={constraint.TEACHER_CONSTRAINT_ID}
                              title={constraint.CONSTRAINT_NOTE || undefined}
                              aria-label={`${constraintKindLabel(constraint.CONSTRAINT_KIND)} · ${String(constraint.CONSTRAINT_START_TIME || '').slice(0, 5)}–${String(constraint.CONSTRAINT_END_TIME || '').slice(0, 5)}${constraint.CONSTRAINT_NOTE ? ` · ${constraint.CONSTRAINT_NOTE}` : ''}`}
                              role="note"
                              style={{
                                position: 'absolute',
                                top: `${topPx}px`,
                                height: `${heightPx}px`,
                                left: '4px',
                                width: 'calc(100% - 8px)',
                                zIndex: 10,
                                background: `color-mix(in srgb, ${accent} 12%, var(--color-surface))`,
                                borderInlineStart: `2px solid ${accent}`
                              }}
                              className="overflow-hidden rounded-[3px] px-1.5 py-1"
                            >
                              <span className="mono block text-[9px] leading-none" style={{ color: accentInk }}>
                                {constraintKindLabel(constraint.CONSTRAINT_KIND)}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[9.5px] text-ink-3">
                                <Clock size={9} className="shrink-0" aria-hidden="true" />
                                <span className="mono truncate">
                                  {String(constraint.CONSTRAINT_START_TIME || '').slice(0, 5)}–{String(constraint.CONSTRAINT_END_TIME || '').slice(0, 5)}
                                </span>
                              </span>
                              {constraint.CONSTRAINT_NOTE && heightPx > 44 && (
                                <span className="mt-0.5 block truncate text-[9.5px] leading-[12px] text-ink-2">
                                  {constraint.CONSTRAINT_NOTE}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </Panel>
      )}

      {/* Declaring a window: the button that opens the form, and the list of
          what is already saved for the selected week. */}
      {activeView === 'constraints' && constraintSettings.enabled && (
        <Panel>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-surface-muted px-3 py-2">
            <ShieldAlert size={12} className="text-ink-3" aria-hidden="true" />
            <span className="text-[11.5px] font-medium text-ink">{tr('Weekly constraints')}</span>
            <span className="mono text-[10px] text-ink-3">
              {constraints.length} {constraints.length === 1 ? tr('window') : tr('windows')}
            </span>
            <span className="ms-auto hidden text-[10px] text-ink-3 sm:inline">
              {tr('Hard means unavailable. Soft means not recommended.')}
            </span>
            <button
              type="button"
              onClick={openConstraintModal}
              className="inline-flex h-6 items-center gap-1.5 rounded-[3px] bg-jade-solid px-2 text-[10.5px] font-semibold text-on-jade hover:opacity-90"
            >
              <Plus size={11} /> {tr('Add Constraints')}
            </button>
          </div>

          <div className="space-y-3 px-3 py-2.5">
            <p className="max-w-3xl text-[11.5px] leading-relaxed text-ink-2">
              {tr('Tell the scheduler when you are unavailable (hard) or would rather not teach (soft). They apply to the selected week only.')}
            </p>

            {constraintError && (
              <p className="text-[11px]" style={{ color: 'var(--color-danger-ink)' }}>{constraintError}</p>
            )}
            {constraintNotice && (
              <p className="text-[11px]" style={{ color: 'var(--color-success-ink)' }}>{constraintNotice}</p>
            )}

            <div className="divide-y divide-line rounded-[4px] border border-line">
              {constraintsLoading ? (
                <div className="px-3 py-3 text-[11px] text-ink-3">{tr('Loading constraints…')}</div>
              ) : constraints.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-ink-3">
                  {tr('No constraints for this week.')}
                </div>
              ) : (
                constraints.map((constraint) => {
                  const hard = String(constraint.CONSTRAINT_KIND).toUpperCase() === 'HARD'
                  return (
                    <div key={constraint.TEACHER_CONSTRAINT_ID} className="flex items-start gap-2 px-3 py-2">
                      <span
                        className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: hard ? 'var(--color-danger)' : 'var(--color-warning)' }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-[11.5px] font-medium text-ink">{constraintKindLabel(constraint.CONSTRAINT_KIND)}</span>
                          <span className="mono text-[10px] text-ink-3">
                            {constraint.STUDY_DAY_DATE ? formatDateLabel(constraint.STUDY_DAY_DATE) : '—'} · {String(constraint.CONSTRAINT_START_TIME || '').slice(0, 5)}–{String(constraint.CONSTRAINT_END_TIME || '').slice(0, 5)}
                          </span>
                          {localizedLabel(constraint, 'TEACHER_CONSTRAINT_OPTION_LABEL') && (
                            <span className="text-[11px] text-ink-2">
                              {localizedLabel(constraint, 'TEACHER_CONSTRAINT_OPTION_LABEL')}
                            </span>
                          )}
                        </div>
                        {constraint.CONSTRAINT_NOTE && (
                          <p className="mt-0.5 text-[11px] leading-snug text-ink-2">{constraint.CONSTRAINT_NOTE}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeConstraint(constraint.TEACHER_CONSTRAINT_ID)}
                        disabled={deletingConstraintId === constraint.TEACHER_CONSTRAINT_ID}
                        aria-label={tr('Delete')}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink disabled:opacity-40"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </Panel>
      )}

      {/* The declaration form is short, so it opens over the page and leaves the
          timetable in place behind it. */}
      <Modal
        open={showConstraintModal && activeView === 'constraints' && constraintSettings.enabled}
        onClose={closeConstraintModal}
        title={tr('Add Constraints')}
        description={tr('Tell the scheduler when you are unavailable (hard) or would rather not teach (soft). They apply to the selected week only.')}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeConstraintModal}
              disabled={savingConstraint}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:opacity-40"
            >
              {tr('Cancel')}
            </button>
            <button
              type="submit"
              form="teacher-constraint-form"
              disabled={savingConstraint || days.length === 0 || constraintOptions.length === 0}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savingConstraint ? tr('Saving…') : (<><Plus size={11} /> {tr('Add constraint')}</>)}
            </button>
          </div>
        }
      >
        <form id="teacher-constraint-form" onSubmit={saveConstraint} className="space-y-2.5">
          <div>
            <label className="kicker mb-1 block text-[9px]" htmlFor="constraint-day">{tr('Day')}</label>
            <select
              id="constraint-day"
              value={constraintForm.STUDY_DAY_ID}
              onChange={(e) => setConstraintForm((prev) => ({ ...prev, STUDY_DAY_ID: e.target.value }))}
              className="field h-8 w-full text-[12px]"
              disabled={days.length === 0 || savingConstraint}
            >
              {days.length === 0 && <option value="">{tr('No day in this week')}</option>}
              {days.map((day) => (
                <option key={day.STUDY_DAY_ID} value={day.STUDY_DAY_ID}>
                  {formatDateLabel(day.STUDY_DAY_DATE)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="kicker mb-1 block text-[9px]">{tr('Predefined constraint')}</span>
            {constraintOptions.length === 0 ? (
              <p className="rounded-[4px] border border-line bg-canvas px-2.5 py-2 text-[11px] leading-snug text-ink-3">
                {tr('No predefined constraint yet. Ask an administrator to add the list in Settings.')}
              </p>
            ) : (
              <SearchSelect
                value={String(constraintForm.TEACHER_CONSTRAINT_OPTION_ID || '')}
                onChange={(next) => setConstraintForm((prev) => ({ ...prev, TEACHER_CONSTRAINT_OPTION_ID: next }))}
                options={constraintOptions.map((option) => ({
                  value: String(option.TEACHER_CONSTRAINT_OPTION_ID),
                  label: constraintOptionLabel(option)
                }))}
                placeholder={tr('Choose a predefined constraint…')}
                emptyLabel={tr('No predefined constraint yet. Ask an administrator to add the list in Settings.')}
                className="[&>button]:h-8 [&>button]:text-[12px]"
              />
            )}
          </div>

          {selectedConstraintOption && (
            <div className="rounded-[4px] border border-line bg-canvas px-2.5 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[11.5px] font-medium text-ink">
                  {constraintKindLabel(selectedConstraintOption.CONSTRAINT_KIND)}
                </span>
                <span className="mono text-[10px] text-ink-3">
                  {timeKey(selectedConstraintOption.CONSTRAINT_START_TIME)}–{timeKey(selectedConstraintOption.CONSTRAINT_END_TIME)}
                </span>
              </div>
              {localizedLabel(selectedConstraintOption, 'TEACHER_CONSTRAINT_OPTION_LABEL') && (
                <p className="mt-0.5 text-[11px] leading-snug text-ink-2">
                  {localizedLabel(selectedConstraintOption, 'TEACHER_CONSTRAINT_OPTION_LABEL')}
                </p>
              )}
              {selectedConstraintOption.CONSTRAINT_OPTION_NOTE && (
                <p className="mt-0.5 text-[10.5px] leading-snug text-ink-3">
                  {selectedConstraintOption.CONSTRAINT_OPTION_NOTE}
                </p>
              )}
            </div>
          )}

          {constraintError && (
            <p className="text-[11px] font-medium" style={{ color: 'var(--color-danger-ink)' }}>{constraintError}</p>
          )}
          <p className="text-[10.5px] leading-relaxed text-ink-3">
            {tr('Hard means unavailable. Soft means not recommended.')}
          </p>
        </form>
      </Modal>

      <SessionDetailsModal session={selectedSession} onClose={() => setSelectedSession(null)} />
    </div>
  )
}

export default TeacherSchedule
