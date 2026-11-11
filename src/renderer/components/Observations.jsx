import React, { useState, useEffect, useRef } from 'react'
import { formatTime as formatTimeValue } from '../dateFormat'
import DataTable from './ui/DataTable'
import {
  AlertCircle, Calendar, CheckCircle, Clock, MapPin, Notebook, Plus, RefreshCw,
  Save, Search, Trash2, UserCheck, UserX
} from 'lucide-react'
import Button from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import PhotoZoom from './ui/PhotoZoom'
import Modal from './ui/Modal'
import { PageIntro, Panel } from './ui/PageHeader'
import { formatDateLong, toDateString } from '../scheduleUtils'
import { tr } from '../i18n'
import { mergePendingAbsences, mergePendingObservations } from '../offlineMerge'
import { initialsOf, usePersonPhotos } from '../personPhotos'

// Format a DB timestamp (JS Date or ISO string) as a short time.
const formatTime = (value) => {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (isNaN(d.getTime())) return String(value)
  return formatTimeValue(d, { hour: '2-digit', minute: '2-digit' })
}

// One number and its word: a plateau for the session totals, not a widget.
const Stat = ({ value, label }) => (
  <div className="px-3.5 py-2.5">
    <div className="mono text-[19px] leading-none text-ink">{value}</div>
    <div className="kicker mt-1.5 text-[8.5px] leading-none">{label}</div>
  </div>
)

const Observations = ({ user }) => {
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [selectedSession, setSelectedSession] = useState(null)

  const [students, setStudents] = useState([])
  const [absences, setAbsences] = useState([])
  const [observations, setObservations] = useState([])
  const [motifs, setMotifs] = useState([])

  const [loading, setLoading] = useState(true)
  const [rosterLoading, setRosterLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [activeStudent, setActiveStudent] = useState(null)
  const [observationForm, setObservationForm] = useState({
    OBSERVATION_MOTIF_ID: '',
    TEACHER_OBSERVATION_NOTE: ''
  })
  const [saving, setSaving] = useState(false)

  const [notification, setNotification] = useState(null)
  // Faces for the roster rows, read in one batch and cached by person id.
  const rosterPhotos = usePersonPhotos(students)

  // Guards against overlapping detection calls, and always holds the latest
  // reconcile closure for the periodic / focus re-checks.
  const reconcilingRef = useRef(false)
  const reconcileRef = useRef(null)

  const showNotice = (text, type = 'success') => {
    setNotification({ text, type })
    setTimeout(() => setNotification(null), 4000)
  }

  // Reconciles the page with the study session that is running right now. The
  // detection itself is performed by the main process (getTeacherCurrentSession),
  // which reads the OS date/time fresh on every call. This routine is re-run on
  // mount, when the window regains focus, and periodically, so a session starting
  // or ending (or the machine clock changing) is picked up without needing to
  // close and reopen the application.
  // Offline, the server cannot answer "which class is running now". The roster
  // warm-up keeps this teacher's sessions for the coming week on disk, so the
  // class in progress is found from that saved list instead.
  const findSessionInProgressLocally = async () => {
    const res = await window.api.getTeacherSessionsForPeriod(user.personId)
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const today = toDateString(now)
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    const rows = res?.data || []
    return (
      rows.find((row) => {
        const start = String(row.STUDY_SESSION_START_TIME || '')
        const end = String(row.STUDY_SESSION_END_TIME || '')
        return (
          toDateString(row.STUDY_DAY_DATE) === today &&
          start &&
          end &&
          start <= time &&
          time <= end
        )
      }) || null
    )
  }

  const reconcileCurrentSession = async ({ announce = false } = {}) => {
    if (!user?.personId || reconcilingRef.current) return
    reconcilingRef.current = true
    try {
      let activeSession = null
      try {
        const sessResult = await window.api.getTeacherCurrentSession(user.personId)
        activeSession = sessResult?.data?.[0] || null
      } catch (error) {
        // The server is unreachable: use the saved week. If that list is missing
        // as well, this is a real failure and is reported as before.
        try {
          activeSession = await findSessionInProgressLocally()
        } catch {
          throw error
        }
      }

      const nextSessionId = activeSession ? activeSession.STUDY_SESSION_ID : null
      const currentSessionId = selectedSession ? selectedSession.STUDY_SESSION_ID : null

      // Same session is still in progress (or there is still none): keep the
      // currently loaded roster, absences and observations untouched.
      if (nextSessionId === currentSessionId) return

      if (activeSession) {
        setSelectedSessionId(activeSession.STUDY_SESSION_ID)
        setSelectedSession(activeSession)
        loadSessionData(activeSession.STUDY_SESSION_ID)
        if (announce) showNotice(`Current study session detected: ${activeSession.MAJOR_LABEL}`, 'info')
      } else {
        // No study session is currently in progress for this teacher.
        setSelectedSessionId('')
        setSelectedSession(null)
        setStudents([])
        setAbsences([])
        setObservations([])
      }
    } catch (err) {
      console.error('Failed to detect the current study session', err)
      if (announce) showNotice(tr('Error loading initial details'), 'error')
    } finally {
      reconcilingRef.current = false
    }
  }
  reconcileRef.current = reconcileCurrentSession

  useEffect(() => {
    if (user?.personId) {
      loadInitialData()
    }
  }, [user])

  useEffect(() => {
    if (!user?.personId) return

    // Keep the current-session state in sync with the clock: re-check when the
    // window regains focus / becomes visible again and on a short interval while
    // the page is open.
    const recheck = () => reconcileRef.current?.({ announce: false })
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', handleVisibility)
    const intervalId = setInterval(recheck, 15000)

    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(intervalId)
    }
  }, [user?.personId])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      // 1. Load motifs (kept for offline use by the cache warm-up)
      const motifsResult = await window.api.getObservationMotifs()
      setMotifs(motifsResult?.data || [])
    } catch (err) {
      // Without the server the saved list still answers; if even that is missing
      // the session below is read and its own error is shown.
      console.warn('Observation motifs could not be read', err)
    }

    try {
      // 2. Detect and display the teacher's current study session.
      await reconcileCurrentSession({ announce: true })
    } catch (err) {
      console.error('Failed to load observations config', err)
      showNotice(tr('Error loading initial details'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadSessionData = async (sessionId) => {
    setRosterLoading(true)
    try {
      const studentsResult = await window.api.getSessionStudentsForAbsence(sessionId)
      const absencesResult = await window.api.getAbsencesForSession(sessionId)
      const observationsResult = await window.api.getObservationsForSession(sessionId)

      // Unsent work counts as part of the register here too: a student marked
      // absent offline is shown absent (and cannot be observed), and a note
      // queued from this page stays visible after a reload.
      const pending = await window.api.getSessionPending(sessionId).catch(() => null)
      const motifById = new Map(
        motifs.map((item) => [Number(item.OBSERVATION_MOTIF_ID), item])
      )

      setStudents(studentsResult?.data || [])
      setAbsences(mergePendingAbsences(absencesResult?.data || [], pending, new Map()))
      setObservations(mergePendingObservations(observationsResult?.data || [], pending, motifById))
    } catch (err) {
      console.error('Failed to load session roster, absences or observations', err)
      showNotice(tr('Failed to load roster data'), 'error')
    } finally {
      setRosterLoading(false)
    }
  }

  const handleOpenModal = (student) => {
    // Verify if student is absent
    const isAbsent = absences.some(a => a.PERSON_ID === student.PERSON_ID)
    if (isAbsent) {
      showNotice(tr('Cannot add observations to an absent student'), 'error')
      return
    }

    setActiveStudent(student)
    // Default to the first motif
    setObservationForm({
      OBSERVATION_MOTIF_ID: motifs[0]?.OBSERVATION_MOTIF_ID?.toString() || '',
      TEACHER_OBSERVATION_NOTE: ''
    })
    setShowModal(true)
  }

  const handleSaveObservation = async (e) => {
    e.preventDefault()
    if (!activeStudent || !selectedSessionId) return

    setSaving(true)
    try {
      const data = {
        PERSON_ID: activeStudent.PERSON_ID,
        STUDY_SESSION_ID: parseInt(selectedSessionId),
        OBSERVATION_MOTIF_ID: parseInt(observationForm.OBSERVATION_MOTIF_ID),
        PER_PERSON_ID: user.personId,
        TEACHER_OBSERVATION_NOTE: observationForm.TEACHER_OBSERVATION_NOTE.trim(),
        OBSERVATION_DATETIME: null // Will be generated automatically in the service
      }

      const result = await window.api.createObservation(data)

      if (result?.queued) {
        // The saved roster cannot include a record that only exists on this
        // computer yet, so it is shown here; the queue chip counts it.
        const motif = motifs.find(
          (item) => Number(item.OBSERVATION_MOTIF_ID) === data.OBSERVATION_MOTIF_ID
        )
        setObservations((previous) => [
          ...previous,
          {
            PERSON_ID: data.PERSON_ID,
            STUDY_SESSION_ID: data.STUDY_SESSION_ID,
            OBSERVATION_MOTIF_ID: data.OBSERVATION_MOTIF_ID,
            PER_PERSON_ID: data.PER_PERSON_ID,
            TEACHER_OBSERVATION_NOTE: data.TEACHER_OBSERVATION_NOTE,
            OBSERVATION_DATETIME: result.OBSERVATION_DATETIME || null,
            OBSERVATION_MOTIF_LABEL:
              motif?.OBSERVATION_MOTIF_LABEL || motif?.OBSERVATION_MOTIF_LABEL_EN,
            OBSERVATION_MOTIF_CODE: motif?.OBSERVATION_MOTIF_CODE,
            PENDING_LOCAL: true
          }
        ])
        showNotice(
          tr('Observation saved on this computer. It will be sent when the server is back.')
        )
        setShowModal(false)
        return
      }

      showNotice(`Behavioral observation recorded for ${activeStudent.PERSON_FIRST_NAME}`)
      setShowModal(false)
      loadSessionData(parseInt(selectedSessionId))
    } catch (err) {
      console.error('Failed to save observation', err)
      showNotice(tr('Failed to save observation record'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const [confirmTarget, setConfirmTarget] = useState(null)

  const handleDeleteObservation = async (obsRecord) => {
    try {
      const result = await window.api.deleteObservation(obsRecord)

      if (result?.queued) {
        // The deletion waits on this computer until the server answers, so the
        // row leaves the list now and the queue chip counts the change.
        setObservations((previous) => previous.filter((item) => item !== obsRecord))
        showNotice(tr('Observation deleted on this computer. It will be sent when the server is back.'))
        return
      }

      showNotice(tr('Observation entry deleted'))
      loadSessionData(parseInt(selectedSessionId))
    } catch (err) {
      console.error('Failed to delete observation record', err)
      showNotice(tr('Failed to delete observation'), 'error')
    }
  }

  const filteredStudents = students.filter(s =>
    `${s.PERSON_FIRST_NAME} ${s.PERSON_LAST_NAME}`.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Stats calculation
  const totalRoster = students.length
  const absentCount = absences.length
  const presentCount = totalRoster - absentCount
  const totalObservations = observations.length

  const sessionGroup =
    selectedSession?.TEACHING_GROUP_LABEL ||
    selectedSession?.SECTION_LABEL ||
    (selectedSession?.TEACHING_GROUP_ID ? `ID: ${selectedSession.TEACHING_GROUP_ID}` : '—')

  if (loading) {
    return (
      <div className="space-y-4">
        <PageIntro
          kicker={tr('Teaching')}
          title={tr('Behavioral Observations')}
        />
        <Panel>
          <div role="status" aria-live="polite" className="space-y-2 px-4 py-6">
            <span className="text-[11.5px] text-ink-3">{tr('Initializing observation manager...')}</span>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-2.5 rounded-[2px] bg-surface-muted" aria-hidden="true" />
            ))}
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {notification && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 rounded-[4px] border px-3 py-2 text-[11.5px]"
          style={
            notification.type === 'error'
              ? { borderColor: 'var(--color-danger)', background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }
              : notification.type === 'info'
                ? { borderColor: 'var(--color-info)', background: 'var(--color-info-bg)', color: 'var(--color-info-ink)' }
                : { borderColor: 'var(--color-success)', background: 'var(--color-success-bg)', color: 'var(--color-success-ink)' }
          }
        >
          {notification.type === 'error'
            ? <AlertCircle size={13} className="mt-px shrink-0" />
            : notification.type === 'info'
              ? <Clock size={13} className="mt-px shrink-0" />
              : <CheckCircle size={13} className="mt-px shrink-0" />}
          <span>{notification.text}</span>
        </div>
      )}

      <PageIntro
        kicker={tr('Teaching')}
        title={tr('Behavioral Observations')}
        meta={selectedSession ? sessionGroup : null}
        actions={
          selectedSession && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadSessionData(selectedSession.STUDY_SESSION_ID)}
              loading={rosterLoading}
            >
              <RefreshCw size={12} /> {tr('Refresh roster')}
            </Button>
          )
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Log and monitor student behavior and achievements during class.')}
        </p>
      </PageIntro>

      {selectedSession ? (
        <>
          {/* The session the roster belongs to: what, where, when, and how many. */}
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-[6px] w-[6px] shrink-0 rounded-full"
                    style={{ background: 'var(--color-jade-500)' }}
                  />
                  <span className="kicker text-[9px]">{tr('In progress')}</span>
                </div>
                <h2 className="serif mt-1.5 text-[25px] leading-tight text-ink">
                  {selectedSession.MAJOR_LABEL}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Notebook size={11} /> {tr('Group:')} <span className="text-ink-2">{sessionGroup}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar size={11} /> {formatDateLong(selectedSession.STUDY_DAY_DATE)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={11} />
                    <span className="mono">
                      {selectedSession.STUDY_SESSION_START_TIME}–{selectedSession.STUDY_SESSION_END_TIME}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={11} /> {selectedSession.CLASSROOM_LABEL || tr('N/A')}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-line sm:grid-cols-4">
              <Stat value={totalRoster} label={tr('Roster')} />
              <Stat value={presentCount} label={tr('Present')} />
              <Stat value={absentCount} label={tr('Absent')} />
              <Stat value={totalObservations} label={tr('Logged')} />
            </div>
          </Panel>

          {/* Roster and its observations */}
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-muted px-3 py-2">
              <div className="relative w-full max-w-xs">
                <Search
                  size={12}
                  aria-hidden="true"
                  className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3"
                />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={tr('Search students by name...')}
                  aria-label={tr('Search students by name...')}
                  className="field h-7 w-full ps-6 text-[11px]"
                />
              </div>
              <span className="mono text-[10px] text-ink-3">
                {filteredStudents.length}/{totalRoster}
              </span>
            </div>

            {rosterLoading ? (
              <div role="status" aria-live="polite" className="space-y-1.5 p-3">
                <span className="sr-only">{tr('Loading student roster...')}</span>
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-9 rounded-[3px] bg-surface-muted" aria-hidden="true" />
                ))}
              </div>
            ) : filteredStudents.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-[12.5px] font-medium text-ink-2">{tr('No students found matching your criteria.')}</p>
                <p className="mt-1 text-[11px] text-ink-3">{tr('Clear the search to see the whole roster.')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <DataTable
                  bodyClassName="divide-y divide-line"
                  className="w-full border-collapse text-start"
                  label={tr('Delete entry')}
                  headClassName="border-b border-line text-ink-3"
                  columns={[
                    { key: 'c0', className: "kicker w-16 px-3 py-2 text-[8.5px]", header: <>{tr('ID')}</> },
                    { key: 'c1', className: "kicker px-3 py-2 text-[8.5px]", header: <>{tr('Student Name')}</> },
                    { key: 'c2', className: "kicker w-28 px-3 py-2 text-[8.5px]", header: <>{tr('Status')}</> },
                    { key: 'c3', className: "kicker px-3 py-2 text-[8.5px]", header: <>{tr('Logged Observations (Unlimited)')}</> },
                    { key: 'c4', className: "kicker w-24 px-3 py-2 text-end text-[8.5px]", header: <>{tr('Actions')}</> },
                  ]}
                >
                    {filteredStudents.map(student => {
                      const isAbsent = absences.some(a => a.PERSON_ID === student.PERSON_ID)
                      const studentObs = observations.filter(o => o.PERSON_ID === student.PERSON_ID)

                      return (
                        <tr key={student.PERSON_ID} className={isAbsent ? 'bg-surface-muted/40' : 'hover:bg-surface-muted/40'}>
                          <td className="px-3 py-2.5 align-top">
                            <span className="mono text-[10px] text-ink-3">#{student.PERSON_ID}</span>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <div className="flex items-center gap-2.5">
                              <span
                                className="mono grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line-strong text-[18px] leading-none text-ink-3"
                                aria-hidden="true"
                              >
                                {rosterPhotos[Number(student.PERSON_ID)]
                                  ? <PhotoZoom src={rosterPhotos[Number(student.PERSON_ID)]} alt={`${student.PERSON_FIRST_NAME || ''} ${student.PERSON_LAST_NAME || ''}`.trim()} />
                                  : initialsOf(student.PERSON_FIRST_NAME, student.PERSON_LAST_NAME)}
                              </span>
                              <span className={`min-w-0 truncate text-[12px] ${isAbsent ? 'text-ink-2' : 'font-medium text-ink'}`}>
                                {student.PERSON_FIRST_NAME} {student.PERSON_LAST_NAME}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            <span
                              className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.05em] ${
                                isAbsent
                                  ? 'border-danger/40 bg-danger-bg text-danger-ink'
                                  : 'border-line-strong bg-surface text-ink-2'
                              }`}
                            >
                              {isAbsent ? <UserX size={10} /> : <UserCheck size={10} />}
                              {isAbsent ? tr('Absent') : tr('Present')}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 align-top">
                            {isAbsent ? (
                              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-3">
                                <AlertCircle size={11} /> {tr('Observations disabled (student absent)')}
                              </span>
                            ) : studentObs.length === 0 ? (
                              <span className="text-[10.5px] text-ink-3">{tr('No behavior notes recorded')}</span>
                            ) : (
                              <ul className="space-y-1.5">
                                {studentObs.map(obs => {
                                  const timeOnly = obs.OBSERVATION_DATETIME
                                    ? formatTime(obs.OBSERVATION_DATETIME)
                                    : ''
                                  return (
                                    <li
                                      key={`${obs.OBSERVATION_MOTIF_ID}-${obs.OBSERVATION_DATETIME}`}
                                      className="flex items-start justify-between gap-2 rounded-[3px] border border-line bg-surface-muted/60 px-2 py-1.5"
                                    >
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          <span className="mono border border-jade-500/40 px-1 text-[8.5px] uppercase tracking-[0.05em] text-jade-600">
                                            {obs.OBSERVATION_MOTIF_LABEL}
                                          </span>
                                          {/* Recorded while the server was away: saved
                                              here, not yet part of the register. */}
                                          {obs.PENDING_LOCAL && (
                                            <span
                                              className="mono border border-warning/40 bg-warning-bg px-1 text-[8.5px] uppercase tracking-[0.05em] text-warning-ink"
                                              title={tr('Saved on this computer, not sent yet.')}
                                            >
                                              {tr('Pending')}
                                            </span>
                                          )}
                                          {timeOnly && (
                                            <span className="mono text-[9px] text-ink-3">{timeOnly}</span>
                                          )}
                                        </div>
                                        {obs.TEACHER_OBSERVATION_NOTE && (
                                          <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
                                            {obs.TEACHER_OBSERVATION_NOTE}
                                          </p>
                                        )}
                                      </div>
                                      {/* A queued observation has no row on the
                                          server yet, so it can be neither
                                          deleted nor commented on from here. */}
                                      {!obs.PENDING_LOCAL && (
                                        <button
                                          type="button"
                                          onClick={() => setConfirmTarget(obs)}
                                          title={tr('Delete entry')}
                                          aria-label={tr('Delete entry')}
                                          className="grid h-5 w-5 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                                        >
                                          <Trash2 size={11} />
                                        </button>
                                      )}
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </td>
                          <td className="px-3 py-2.5 align-top text-end">
                            <Button
                              size="sm"
                              onClick={() => handleOpenModal(student)}
                              disabled={isAbsent}
                            >
                              <Plus size={11} /> {tr('Observe')}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                </DataTable>
              </div>
            )}
          </Panel>
        </>
      ) : (
        <Panel>
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Clock size={22} className="text-ink-3" />
            <h2 className="serif mt-3 text-[22px] leading-tight text-ink">{tr('No Current Study Session')}</h2>
            <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-ink-3">
              {tr('There is no study session in progress for you right now. Your current session is detected automatically from your schedule, so this page will be ready when your next session starts.')}
            </p>
          </div>
        </Panel>
      )}

      {/* Recording an observation for one student */}
      <Modal
        open={showModal && !!activeStudent}
        onClose={() => setShowModal(false)}
        title={tr('New Student Observation')}
        description={tr('Record one behavioral observation for this student in the session in progress.')}
        maxWidth="max-w-[520px]"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[10px] text-ink-3">
              {activeStudent ? `${activeStudent.PERSON_FIRST_NAME} ${activeStudent.PERSON_LAST_NAME}` : ''}
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => setShowModal(false)} disabled={saving}>
                {tr('Cancel')}
              </Button>
              <Button
                type="submit"
                form="observation-form"
                size="sm"
                disabled={saving || !observationForm.OBSERVATION_MOTIF_ID || !observationForm.TEACHER_OBSERVATION_NOTE.trim()}
              >
                <Save size={12} /> {saving ? tr('Saving...') : tr('Save Record')}
              </Button>
            </div>
          </div>
        }
      >
        {activeStudent && (
          <form id="observation-form" onSubmit={handleSaveObservation} className="space-y-3.5">
            <div className="flex items-center gap-2.5 rounded-[4px] border border-line bg-surface-muted/60 px-2.5 py-2">
              <span
                className="mono grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line-strong text-[18px] leading-none text-ink-3"
                aria-hidden="true"
              >
                {rosterPhotos[Number(activeStudent.PERSON_ID)]
                  ? <PhotoZoom src={rosterPhotos[Number(activeStudent.PERSON_ID)]} alt={`${activeStudent.PERSON_FIRST_NAME || ''} ${activeStudent.PERSON_LAST_NAME || ''}`.trim()} />
                  : initialsOf(activeStudent.PERSON_FIRST_NAME, activeStudent.PERSON_LAST_NAME)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-ink">
                  {activeStudent.PERSON_FIRST_NAME} {activeStudent.PERSON_LAST_NAME}
                </div>
                <div className="mono text-[9.5px] text-ink-3">#{activeStudent.PERSON_ID}</div>
              </div>
            </div>

            <div>
              <label htmlFor="observation-motif" className="kicker mb-1 block text-[9px]">
                {tr('Observation Motif')}
              </label>
              <select
                id="observation-motif"
                value={observationForm.OBSERVATION_MOTIF_ID}
                onChange={(e) => setObservationForm({ ...observationForm, OBSERVATION_MOTIF_ID: e.target.value })}
                required
                className="field text-[12px]"
              >
                <option value="">{tr('-- Choose Motif --')}</option>
                {motifs.map(m => (
                  <option key={m.OBSERVATION_MOTIF_ID} value={m.OBSERVATION_MOTIF_ID}>
                    {m.OBSERVATION_MOTIF_LABEL}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="observation-note" className="kicker mb-1 block text-[9px]">
                {tr('Behavior Observation Note')}
              </label>
              <textarea
                id="observation-note"
                value={observationForm.TEACHER_OBSERVATION_NOTE}
                onChange={(e) => setObservationForm({ ...observationForm, TEACHER_OBSERVATION_NOTE: e.target.value })}
                required
                rows={6}
                placeholder={tr('Record behavioral context, achievements, or class performance comments...')}
                className="w-full resize-y rounded-[4px] border border-line-strong bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-jade-500 focus:ring-2 focus:ring-jade-500/20"
              />
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={tr('Delete Observation')}
        message={tr('Are you sure you want to delete this observation?')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => { const record = confirmTarget; setConfirmTarget(null); handleDeleteObservation(record) }}
      />
    </div>
  )
}

export default Observations
