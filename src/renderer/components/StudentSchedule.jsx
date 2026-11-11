import React, { useState, useEffect } from 'react'
import { formatDate } from '../dateFormat'
import { CalendarDays, Clock, MapPin, UserRound } from 'lucide-react'
import SessionDetailsModal from './SessionDetailsModal'
import { PageIntro, Panel } from './ui/PageHeader'
import { weekdayName, formatDayShort, pickCurrentYearId, pickCurrentSemesterId, pickCurrentWeekId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { tr } from '../i18n'

// One row per teaching hour, 06:00 through the 23:00 row that ends at 24:00.
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6) // 6 AM to midnight
const ROW_H = 80

const StudentSchedule = ({ user }) => {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSession, setSelectedSession] = useState(null)

  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [weeks, setWeeks] = useState([])
  const [days, setDays] = useState([])
  const [studentSection, setStudentSection] = useState(null)

  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')

  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester },
    { rows: weeks, pickId: pickCurrentWeekId, selectedId: selectedWeek, setSelectedId: setSelectedWeek }
  ])

  useEffect(() => {
    loadYears()
    loadStudentSection()
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
    // A student's sessions are determined by their teaching-group memberships
    // (not their home section), so we only need the week + the student id.
    if (selectedWeek && user?.personId) {
      loadSchedule(selectedWeek)
    } else {
      setSessions([])
    }
  }, [selectedWeek, user])

  useEffect(() => {
    if (selectedWeek) {
      loadWeekDays(selectedWeek)
    } else {
      setDays([])
    }
  }, [selectedWeek])

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

  const loadStudentSection = async () => {
    try {
      const result = await window.api.getStudentSections(user.id, user.personId)
      const data = result?.data || []
      if (data.length > 0) {
        setStudentSection(data[0])
      }
    } catch (err) {
      console.error('Failed to load student section', err)
    }
  }

  const loadSchedule = async (weekId) => {
    setLoading(true)
    try {
      if (!weekId || !user?.personId) {
        setSessions([])
        return
      }

      // Sessions come from the student's teaching-group memberships.
      const result = await window.api.getStudentSchedule(user.personId, weekId)
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

  return (
    <div className="space-y-4">
      <PageIntro
        kicker={tr('Teaching')}
        title={tr('My schedule')}
        meta={loading ? null : `${sessions.length} ${sessions.length === 1 ? tr('class') : tr('classes')}`}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('View your scheduled classes')}
        </p>
      </PageIntro>

      {/* Period: the three choices that define the grid below. */}
      <Panel>
        <div className="grid grid-cols-2 gap-2 px-3 py-2.5 lg:grid-cols-4 [&>div]:min-w-0">
          <div>
            <label htmlFor="student-schedule-year" className="kicker mb-1 block text-[8.5px]">{tr('Year')}</label>
            <select
              id="student-schedule-year"
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
            <label htmlFor="student-schedule-semester" className="kicker mb-1 block text-[8.5px]">{tr('Semester')}</label>
            <select
              id="student-schedule-semester"
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
            <label htmlFor="student-schedule-week" className="kicker mb-1 block text-[8.5px]">{tr('Week')}</label>
            <select
              id="student-schedule-week"
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

          <div>
            <span className="kicker mb-1 block text-[8.5px]">{tr('Section')}</span>
            <div className="field flex items-center text-[11px] text-ink-2">
              {studentSection?.SECTION_LABEL || tr('Not assigned')}
            </div>
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line bg-surface-muted px-3 py-2">
          <CalendarDays size={12} className="text-ink-3" aria-hidden="true" />
          <span className="text-[11.5px] font-medium text-ink">{weekLabel || tr('No week selected')}</span>
          {studentSection?.SECTION_LABEL && (
            <span className="mono text-[10px] text-ink-3">{tr('Section:')} {studentSection.SECTION_LABEL}</span>
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

                      {/* Class cards, placed by their start and end time */}
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
                              <UserRound size={9} className="shrink-0" aria-hidden="true" />
                              <span className="truncate">{session.INSTRUCTOR_NAME}</span>
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
                <p className="text-[12.5px] font-medium text-ink-2">{tr('No classes scheduled for this week.')}</p>
                <p className="mt-1 text-[11px] text-ink-3">{tr('Choose another week above.')}</p>
              </div>
            )}
          </div>
        )}
      </Panel>

      <SessionDetailsModal session={selectedSession} onClose={() => setSelectedSession(null)} />
    </div>
  )
}

export default StudentSchedule
