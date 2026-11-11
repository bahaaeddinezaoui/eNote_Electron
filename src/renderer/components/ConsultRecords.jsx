import React, { useState, useEffect, useRef } from 'react'
import { formatDate, formatTime as formatTimeValue } from '../dateFormat'
import DataTable from './ui/DataTable'
import {
  Calendar,
  Clock,
  MapPin,
  Users,
  UserCheck,
  UserX,
  Notebook,
  AlertCircle,
  ListChecks,
  UserRound,
  MessageSquare,
  FileText,
  IdCard,
  FileDown
} from 'lucide-react'
import { formatDayShort, formatDateLong, toDateString, pickCurrentYearId, pickCurrentSemesterId, pickCurrentWeekId, pickCurrentSessionId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { tr } from '../i18n'
import { PageIntro, StateMark } from './ui/PageHeader'
import RecordComments from './RecordComments'
import FilterBar, { FilterField, FilterSearchField, filterInputCls } from './ui/FilterBar'
import Modal from './ui/Modal'
import PhotoZoom from './ui/PhotoZoom'
import StudentReportDialog from './StudentReportDialog'
import StudentRecordCard from './StudentRecordCard'

// Format a DB timestamp (JS Date or ISO string) as a short time.
const formatTime = (value) => {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (isNaN(d.getTime())) return String(value)
  return formatTimeValue(d, { hour: '2-digit', minute: '2-digit' })
}

// A record's comment count, opening the directors' thread for it. A record
// nobody has commented on yet still offers the action.
const CommentCount = ({ count, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-[3px] border px-1.5 text-[10px] font-medium transition-colors ${
      count > 0
        ? 'border-line-strong bg-selection text-ink'
        : 'border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink'
    }`}
  >
    <MessageSquare size={10} strokeWidth={1.9} />
    {count > 0 ? count : tr('Comment')}
  </button>
)

// The roster row stores the photo's path; the thumbnail is filled in once the
// main process has turned it into a data URL, and keeps its initials until then.
const StudentAvatar = ({ student, photo, large = false }) => {
  const initials = `${student?.PERSON_FIRST_NAME?.[0] || ''}${student?.PERSON_LAST_NAME?.[0] || ''}`.toUpperCase()
  const box = large ? 'h-40 w-40 text-[36px]' : 'h-24 w-24 text-[24px]'
  return (
    <span className={`serif grid shrink-0 place-items-center overflow-hidden rounded-[3px] border border-line-strong bg-surface-muted text-ink-3 ${box}`}>
      {photo
        ? <PhotoZoom src={photo} alt={`${student?.PERSON_FIRST_NAME || ''} ${student?.PERSON_LAST_NAME || ''}`.trim() || tr('Student')} />
        : initials || '?'}
    </span>
  )
}

// The three ways out of a row: this session's record, the student's full file,
// and the printable report.
const RecordActions = ({ onOpenRecord, onOpenFullRecord, onExport }) => {
  const buttonCls = 'inline-flex h-6 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-1.5 text-[10px] text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink'
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" onClick={onOpenRecord} className={buttonCls}>
        <FileText size={10} strokeWidth={1.9} aria-hidden="true" /> {tr('Open Record')}
      </button>
      <button type="button" onClick={onOpenFullRecord} className={buttonCls}>
        <IdCard size={10} strokeWidth={1.9} aria-hidden="true" /> {tr('Open Full Record')}
      </button>
      <button type="button" onClick={onExport} className={buttonCls}>
        <FileDown size={10} strokeWidth={1.9} aria-hidden="true" /> {tr('Export Report')}
      </button>
    </div>
  )
}

const ConsultRecords = ({ user }) => {
  // Week navigation (year → semester → week → sessions)
  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [weeks, setWeeks] = useState([])
  const [sessions, setSessions] = useState([])

  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [selectedSession, setSelectedSession] = useState(null)
  const [fullRecord, setFullRecord] = useState(null)

  // Keep the week/session on the current day while the page stays open.
  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester },
    { rows: weeks, pickId: pickCurrentWeekId, selectedId: selectedWeek, setSelectedId: setSelectedWeek },
    { rows: sessions, pickId: pickCurrentSessionId, selectedId: selectedSessionId, setSelectedId: setSelectedSessionId }
  ])

  // Session-list filters (day / major / teacher)
  const [selectedDay, setSelectedDay] = useState('')
  const [selectedMajor, setSelectedMajor] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')

  // Session records (read-only)
  const [students, setStudents] = useState([])
  const [absences, setAbsences] = useState([])
  const [observations, setObservations] = useState([])

  const [loading, setLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('absences')

  // Table filters (status / justification)
  const [statusFilter, setStatusFilter] = useState('all')
  const [justificationFilter, setJustificationFilter] = useState('all')

  // Director comments on one absence or observation, opened in a dialog.
  // { key, title, detail } — the record's stable identity plus what the header
  // needs to say which record is being discussed.
  const [commentTarget, setCommentTarget] = useState(null)

  // Roster photos: one batched read per set of rows, cached by person id so
  // paging and tab switches never re-read the same file.
  const [photoCache, setPhotoCache] = useState({})
  const photosInFlight = useRef(new Set())
  const [recordStudent, setRecordStudent] = useState(null)
  const [reportStudent, setReportStudent] = useState(null)
  useEffect(() => {
    const wanted = students
      .map((student) => ({
        id: Number(student.PERSON_ID),
        path: student.PERSON_PHOTO || student.person_photo || null
      }))
      .filter((entry) => entry.path
        && photoCache[entry.id] === undefined
        && !photosInFlight.current.has(entry.id))
    if (wanted.length === 0) return

    wanted.forEach((entry) => photosInFlight.current.add(entry.id))
    window.api.readPersonPhotos(wanted.map((entry) => entry.path))
      .then((res) => {
        const dataUrls = res?.dataUrls || []
        setPhotoCache((prev) => {
          const next = { ...prev }
          wanted.forEach((entry, index) => { next[entry.id] = dataUrls[index] || null })
          return next
        })
      })
      // A photo that cannot be read is not an error: the row keeps its initials.
      .catch(() => {})
      .finally(() => { wanted.forEach((entry) => photosInFlight.current.delete(entry.id)) })
  }, [students, photoCache])

  useEffect(() => {
    loadYears()
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
    loadSessions(selectedWeek)
  }, [selectedWeek])

  useEffect(() => {
    if (selectedSessionId) {
      const sess = sessions.find(s => s.STUDY_SESSION_ID === parseInt(selectedSessionId))
      setSelectedSession(sess || null)
      if (sess) loadSessionData(sess.STUDY_SESSION_ID)
    } else {
      setSelectedSession(null)
      setStudents([])
      setAbsences([])
      setObservations([])
    }
  }, [selectedSessionId, sessions])

  // Reset table filters whenever the consulted session changes.
  useEffect(() => {
    setStatusFilter('all')
    setJustificationFilter('all')
    setSearchTerm('')
  }, [selectedSessionId])

  // Distinct filter options derived from the sessions of the selected week.
  const dayOptions = [...new Set(
    sessions.map(s => toDateString(s.STUDY_DAY_DATE)).filter(Boolean)
  )].sort()
  const majorOptions = [...new Set(sessions.map(s => s.MAJOR_LABEL).filter(Boolean))].sort()
  const teacherOptions = [...new Set(sessions.map(s => s.INSTRUCTOR_NAME).filter(Boolean))].sort()

  const filteredSessions = sessions.filter(s => {
    if (selectedDay && toDateString(s.STUDY_DAY_DATE) !== selectedDay) return false
    if (selectedMajor && s.MAJOR_LABEL !== selectedMajor) return false
    if (selectedTeacher && s.INSTRUCTOR_NAME !== selectedTeacher) return false
    return true
  })

  const loadYears = async () => {
    try {
      const result = await window.api.getStudyYears()
      const data = result?.data || []
      setYears(data)
      if (data.length > 0) {
        setSelectedYear(pickCurrentYearId(data))
      } else {
        setLoading(false)
      }
    } catch (err) {
      console.error('Failed to load study years', err)
      setLoading(false)
    }
  }

  const loadSemesters = async (yearId) => {
    try {
      const result = await window.api.getStudySemesters(yearId)
      const data = result?.data || []
      setSemesters(data)
      setSelectedSemester(data.length > 0 ? pickCurrentSemesterId(data) : '')
    } catch (err) {
      console.error('Failed to load semesters', err)
    }
  }

  const loadWeeks = async (semesterId) => {
    try {
      const result = await window.api.getStudyWeeks(semesterId)
      const data = result?.data || []
      setWeeks(data)
      setSelectedWeek(data.length > 0 ? pickCurrentWeekId(data) : '')
    } catch (err) {
      console.error('Failed to load weeks', err)
    }
  }

  const loadSessions = async (weekId) => {
    try {
      if (!weekId) {
        setSessions([])
        setSelectedSessionId('')
        setLoading(false)
        return
      }
      const result = await window.api.getSchedule(user?.id, weekId)
      const data = result?.data || []
      setSessions(data)
      setLoading(false)
      if (data.length > 0) {
        // Focus today's session (nearest to now) when the week has one, else
        // the most recent session of the week.
        setSelectedSessionId(pickCurrentSessionId(data))
      } else {
        setSelectedSessionId('')
      }
      // New week: clear session-list filters.
      setSelectedDay('')
      setSelectedMajor('')
      setSelectedTeacher('')
    } catch (err) {
      console.error('Failed to load sessions', err)
      setLoading(false)
    }
  }

  const loadSessionData = async (sessionId) => {
    setDataLoading(true)
    try {
      const [studentsResult, absencesResult, observationsResult] = await Promise.all([
        window.api.getSessionStudentsForAbsence(sessionId),
        window.api.getAbsencesForSession(sessionId),
        window.api.getObservationsForSession(sessionId)
      ])
      setStudents(studentsResult?.data || [])
      setAbsences(absencesResult?.data || [])
      setObservations(observationsResult?.data || [])
    } catch (err) {
      console.error('Failed to load session records', err)
      setStudents([])
      setAbsences([])
      setObservations([])
    } finally {
      setDataLoading(false)
    }
  }

  // Keep the row's badge in step with the thread the dialog just rendered.
  const applyCommentCount = (count) => {
    const key = commentTarget?.key
    if (!key) return
    const bump = list => list.map(r => (r.RECORD_KEY === key ? { ...r, COMMENT_COUNT: count } : r))
    setAbsences(bump)
    setObservations(bump)
  }

  const openAbsenceThread = (student, absence) => {
    if (!absence?.RECORD_KEY) return
    setCommentTarget({
      key: absence.RECORD_KEY,
      title: `${student.PERSON_FIRST_NAME} ${student.PERSON_LAST_NAME}`,
      detail: [
        tr('Absence'),
        absence.ABSENCE_JUSTIFICATION_LABEL,
        formatDateLong(selectedSession?.STUDY_DAY_DATE),
        [selectedSession?.STUDY_SESSION_START_TIME, selectedSession?.STUDY_SESSION_END_TIME].filter(Boolean).join(' – ')
      ].filter(Boolean).join(' · ')
    })
  }

  const openObservationThread = (student, observation) => {
    if (!observation?.RECORD_KEY) return
    setCommentTarget({
      key: observation.RECORD_KEY,
      title: `${student.PERSON_FIRST_NAME} ${student.PERSON_LAST_NAME}`,
      detail: [
        observation.OBSERVATION_MOTIF_LABEL,
        formatTime(observation.OBSERVATION_DATETIME),
        formatDateLong(selectedSession?.STUDY_DAY_DATE),
        selectedSession?.INSTRUCTOR_NAME
      ].filter(Boolean).join(' · ')
    })
  }

  // The student's complete file, read here and shown in a modal: consulting a
  // record should not pull the reader out of the session they are working on.
  const openFullRecord = async (student) => {
    const personId = student.PERSON_ID
    setFullRecord({ loading: true, student: null, profile: null, lookups: null, photo: null, error: '' })
    try {
      const [profile, lookups] = await Promise.allSettled([
        window.api.getStudentProfile(user?.id, personId),
        window.api.getProfileLookups()
      ])
      const full = profile.status === 'fulfilled' ? profile.value || null : null
      const lookupData = lookups.status === 'fulfilled' ? lookups.value || null : null
      if (!full?.detail) {
        const reason = profile.status === 'rejected' ? profile.reason : null
        throw reason || new Error(tr('Student record not found.'))
      }

      let photo = null
      const photoPath = full?.detail?.PERSON_PHOTO
      if (photoPath) {
        const read = await window.api.readPersonPhoto(photoPath)
        photo = read?.dataUrl || null
      }
      setFullRecord({ loading: false, student, profile: full, lookups: lookupData, photo, error: '' })
    } catch (err) {
      setFullRecord({ loading: false, student: null, profile: null, lookups: null, photo: null, error: err.message })
    }
  }

  const filteredStudents = students.filter(s => {
    const name = `${s.PERSON_FIRST_NAME} ${s.PERSON_LAST_NAME}`.toLowerCase()
    if (!name.includes(searchTerm.toLowerCase())) return false

    const absence = absences.find(a => a.PERSON_ID === s.PERSON_ID)
    if (statusFilter === 'present' && absence) return false
    if (statusFilter === 'absent' && !absence) return false

    if (justificationFilter !== 'all') {
      if (!absence) return false
      const isUnexcused = absence.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED'
      if (justificationFilter === 'unexcused' && !isUnexcused) return false
      if (justificationFilter === 'excused' && isUnexcused) return false
    }
    return true
  })

  // Stats
  const totalRoster = students.length
  const absentCount = absences.length
  const presentCount = totalRoster - absentCount
  const unexcusedCount = absences.filter(a => a.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED').length
  const excusedCount = absentCount - unexcusedCount
  const totalObservations = observations.length

  // The filter panel counts only the choices that narrow what is on
  // screen: the year, semester, week and session are where the page is, not a
  // filter over it.
  const activeFilterCount =
    (searchTerm ? 1 : 0) +
    (selectedDay ? 1 : 0) +
    (selectedMajor ? 1 : 0) +
    (selectedTeacher ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (justificationFilter !== 'all' ? 1 : 0)

  const clearRecordFilters = () => {
    setSearchTerm('')
    setSelectedDay('')
    setSelectedMajor('')
    setSelectedTeacher('')
    setStatusFilter('all')
    setJustificationFilter('all')
  }

  // The period lives in the filter panel now, so the masthead carries the week
  // the page is currently showing.
  const selectedWeekLabel =
    weeks.find(w => String(w.STUDY_WEEK_ID) === String(selectedWeek))?.STUDY_WEEK_LABEL || ''

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center" role="status">
        <span className="text-[12px] text-ink-3">{tr("Loading records...")}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Page header + week navigation */}
      <PageIntro
        kicker={tr('Records')}
        title={tr('Records Consultation')}
        meta={selectedWeekLabel || undefined}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{tr('Consult the absences and observations recorded by teachers')}</p>
      </PageIntro>

      {/* The page is full-bleed, so it owns its scroll region: the masthead
          stays put and everything below it moves. */}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">

      {/* Every control that narrows what the page shows sits behind one
          filter button in the toolbar: the period, the session filters, the
          session itself and the record filters. */}
      <FilterBar
        activeCount={activeFilterCount}
        onClear={clearRecordFilters}
        matchCount={filteredSessions.length}
        matchLabel="session"
        title={tr('Filters')}
      >
        <FilterSearchField
          label={tr('Student')}
          placeholder={tr('Search students by name...')}
          value={searchTerm}
          onChange={setSearchTerm}
        />

        <FilterField label={tr("Year")}>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className={filterInputCls}
            >
              {years.map(y => (
                <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>{y.STUDY_YEAR_LABEL}</option>
              ))}
            </select>
          </FilterField>

        <FilterField label={tr("Semester")}>
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className={filterInputCls}
              disabled={!selectedYear}
            >
              {semesters.map(s => (
                <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>{s.STUDY_SEMESTER_LABEL}</option>
              ))}
            </select>
          </FilterField>

        <FilterField label={tr("Week")}>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              className={filterInputCls}
              disabled={!selectedSemester}
            >
              {weeks.map(w => (
                <option key={w.STUDY_WEEK_ID} value={w.STUDY_WEEK_ID}>
                  {w.STUDY_WEEK_LABEL} ({formatDate(new Date(w.STUDY_WEEK_START_DATE))} - {formatDate(new Date(w.STUDY_WEEK_END_DATE))})
                </option>
              ))}
            </select>
          </FilterField>

          {sessions.length > 0 && (
            <>
              <FilterField label={tr("Day")}>
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  className={filterInputCls}
                >
                  <option value="">{tr("All days")}</option>
                  {dayOptions.map(d => (
                    <option key={d} value={d}>
                      {formatDateLong(d)}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label={tr("Major")}>
                <select
                  value={selectedMajor}
                  onChange={(e) => setSelectedMajor(e.target.value)}
                  className={filterInputCls}
                >
                  <option value="">{tr("All majors")}</option>
                  {majorOptions.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </FilterField>

              <FilterField label={tr("Teacher")}>
                <select
                  value={selectedTeacher}
                  onChange={(e) => setSelectedTeacher(e.target.value)}
                  className={filterInputCls}
                >
                  <option value="">{tr("All teachers")}</option>
                  {teacherOptions.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </FilterField>
            </>
          )}

          {/* The session label is the longest option on the page (day, hours,
              major, group, teacher), so it gets the whole row. */}
        <FilterField label={tr("Study Session")}>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className={filterInputCls}
            >
              <option value="">{tr("-- Choose a session --")}</option>
              {filteredSessions.map(s => (
                <option key={s.STUDY_SESSION_ID} value={s.STUDY_SESSION_ID}>
                  {formatDayShort(s.STUDY_DAY_DATE)} • {(s.STUDY_SESSION_START_TIME || '').substring(0, 5)} - {(s.STUDY_SESSION_END_TIME || '').substring(0, 5)} • {s.MAJOR_LABEL} • {s.TEACHING_GROUP_LABEL || `Group ${s.TEACHING_GROUP_ID}`} • {s.INSTRUCTOR_NAME || tr('No instructor')}
                </option>
              ))}
            </select>
          </FilterField>

          {/* Record filters: they narrow the two lists below, so they belong
              next to the session that fills them. */}
          {selectedSession && (
            <>
              <FilterField label={tr("Status")}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={filterInputCls}
                >
                  <option value="all">{tr("All statuses")}</option>
                  <option value="present">{tr("Present only")}</option>
                  <option value="absent">{tr("Absent only")}</option>
                </select>
              </FilterField>

              <FilterField label={tr("Justification")}>
                <select
                  value={justificationFilter}
                  onChange={(e) => setJustificationFilter(e.target.value)}
                  className={`${filterInputCls} disabled:opacity-50`}
                  disabled={statusFilter === 'present'}
                >
                  <option value="all">{tr("All justifications")}</option>
                  <option value="unexcused">{tr("Unexcused only")}</option>
                  <option value="excused">{tr("Excused only")}</option>
                </select>
              </FilterField>
            </>
          )}

        {filteredSessions.length === 0 && sessions.length > 0 && (
          <p className="border-t border-line pt-2 text-[10.5px] leading-snug text-ink-3">
            {tr("No sessions match the selected day / major / teacher filters.")}
          </p>
        )}
      </FilterBar>

      {sessions.length === 0 ? (
        <div className="rounded-[4px] border border-line bg-surface px-6 py-10 text-center">
          <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-[3px] border border-line-strong text-ink-3">
            <Calendar size={16} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <h2 className="text-[12.5px] font-semibold text-ink">{tr("No Sessions in This Week")}</h2>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-ink-3">{tr("There are no study sessions scheduled for the selected week. Pick another week to consult its records.")}</p>
        </div>
      ) : !selectedSession ? (
        <div className="rounded-[4px] border border-line bg-surface px-6 py-10 text-center">
          <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-[3px] border border-line-strong text-ink-3">
            <ListChecks size={16} strokeWidth={1.7} aria-hidden="true" />
          </div>
          <h2 className="text-[12.5px] font-semibold text-ink">{tr("Select a Session")}</h2>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-ink-3">{tr("Choose a study session above to consult its absences and observations.")}</p>
        </div>
      ) : (
        <>
          {/* Consulted session: identifying facts, then the record type. */}
          <div className="rounded-[4px] border border-line bg-surface px-3.5 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="kicker text-[9px]">{tr("Consulted Session")}</div>
                <h2 className="serif mt-1 truncate text-[22px] leading-[26px] text-ink">
                  {selectedSession.MAJOR_LABEL}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
                  <span className="inline-flex items-center gap-1"><Calendar size={11} aria-hidden="true" /> {formatDateLong(selectedSession.STUDY_DAY_DATE)}</span>
                  <span className="inline-flex items-center gap-1"><Clock size={11} aria-hidden="true" /> {selectedSession.STUDY_SESSION_START_TIME} – {selectedSession.STUDY_SESSION_END_TIME}</span>
                  <span className="inline-flex items-center gap-1"><MapPin size={11} aria-hidden="true" /> {selectedSession.CLASSROOM_LABEL || tr('N/A')}</span>
                  <span className="inline-flex items-center gap-1"><UserRound size={11} aria-hidden="true" /> {selectedSession.INSTRUCTOR_NAME || tr('N/A')}</span>
                  <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden="true" /> {selectedSession.TEACHING_GROUP_LABEL || `ID: ${selectedSession.TEACHING_GROUP_ID}`}</span>
                </div>
              </div>

              <div className="flex shrink-0 overflow-hidden rounded-[4px] border border-line-strong">
                {[
                  { id: 'absences', label: tr('Absences') },
                  { id: 'observations', label: tr('Observations') }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    aria-pressed={activeTab === tab.id}
                    className={`h-7 border-e border-line-strong px-3 text-[11px] font-medium last:border-e-0 ${
                      activeTab === tab.id ? 'bg-selection text-ink' : 'bg-surface text-ink-3 hover:text-ink'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
            </div>
            </div>
          </div>

          {activeTab === 'absences' ? (
            <div className="overflow-hidden rounded-[4px] border border-line bg-surface">
              <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2.5 text-[10.5px] text-ink-3">
                    <span>{filteredStudents.length} {tr("of")} {totalRoster} {tr("students")}</span>
                    <span style={{ color: 'var(--color-success-ink)' }}>{presentCount} {tr("present")}</span>
                    <span style={{ color: 'var(--color-danger-ink)' }}>{absentCount} {tr("absent")}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 divide-line border-b border-line sm:grid-cols-4 sm:divide-x">
                {[
                  { label: tr('Roster'), value: totalRoster },
                  { label: tr('Present'), value: presentCount, color: 'var(--color-success-ink)' },
                  { label: tr('Absent'), value: absentCount, color: 'var(--color-danger-ink)' },
                  { label: tr('Unexcused / Excused'), value: `${unexcusedCount} / ${excusedCount}`, color: 'var(--color-warning-ink)' }
                ].map((stat) => (
                  <div key={stat.label} className="px-3 py-2.5">
                    <div className="serif text-[20px] leading-[24px]" style={stat.color ? { color: stat.color } : undefined}>{stat.value}</div>
                    <div className="kicker mt-0.5 text-[9px]">{stat.label}</div>
                  </div>
                ))}
              </div>

              {dataLoading ? (
                <div className="px-3 py-10 text-center text-[11.5px] text-ink-3" role="status">{tr("Loading absences...")}</div>
              ) : filteredStudents.length === 0 ? (
                <div className="px-3 py-10 text-center text-[11.5px] text-ink-3">{tr("No students found matching your criteria.")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <DataTable
                    bodyClassName="divide-y divide-line text-[11.5px]"
                    className="w-full text-left border-collapse"
                    headClassName="border-b border-line bg-surface-muted text-ink-3"
                    columns={[
                      { key: 'c0', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("ID")}</> },
                      { key: 'c1', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("Student Name")}</> },
                      { key: 'c2', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("Status")}</> },
                      { key: 'c3', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("Justification")}</> },
                      { key: 'c4', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("Teacher's Note")}</> },
                      { key: 'c5', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("Comments")}</> },
                      { key: 'c6', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("Actions")}</> },
                    ]}
                  >
                      {filteredStudents.map(student => {
                        const studentAbsence = absences.find(a => a.PERSON_ID === student.PERSON_ID)
                        const isAbsent = !!studentAbsence
                        return (
                          <tr key={student.PERSON_ID} className={`transition-colors hover:bg-surface-muted/60 ${isAbsent ? 'bg-surface-muted/40' : ''}`}>
                            <td className="mono px-3 py-2.5 text-[10.5px] text-ink-3">#{student.PERSON_ID}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <StudentAvatar student={student} photo={photoCache[Number(student.PERSON_ID)]} />
                                <span className="truncate font-medium text-ink">
                                  {student.PERSON_FIRST_NAME} {student.PERSON_LAST_NAME}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <StateMark tone={isAbsent ? 'bad' : 'good'} className="text-[11px] text-ink-2">
                                {isAbsent ? tr('Absent') : tr('Present')}
                              </StateMark>
                            </td>
                            <td className="px-3 py-2.5">
                              {isAbsent ? (
                                <span
                                  className="mono inline-flex h-[18px] items-center rounded-[3px] border px-1.5 text-[9.5px] uppercase tracking-[0.04em]"
                                  style={studentAbsence.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED'
                                    ? { borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)', background: 'var(--color-warning-bg)', color: 'var(--color-warning-ink)' }
                                    : { borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-2)' }}
                                >
                                  {studentAbsence.ABSENCE_JUSTIFICATION_LABEL}
                                </span>
                              ) : (
                                <span className="text-ink-3">—</span>
                              )}
                            </td>
                            <td className="max-w-xs truncate px-3 py-2.5">
                              {isAbsent && studentAbsence.TEACHER_ABSENCE_NOTE ? (
                                <span className="text-[10.5px] text-ink-2" title={studentAbsence.TEACHER_ABSENCE_NOTE}>
                                  {studentAbsence.TEACHER_ABSENCE_NOTE}
                                </span>
                              ) : (
                                <span className="text-ink-3">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              {isAbsent ? (
                                <CommentCount
                                  count={studentAbsence.COMMENT_COUNT || 0}
                                  label={tr('Director comments on this absence')}
                                  onClick={() => openAbsenceThread(student, studentAbsence)}
                                />
                              ) : (
                                <span className="text-ink-3">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <RecordActions
                                onOpenRecord={() => setRecordStudent(student)}
                                onOpenFullRecord={() => openFullRecord(student)}
                                onExport={() => setReportStudent(student)}
                              />
                            </td>
                          </tr>
                        )
                      })}
                  </DataTable>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-hidden rounded-[4px] border border-line bg-surface">
              <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2.5 text-[10.5px] text-ink-3">
                  <span>{filteredStudents.length} {tr("of")} {totalRoster} {tr("students")}</span>
                  <span>{totalObservations} {tr("observations logged")}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 divide-line border-b border-line sm:grid-cols-4 sm:divide-x">
                {[
                  { label: tr('Roster'), value: totalRoster },
                  { label: tr('Active'), value: presentCount, color: 'var(--color-success-ink)' },
                  { label: tr('Absent'), value: absentCount, color: 'var(--color-danger-ink)' },
                  { label: tr('Logged'), value: totalObservations }
                ].map((stat) => (
                  <div key={stat.label} className="px-3 py-2.5">
                    <div className="serif text-[20px] leading-[24px]" style={stat.color ? { color: stat.color } : undefined}>{stat.value}</div>
                    <div className="kicker mt-0.5 text-[9px]">{stat.label}</div>
                  </div>
                ))}
              </div>

              {dataLoading ? (
                <div className="px-3 py-10 text-center text-[11.5px] text-ink-3" role="status">{tr("Loading observations...")}</div>
              ) : filteredStudents.length === 0 ? (
                <div className="px-3 py-10 text-center text-[11.5px] text-ink-3">{tr("No students found matching your criteria.")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <DataTable
                    bodyClassName="divide-y divide-line text-[11.5px]"
                    className="w-full text-left border-collapse"
                    headClassName="border-b border-line bg-surface-muted text-ink-3"
                    columns={[
                      { key: 'c0', className: "kicker w-24 px-3 py-2 text-[9px]", header: <>{tr("ID")}</> },
                      { key: 'c1', className: "kicker w-1/4 px-3 py-2 text-[9px]", header: <>{tr("Student Name")}</> },
                      { key: 'c2', className: "kicker w-32 px-3 py-2 text-[9px]", header: <>{tr("Status")}</> },
                      { key: 'c3', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("LogBehavioral Observations")}</> },
                      { key: 'c4', className: "kicker px-3 py-2 text-[9px]", header: <>{tr("Actions")}</> },
                    ]}
                  >
                      {filteredStudents.map(student => {
                        const isAbsent = absences.some(a => a.PERSON_ID === student.PERSON_ID)
                        const studentObs = observations.filter(o => o.PERSON_ID === student.PERSON_ID)
                        return (
                          <tr key={student.PERSON_ID} className={`transition-colors hover:bg-surface-muted/60 ${isAbsent ? 'bg-surface-muted/40' : ''}`}>
                            <td className="mono px-3 py-2.5 text-[10.5px] text-ink-3">#{student.PERSON_ID}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <StudentAvatar student={student} photo={photoCache[Number(student.PERSON_ID)]} />
                                <span className="truncate font-medium text-ink">
                                  {student.PERSON_FIRST_NAME} {student.PERSON_LAST_NAME}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5">
                              <StateMark tone={isAbsent ? 'bad' : 'good'} className="text-[11px] text-ink-2">
                                {isAbsent ? tr('Absent') : tr('Present')}
                              </StateMark>
                            </td>
                            <td className="px-3 py-2.5">
                              {isAbsent ? (
                                <div className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--color-danger-ink)' }}>
                                  <AlertCircle size={12} aria-hidden="true" />
                                  <span>{tr("Observations disabled (student absent)")}</span>
                                </div>
                              ) : studentObs.length === 0 ? (
                                <span className="text-[10.5px] italic text-ink-3">{tr("No behavior notes recorded")}</span>
                              ) : (
                                <div className="flex flex-col gap-2 py-1.5">
                                  {studentObs.map((obs, idx) => (
                                    <div
                                      key={`${obs.OBSERVATION_MOTIF_ID}-${obs.OBSERVATION_DATETIME}-${idx}`}
                                      className="rounded-[3px] border border-line bg-canvas p-2.5"
                                    >
                                      <div className="flex items-center space-x-2">
                                        <span className="mono inline-flex h-[18px] items-center rounded-[3px] border border-line-strong px-1.5 text-[9px] uppercase tracking-[0.04em] text-ink-2">
                                          {obs.OBSERVATION_MOTIF_LABEL}
                                        </span>
                                        {formatTime(obs.OBSERVATION_DATETIME) && (
                                          <span className="mono text-[9.5px] text-ink-3">{formatTime(obs.OBSERVATION_DATETIME)}</span>
                                        )}
                                      </div>
                                      {obs.TEACHER_OBSERVATION_NOTE && (
                                        <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-2">
                                          {obs.TEACHER_OBSERVATION_NOTE}
                                        </p>
                                      )}
                                      <div className="mt-2 flex items-center justify-end border-t border-line pt-2">
                                        <CommentCount
                                          count={obs.COMMENT_COUNT || 0}
                                          label={tr('Director comments on this observation')}
                                          onClick={() => openObservationThread(student, obs)}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <RecordActions
                                onOpenRecord={() => setRecordStudent(student)}
                                onOpenFullRecord={() => openFullRecord(student)}
                                onExport={() => setReportStudent(student)}
                              />
                            </td>
                          </tr>
                        )
                      })}
                  </DataTable>
                </div>
              )}
            </div>
          )}
        </>
      )}
      </div>

      <Modal
        open={!!fullRecord}
        onClose={() => setFullRecord(null)}
        title={tr('Student information')}
        maxWidth="max-w-[820px]"
      >
        {fullRecord?.loading ? (
          <p className="py-6 text-center text-[11.5px] text-ink-3">{tr('Loading the student record…')}</p>
        ) : fullRecord?.error ? (
          <p className="rounded-[4px] border border-danger/40 bg-danger-bg px-2.5 py-1.5 text-[11px] text-danger-ink">{fullRecord.error}</p>
        ) : (
          <StudentRecordCard
            card={fullRecord}
            lookups={fullRecord?.lookups}
            photoClassName="h-52 w-52 text-[40px]"
          />
        )}
      </Modal>

      <Modal
        open={!!recordStudent}
        onClose={() => setRecordStudent(null)}
        title={tr('Session record')}
        maxWidth="max-w-[560px]"
      >
        {recordStudent && (() => {
          const absence = absences.find(a => a.PERSON_ID === recordStudent.PERSON_ID)
          const studentObs = observations.filter(o => o.PERSON_ID === recordStudent.PERSON_ID)
          return (
            <div className="space-y-3.5">
              <div className="flex items-start gap-3 border-b border-line pb-3">
                <StudentAvatar
                  large
                  student={recordStudent}
                  photo={photoCache[Number(recordStudent.PERSON_ID)]}
                />
                <div className="min-w-0 flex-1">
                  <div className="serif truncate text-[19px] leading-tight text-ink">
                    {recordStudent.PERSON_FIRST_NAME} {recordStudent.PERSON_LAST_NAME}
                  </div>
                  <div className="mono mt-0.5 truncate text-[10px] text-ink-3">
                    #{recordStudent.PERSON_ID}
                    {selectedSession?.MAJOR_LABEL ? ` · ${selectedSession.MAJOR_LABEL}` : ''}
                    {selectedSession ? ` · ${formatDateLong(selectedSession.STUDY_DAY_DATE)}` : ''}
                  </div>
                  <div className="mt-1.5">
                    <StateMark tone={absence ? 'bad' : 'good'} className="text-[11px] text-ink-2">
                      {absence ? tr('Absent') : tr('Present')}
                    </StateMark>
                  </div>
                </div>
              </div>

              <section>
                <h3 className="kicker border-b border-line pb-1 text-[9px]">{tr('Absence')}</h3>
                {absence ? (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono inline-flex h-[18px] items-center rounded-[3px] border border-line-strong px-1.5 text-[9.5px] uppercase tracking-[0.04em] text-ink-2">
                        {absence.ABSENCE_JUSTIFICATION_LABEL}
                      </span>
                      <CommentCount
                        count={absence.COMMENT_COUNT || 0}
                        label={tr('Director comments on this absence')}
                        onClick={() => openAbsenceThread(recordStudent, absence)}
                      />
                    </div>
                    {absence.TEACHER_ABSENCE_NOTE && (
                      <p className="text-[11px] leading-relaxed text-ink-2">{absence.TEACHER_ABSENCE_NOTE}</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-ink-3">{tr('No absence recorded for this session.')}</p>
                )}
              </section>

              <section>
                <h3 className="kicker border-b border-line pb-1 text-[9px]">{tr('Observations')}</h3>
                {studentObs.length === 0 ? (
                  <p className="mt-2 text-[11px] text-ink-3">{tr('No observation recorded for this session.')}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {studentObs.map((obs, index) => (
                      <li key={`${obs.OBSERVATION_MOTIF_ID}-${obs.OBSERVATION_DATETIME}-${index}`} className="rounded-[3px] border border-line bg-canvas p-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mono inline-flex h-[18px] items-center rounded-[3px] border border-line-strong px-1.5 text-[9px] uppercase tracking-[0.04em] text-ink-2">
                            {obs.OBSERVATION_MOTIF_LABEL}
                          </span>
                          {formatTime(obs.OBSERVATION_DATETIME) && (
                            <span className="mono text-[9.5px] text-ink-3">{formatTime(obs.OBSERVATION_DATETIME)}</span>
                          )}
                          <span className="ms-auto">
                            <CommentCount
                              count={obs.COMMENT_COUNT || 0}
                              label={tr('Director comments on this observation')}
                              onClick={() => openObservationThread(recordStudent, obs)}
                            />
                          </span>
                        </div>
                        {obs.TEACHER_OBSERVATION_NOTE && (
                          <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-2">{obs.TEACHER_OBSERVATION_NOTE}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )
        })()}
      </Modal>

      <StudentReportDialog
        open={!!reportStudent}
        onClose={() => setReportStudent(null)}
        user={user}
        student={reportStudent}
      />

      <RecordComments
        user={user}
        open={!!commentTarget}
        onClose={() => setCommentTarget(null)}
        recordKey={commentTarget?.key}
        title={commentTarget?.title}
        detail={commentTarget?.detail}
        onCountChange={applyCommentCount}
      />
    </div>
  )
}

export default ConsultRecords