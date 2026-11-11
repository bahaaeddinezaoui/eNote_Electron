import React, { useEffect, useMemo, useState } from 'react'
import { formatDate, formatTime } from '../dateFormat'
import DataTable from './ui/DataTable'
import {
  CalendarDays, ChevronDown, Clock, MapPin, UserRound, Users, UserX, Notebook,
  Search, RefreshCw, Activity, AlertCircle, Tag, MessageSquare, IdCard, FileDown
} from 'lucide-react'
import { PageHeader } from './ui/PageHeader'
import FilterBar, { FilterField, FilterSearchField, filterInputCls } from './ui/FilterBar'
import Notice from './ui/Notice'
import Modal from './ui/Modal'
import RecordComments from './RecordComments'
import StudentReportDialog from './StudentReportDialog'
import StudentRecordCard from './StudentRecordCard'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import {
  formatDateLong, toDateString,
  pickCurrentYearId, pickCurrentSemesterId, pickCurrentWeekId
} from '../scheduleUtils'
import { tr } from '../i18n'
import { activatableRowProps } from './ui/tableA11y'

// Study sessions, as overseen by an Admin or a Director.
//
// One week at a time: every scheduled session with its subject, teaching group,
// teacher, room and type, and — on the same row — the absences and observations
// recorded against it, expandable to the individual records. The week is read in
// a single round-trip (see sessionRecordsService), so filtering across a whole
// timetable never turns into a query per session.

const clock = (value) => String(value || '').slice(0, 5)

const fmtRecordTime = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return isNaN(date.getTime())
    ? String(value)
    : formatTime(date, { hour: '2-digit', minute: '2-digit' })
}


const shortRange = (week) => {
  if (!week?.STUDY_WEEK_START_DATE || !week?.STUDY_WEEK_END_DATE) return ''
  const start = new Date(week.STUDY_WEEK_START_DATE)
  const end = new Date(week.STUDY_WEEK_END_DATE)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return ''
  const day = (d) => formatDate(d, { day: '2-digit', month: 'short' })
  return `${day(start)} – ${day(end)}`
}

// The two small actions every record line carries: the student behind it, and —
// for a director — the comment thread attached to it. The thread count is the
// number of comments already written, so a reader sees at a glance whether the
// record has been discussed.
const RecordActions = ({ studentName, personId, commentCount, canReadComments, canComment, onShowStudent, onOpenComments }) => (
  <span className="ms-auto inline-flex shrink-0 items-center gap-1">
    <button
      type="button"
      onClick={() => onShowStudent(personId)}
      title={`${tr('Student information')} · ${studentName}`}
      aria-label={`${tr('Student information')} · ${studentName}`}
      className="grid h-5 w-5 place-items-center rounded-[3px] border border-line-strong bg-surface text-ink-3 hover:bg-surface-muted hover:text-ink"
    >
      <IdCard size={11} strokeWidth={1.9} />
    </button>
    {canReadComments && (
      <button
        type="button"
        onClick={() => onOpenComments()}
        title={canComment ? tr('Director comments on this record') : tr('Read the director comments on this record')}
        className={`inline-flex h-5 items-center gap-1 rounded-[3px] border px-1 text-[9.5px] ${
          commentCount > 0
            ? 'border-line-strong bg-selection text-ink'
            : 'border-line bg-surface text-ink-3 hover:bg-surface-muted hover:text-ink'
        }`}
      >
        <MessageSquare size={10} strokeWidth={1.9} />
        <span className="mono">{commentCount}</span>
      </button>
    )}
  </span>
)

const AbsenceLine = ({ absence, ...actions }) => {
  const unexcused = absence.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED'
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
      <span className="text-[11.5px] font-medium text-ink">{absence.STUDENT_NAME}</span>
      <span
        className={`mono border px-1 text-[8.5px] uppercase tracking-[0.05em] ${
          unexcused ? 'border-danger/40 text-danger-ink' : 'border-line-strong text-ink-3'
        }`}
      >
        {absence.ABSENCE_JUSTIFICATION_LABEL || tr('Absent')}
      </span>
      <RecordActions
        studentName={absence.STUDENT_NAME}
        personId={absence.PERSON_ID}
        commentCount={absence.COMMENT_COUNT || 0}
        {...actions}
      />
      {absence.TEACHER_ABSENCE_NOTE && (
        <span className="w-full text-[10.5px] leading-relaxed text-ink-3">“{absence.TEACHER_ABSENCE_NOTE}”</span>
      )}
    </li>
  )
}

const ObservationLine = ({ observation, ...actions }) => (
  <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
    <span className="text-[11.5px] font-medium text-ink">{observation.STUDENT_NAME}</span>
    <span className="mono border border-line-strong px-1 text-[8.5px] uppercase tracking-[0.05em] text-ink-3">
      {observation.OBSERVATION_MOTIF_LABEL || tr('Observation')}
    </span>
    {observation.OBSERVATION_DATETIME && (
      <span className="mono text-[9.5px] text-ink-3">{fmtRecordTime(observation.OBSERVATION_DATETIME)}</span>
    )}
    <RecordActions
      studentName={observation.STUDENT_NAME}
      personId={observation.PERSON_ID}
      commentCount={observation.COMMENT_COUNT || 0}
      {...actions}
    />
    {observation.TEACHER_OBSERVATION_NOTE && (
      <span className="w-full text-[10.5px] leading-relaxed text-ink-3">“{observation.TEACHER_OBSERVATION_NOTE}”</span>
    )}
  </li>
)

const CountCell = ({ count, style }) => (count ? (
  <span className="mono inline-flex h-[19px] min-w-[19px] items-center justify-center border px-1 text-[10px]" style={style}>
    {count}
  </span>
) : <span className="text-ink-3">—</span>)

const SessionRecords = ({ user }) => {
  const canConsult = !!user && (user.roles?.includes('ADMIN') || user.roles?.includes('DIRECTOR'))

  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [weeks, setWeeks] = useState([])
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')

  const [sessions, setSessions] = useState([])
  const [totals, setTotals] = useState({ sessions: 0, absences: 0, unexcused: 0, observations: 0, withRecords: 0 })
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)

  const [search, setSearch] = useState('')
  const [dayFilter, setDayFilter] = useState('')
  const [teacherFilter, setTeacherFilter] = useState('')
  const [subjectFilter, setSubjectFilter] = useState('')
  const [recordsOnly, setRecordsOnly] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [studentCard, setStudentCard] = useState(null)
  const [commentsTarget, setCommentsTarget] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)

  // Commenting is a director privilege; the server enforces it again. An Admin
  // may read the threads from here, without adding to them.
  const canComment = !!user && user.roles?.includes('DIRECTOR')
  // The printable report is a director document, exactly as on the student
  // record page; the dialog asks which blocks and language before generating.
  const canExport = canComment
  const reportStudent = studentCard?.profile?.detail || studentCard?.student || null
  const canReadComments = canComment || !!user?.roles?.includes('ADMIN')

  // Keep the week on the current day while the page stays open.
  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester },
    { rows: weeks, pickId: pickCurrentWeekId, selectedId: selectedWeek, setSelectedId: setSelectedWeek }
  ])

  useEffect(() => {
    if (!canConsult) { setLoading(false); return }
    let active = true
    window.api.getStudyYears()
      .then((res) => {
        if (!active) return
        const rows = res?.data || []
        setYears(rows)
        if (rows.length) setSelectedYear(pickCurrentYearId(rows))
        else setLoading(false)
      })
      .catch((err) => {
        if (active) { setNotice({ type: 'error', text: err.message }); setLoading(false) }
      })
    return () => { active = false }
  }, [canConsult])

  useEffect(() => {
    if (!selectedYear) { setSemesters([]); setSelectedSemester(''); return }
    window.api.getStudySemesters(selectedYear)
      .then((res) => {
        const rows = res?.data || []
        setSemesters(rows)
        setSelectedSemester(rows.length ? pickCurrentSemesterId(rows) : '')
      })
      .catch((err) => setNotice({ type: 'error', text: err.message }))
  }, [selectedYear])

  useEffect(() => {
    if (!selectedSemester) { setWeeks([]); setSelectedWeek(''); return }
    window.api.getStudyWeeks(selectedSemester)
      .then((res) => {
        const rows = res?.data || []
        setWeeks(rows)
        setSelectedWeek(rows.length ? pickCurrentWeekId(rows) : '')
      })
      .catch((err) => setNotice({ type: 'error', text: err.message }))
  }, [selectedSemester])

  const loadWeek = async (weekId) => {
    if (!weekId) {
      setSessions([])
      setTotals({ sessions: 0, absences: 0, unexcused: 0, observations: 0, withRecords: 0 })
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await window.api.getWeekSessionRecords(user?.id, weekId)
      setSessions(res?.sessions || [])
      setTotals(res?.totals || { sessions: 0, absences: 0, unexcused: 0, observations: 0, withRecords: 0 })
      setExpandedId(null)
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (canConsult) loadWeek(selectedWeek) }, [selectedWeek])

  // The identity card behind a record line: the row already carries the name, so
  // the card adds the details a reader would otherwise leave the page to find.
  const openStudentCard = async (personId) => {
    setStudentCard({ loading: true, student: null, profile: null, lookups: null, photo: null, error: '' })
    try {
      // The week row only carries a summary; the full record lives behind the
      // profile service. Both are read together so the modal opens once, and a
      // failed profile still leaves the summary usable.
      const [info, profile, lookups] = await Promise.allSettled([
        window.api.getSessionStudentInfo(user?.id, personId),
        window.api.getStudentProfile(user?.id, personId),
        window.api.getProfileLookups()
      ])
      const student = info.status === 'fulfilled' ? info.value?.student || null : null
      const full = profile.status === 'fulfilled' ? profile.value || null : null
      const lookupData = lookups.status === 'fulfilled' ? lookups.value || null : null
      if (!student && !full?.detail) {
        const reason = profile.status === 'rejected' ? profile.reason : info.status === 'rejected' ? info.reason : null
        throw reason || new Error(tr('Student record not found.'))
      }

      let photo = null
      const photoPath = full?.detail?.PERSON_PHOTO || student?.PERSON_PHOTO
      if (photoPath) {
        const read = await window.api.readPersonPhoto(photoPath)
        photo = read?.dataUrl || null
      }
      setStudentCard({ loading: false, student, profile: full, lookups: lookupData, photo, error: '' })
    } catch (err) {
      setStudentCard({ loading: false, student: null, profile: null, lookups: null, photo: null, error: err.message })
    }
  }

  // Counting stays inside the nested shape: a comment posted or deleted here
  // updates the badge on the line it belongs to, without refetching the week.
  const setCommentCount = (recordKey, count) => {
    setSessions((prev) => prev.map((session) => ({
      ...session,
      ABSENCES: session.ABSENCES.map((absence) => (
        absence.RECORD_KEY === recordKey ? { ...absence, COMMENT_COUNT: count } : absence
      )),
      OBSERVATIONS: session.OBSERVATIONS.map((observation) => (
        observation.RECORD_KEY === recordKey ? { ...observation, COMMENT_COUNT: count } : observation
      ))
    })))
  }

  const currentWeek = useMemo(
    () => weeks.find((week) => String(week.STUDY_WEEK_ID) === String(selectedWeek)) || null,
    [weeks, selectedWeek]
  )

  // Filter options come from the week itself, so a filter never offers a value
  // that no session in view actually has.
  const dayOptions = useMemo(
    () => [...new Set(sessions.map((s) => toDateString(s.STUDY_DAY_DATE)).filter(Boolean))].sort(),
    [sessions]
  )
  const teacherOptions = useMemo(
    () => [...new Set(sessions.map((s) => s.INSTRUCTOR_NAME).filter(Boolean))].sort(),
    [sessions]
  )
  const subjectOptions = useMemo(
    () => [...new Set(sessions.map((s) => s.MAJOR_LABEL).filter(Boolean))].sort(),
    [sessions]
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return sessions.filter((session) => {
      if (dayFilter && toDateString(session.STUDY_DAY_DATE) !== dayFilter) return false
      if (teacherFilter && session.INSTRUCTOR_NAME !== teacherFilter) return false
      if (subjectFilter && session.MAJOR_LABEL !== subjectFilter) return false
      if (recordsOnly && session.ABSENCES.length === 0 && session.OBSERVATIONS.length === 0) return false
      if (!term) return true
      const haystack = [
        session.MAJOR_LABEL, session.TEACHING_GROUP_LABEL, session.INSTRUCTOR_NAME,
        session.CLASSROOM_LABEL, session.STUDY_SESSION_TYPE_LABEL,
        ...session.ABSENCES.flatMap((a) => [a.STUDENT_NAME, a.ABSENCE_JUSTIFICATION_LABEL, a.TEACHER_ABSENCE_NOTE]),
        ...session.OBSERVATIONS.flatMap((o) => [o.STUDENT_NAME, o.OBSERVATION_MOTIF_LABEL, o.TEACHER_OBSERVATION_NOTE])
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(term)
    })
  }, [sessions, dayFilter, teacherFilter, subjectFilter, recordsOnly, search])

  // Sessions grouped under their study day, in the timetable's own order.
  const grouped = useMemo(() => {
    const map = new Map()
    for (const session of filtered) {
      const key = toDateString(session.STUDY_DAY_DATE) || ''
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(session)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const resetFilters = () => {
    setSearch('')
    setDayFilter('')
    setTeacherFilter('')
    setSubjectFilter('')
    setRecordsOnly(false)
  }

  // Everything the filter panel edits, counted for its badge.
  const activeFilterCount =
    (search.trim() ? 1 : 0) +
    (dayFilter ? 1 : 0) +
    (subjectFilter ? 1 : 0) +
    (teacherFilter ? 1 : 0) +
    (recordsOnly ? 1 : 0)

  if (!canConsult) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="max-w-md text-center text-[12px] text-ink-3">
          {tr('Consulting study sessions requires the Admin or Director role.')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Oversight')}
        title={tr('Study sessions')}
        meta={[
          currentWeek?.STUDY_WEEK_LABEL,
          shortRange(currentWeek),
          `${totals.sessions} ${tr('sessions')}`,
          `${totals.absences} ${tr('absences')}`,
          `${totals.observations} ${tr('observations')}`
        ].filter(Boolean).join(' · ')}
        actions={
          <button
            type="button"
            onClick={() => loadWeek(selectedWeek)}
            disabled={loading || !selectedWeek}
            className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
          </button>
        }
      />

      <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-line px-5 py-2">
        <div className="w-[104px] min-w-0">
          <label className="field-label">{tr('Year')}</label>
          <select className="field h-7 text-[11.5px]" value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)}>
            {years.map((year) => (
              <option key={year.STUDY_YEAR_ID} value={year.STUDY_YEAR_ID}>{year.STUDY_YEAR_CODE}</option>
            ))}
          </select>
        </div>
        <div className="w-[126px] min-w-0">
          <label className="field-label">{tr('Semester')}</label>
          <select className="field h-7 text-[11.5px]" value={selectedSemester} onChange={(e) => setSelectedSemester(e.target.value)} disabled={semesters.length === 0}>
            {semesters.map((semester) => (
              <option key={semester.STUDY_SEMESTER_ID} value={semester.STUDY_SEMESTER_ID}>
                {semester.STUDY_SEMESTER_LABEL || semester.STUDY_SEMESTER_CODE}
              </option>
            ))}
          </select>
        </div>
        <div className="w-[132px] min-w-0">
          <label className="field-label">{tr('Week')}</label>
          <select className="field h-7 text-[11.5px]" value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} disabled={weeks.length === 0}>
            {weeks.map((week) => (
              <option key={week.STUDY_WEEK_ID} value={week.STUDY_WEEK_ID}>{week.STUDY_WEEK_LABEL}</option>
            ))}
          </select>
        </div>
        <FilterBar
          activeCount={activeFilterCount}
          onClear={resetFilters}
          matchCount={filtered.length}
          matchLabel="session"
        >
          <FilterSearchField
            placeholder={tr('Subject, group, teacher, student')}
            value={search}
            onChange={setSearch}
          />
          <FilterField label={tr('Day')}>
            <select
              className={filterInputCls}
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              aria-label={tr('Day')}
            >
              <option value="">{tr('All days')}</option>
              {dayOptions.map((day) => <option key={day} value={day}>{formatDateLong(day)}</option>)}
            </select>
          </FilterField>
          <FilterField label={tr('Subject')}>
            <select
              className={filterInputCls}
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              aria-label={tr('Subject')}
            >
              <option value="">{tr('All subjects')}</option>
              {subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}
            </select>
          </FilterField>
          <FilterField label={tr('Teacher')}>
            <select
              className={filterInputCls}
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              aria-label={tr('Teacher')}
            >
              <option value="">{tr('All teachers')}</option>
              {teacherOptions.map((teacher) => <option key={teacher} value={teacher}>{teacher}</option>)}
            </select>
          </FilterField>
          <button
            type="button"
            onClick={() => setRecordsOnly((value) => !value)}
            aria-pressed={recordsOnly}
            className={`inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] border px-2 text-[11px] ${
              recordsOnly
                ? 'border-line-strong bg-selection text-ink'
                : 'border-line bg-surface text-ink-3 hover:bg-surface-muted'
            }`}
          >
            <Activity size={11} /> {tr('With records only')}
          </button>
        </FilterBar>
        <span className="mono ms-auto self-center text-[10px] text-ink-3">
          {tr('Sessions, absences and observations of one week')}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-surface px-5 py-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <CalendarDays size={12} className="text-ink-3" /> <span className="mono">{totals.sessions}</span> {tr('sessions')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <UserX size={12} style={{ color: 'var(--color-danger-ink)' }} /> <span className="mono">{totals.absences}</span> {tr('absences')}
          <span className="mono text-[10px] text-ink-3">({totals.unexcused} {tr('unexcused')})</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <Notebook size={12} className="text-ink-3" /> <span className="mono">{totals.observations}</span> {tr('observations')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <Activity size={12} className="text-ink-3" /> <span className="mono">{totals.withRecords}</span> {tr('sessions with records')}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
        {loading ? (
          <div className="space-y-2 p-5" role="status" aria-label={tr('Loading study sessions')}>
            {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-8 rounded-[3px] bg-surface-muted" />)}
          </div>
        ) : !selectedWeek ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <CalendarDays size={22} className="text-ink-3" />
            <h2 className="serif mt-3 text-[22px] leading-tight text-ink">{tr('No week selected.')}</h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-ink-3">
              {tr('Choose a semester and a week above to consult its study sessions.')}
            </p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <CalendarDays size={22} className="text-ink-3" />
            <h2 className="serif mt-3 text-[22px] leading-tight text-ink">{tr('Nothing scheduled.')}</h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-ink-3">
              {tr('No study session is scheduled in this week.')}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <Search size={22} className="text-ink-3" />
            <h2 className="serif mt-3 text-[22px] leading-tight text-ink">{tr('No session matches.')}</h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-ink-3">
              {tr('Widen the search or clear the filters to see this week again.')}
            </p>
          </div>
        ) : (
          <DataTable
            className="data-table"
            label={tr('Study sessions')}
            columns={[
              { key: 'c0', width: 118, header: <>{tr('Time')}</> },
              { key: 'c1', header: <>{tr('Subject')}</> },
              { key: 'c2', width: 150, header: <>{tr('Group')}</> },
              { key: 'c3', width: 170, header: <>{tr('Teacher')}</> },
              { key: 'c4', width: 120, header: <>{tr('Room')}</> },
              { key: 'c5', width: 110, header: <>{tr('Type')}</> },
              { key: 'c6', width: 96, className: "num", header: <>{tr('Absent')}</> },
              { key: 'c7', width: 96, className: "num", header: <>{tr('Observations')}</> },
              { key: 'c8', width: 34 },
            ]}
          >
              {grouped.map(([day, daySessions]) => (
                <React.Fragment key={day}>
                  <tr>
                    <td
                      colSpan={9}
                      className="!bg-surface-muted !text-ink-3"
                      style={{ height: 26, borderBottomColor: 'var(--color-line-strong)' }}
                    >
                      <span className="mono text-[10px] uppercase tracking-[0.07em]">
                        {formatDateLong(day)} · {daySessions.length} {tr(daySessions.length === 1 ? 'session' : 'sessions')}
                      </span>
                    </td>
                  </tr>
                  {daySessions.map((session) => {
                    const expanded = expandedId === session.STUDY_SESSION_ID
                    const absentCount = session.ABSENCES.length
                    const observationCount = session.OBSERVATIONS.length
                    const hasRecords = absentCount > 0 || observationCount > 0
                    return (
                      <React.Fragment key={session.STUDY_SESSION_ID}>
                        <tr
                          data-open={expanded || undefined}
                          {...activatableRowProps(() => setExpandedId(expanded ? null : session.STUDY_SESSION_ID))}
                          onClick={() => setExpandedId(expanded ? null : session.STUDY_SESSION_ID)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className="mono text-[11px]">
                            {clock(session.STUDY_SESSION_START_TIME)}–{clock(session.STUDY_SESSION_END_TIME)}
                          </td>
                          <td className="max-w-0" style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            <span className="font-medium text-ink">{session.MAJOR_LABEL || '—'}</span>
                          </td>
                          <td className="text-[11.5px]">{session.TEACHING_GROUP_LABEL || `#${session.TEACHING_GROUP_ID || '—'}`}</td>
                          <td className="max-w-0" style={{ textOverflow: 'ellipsis', overflow: 'hidden' }}>
                            <span className="text-[11.5px]">{session.INSTRUCTOR_NAME || tr('No instructor')}</span>
                          </td>
                          <td className="text-[11.5px]">{session.CLASSROOM_LABEL || '—'}</td>
                          <td className="mono text-[10px] uppercase tracking-[0.04em] text-ink-3">
                            {tr(session.STUDY_SESSION_TYPE_LABEL || session.STUDY_SESSION_TYPE_CODE || '—')}
                          </td>
                          <td className="num">
                            <CountCell
                              count={absentCount}
                              style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger-ink)' }}
                            />
                          </td>
                          <td className="num">
                            <CountCell count={observationCount} style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-2)' }} />
                          </td>
                          <td className="!pe-2 text-end">
                            <ChevronDown
                              size={13}
                              className={`text-ink-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                              aria-hidden="true"
                            />
                          </td>
                        </tr>

                        {expanded && (
                          <tr>
                            <td colSpan={9} style={{ height: 'auto', whiteSpace: 'normal', padding: '10px 14px' }}>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={10} /> {clock(session.STUDY_SESSION_START_TIME)}–{clock(session.STUDY_SESSION_END_TIME)}
                                </span>
                                {session.CLASSROOM_LABEL && (
                                  <span className="inline-flex items-center gap-1"><MapPin size={10} /> {session.CLASSROOM_LABEL}</span>
                                )}
                                <span className="inline-flex items-center gap-1"><UserRound size={10} /> {session.INSTRUCTOR_NAME || tr('No instructor')}</span>
                                <span className="inline-flex items-center gap-1"><Users size={10} /> {session.TEACHING_GROUP_LABEL || '—'}</span>
                                {session.ROSTER > 0 && (
                                  <span className="inline-flex items-center gap-1">
                                    <Tag size={10} />
                                    {Math.max(0, session.ROSTER - absentCount)}/{session.ROSTER} {tr('present')}
                                  </span>
                                )}
                              </div>

                              <div className="mt-2 grid gap-3 md:grid-cols-2">
                                <div className="border border-line bg-canvas p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <UserX size={11} style={{ color: 'var(--color-danger-ink)' }} />
                                    <span className="kicker text-[9px]">{tr('Absences')}</span>
                                    <span className="mono ms-auto text-[9.5px] text-ink-3">{absentCount}</span>
                                  </div>
                                  {absentCount === 0 ? (
                                    <p className="mt-1.5 text-[10.5px] text-ink-3">{tr('No absence recorded for this session.')}</p>
                                  ) : (
                                    <ul className="mt-1 divide-y divide-line">
                                      {session.ABSENCES.map((absence) => (
                                        <AbsenceLine
                                          key={`${absence.PERSON_ID}`}
                                          absence={absence}
                                          canComment={canComment}
                                          canReadComments={canReadComments}
                                          onShowStudent={openStudentCard}
                                          onOpenComments={() => setCommentsTarget({
                                            key: absence.RECORD_KEY,
                                            title: `${absence.STUDENT_NAME} · ${tr('Absence')}`,
                                            detail: [
                                              session.MAJOR_LABEL,
                                              formatDateLong(day),
                                              `${clock(session.STUDY_SESSION_START_TIME)}–${clock(session.STUDY_SESSION_END_TIME)}`,
                                              absence.ABSENCE_JUSTIFICATION_LABEL
                                            ].filter(Boolean).join(' · ')
                                          })}
                                        />
                                      ))}
                                    </ul>
                                  )}
                                </div>

                                <div className="border border-line bg-canvas p-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <Notebook size={11} className="text-ink-3" />
                                    <span className="kicker text-[9px]">{tr('Observations')}</span>
                                    <span className="mono ms-auto text-[9.5px] text-ink-3">{observationCount}</span>
                                  </div>
                                  {observationCount === 0 ? (
                                    <p className="mt-1.5 text-[10.5px] text-ink-3">{tr('No observation recorded for this session.')}</p>
                                  ) : (
                                    <ul className="mt-1 divide-y divide-line">
                                      {session.OBSERVATIONS.map((observation, index) => (
                                        <ObservationLine
                                          key={`${observation.PERSON_ID}-${index}`}
                                          observation={observation}
                                          canComment={canComment}
                                          canReadComments={canReadComments}
                                          onShowStudent={openStudentCard}
                                          onOpenComments={() => setCommentsTarget({
                                            key: observation.RECORD_KEY,
                                            title: `${observation.STUDENT_NAME} · ${tr('Observation')}`,
                                            detail: [
                                              session.MAJOR_LABEL,
                                              formatDateLong(day),
                                              `${clock(session.STUDY_SESSION_START_TIME)}–${clock(session.STUDY_SESSION_END_TIME)}`,
                                              observation.OBSERVATION_MOTIF_LABEL
                                            ].filter(Boolean).join(' · ')
                                          })}
                                        />
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </React.Fragment>
              ))}
          </DataTable>
        )}

        {!loading && sessions.length > 0 && (
          <div className="flex items-start gap-2 border-t border-line px-5 py-2.5 text-[10.5px] text-ink-3">
            <AlertCircle size={12} className="mt-px shrink-0" />
            {tr('Absences and observations are recorded by teachers against the session; this page reads them as entered, and changes nothing.')}
          </div>
        )}
      </div>

      <Modal
        open={!!studentCard}
        onClose={() => setStudentCard(null)}
        title={tr('Student information')}
        maxWidth="max-w-[820px]"
        footer={canExport && studentCard && !studentCard.loading && !studentCard.error ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] text-ink-3">{tr('Read-only registry copy')}</span>
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              <FileDown size={12} strokeWidth={1.9} aria-hidden="true" />
              {tr('Export report')}
            </button>
          </div>
        ) : undefined}
      >
        {studentCard?.loading ? (
          <p className="py-6 text-center text-[11.5px] text-ink-3">{tr('Loading the student record…')}</p>
        ) : studentCard?.error ? (
          <p className="border border-danger/40 bg-danger-bg px-2.5 py-1.5 text-[11px] text-danger-ink">{studentCard.error}</p>
        ) : (
          <StudentRecordCard card={studentCard} lookups={studentCard?.lookups} />
        )}
      </Modal>

      {canExport && (
        <StudentReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          user={user}
          student={reportStudent}
        />
      )}

      {canReadComments && (
        <RecordComments
          user={user}
          open={!!commentsTarget}
          onClose={() => setCommentsTarget(null)}
          recordKey={commentsTarget?.key}
          title={commentsTarget?.title}
          detail={commentsTarget?.detail}
          readOnly={!canComment}
          onCountChange={(count) => {
            if (commentsTarget?.key) setCommentCount(commentsTarget.key, count)
          }}
        />
      )}

    </div>
  )
}

export default SessionRecords
