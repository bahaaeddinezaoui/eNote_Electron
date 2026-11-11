import React, { useState, useEffect, useRef } from 'react'
import { formatDate } from '../dateFormat'
import DataTable from './ui/DataTable'
import ConfirmDialog from './ui/ConfirmDialog'
import PhotoZoom from './ui/PhotoZoom'
import Notice from './ui/Notice'
import { PageHeader, StateMark } from './ui/PageHeader'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import { personNameLastFirst } from '../../shared/personNames'
import { 
  Calendar, 
  Clock, 
  MapPin, 
  Users, 
  CheckCircle, 
  AlertCircle, 
  Edit3, 
  UserX, 
  UserCheck, 
  Search, 
  Notebook, 
  X, 
  Save, 
  AlertTriangle,
  Lock
} from 'lucide-react'
import { formatDateLong, toDateString } from '../scheduleUtils'
import { tr } from '../i18n'
import { initialsOf, usePersonPhotos } from '../personPhotos'
import { ipcErrorMessage } from '../ipcError'
import { mergePendingAbsences, mergePendingObservations } from '../offlineMerge'

const Absences = ({ user }) => {
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [selectedSession, setSelectedSession] = useState(null)
  
  const [students, setStudents] = useState([])
  const [absences, setAbsences] = useState([])
  // Faces for the roster rows, read in one batch and cached by person id.
  const rosterPhotos = usePersonPhotos(students)
  const [justifications, setJustifications] = useState([])
  const [observations, setObservations] = useState([])
  
  const [loading, setLoading] = useState(true)
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [showModal, setShowModal] = useState(false)
  const [activeStudent, setActiveStudent] = useState(null)
  const [absenceForm, setAbsenceForm] = useState({
    ABSENCE_JUSTIFICATION_ID: '',
    TEACHER_ABSENCE_NOTE: ''
  })
  
  const [notification, setNotification] = useState(null)
  const [savingAbsence, setSavingAbsence] = useState(false)
  const [busyStudentId, setBusyStudentId] = useState(null)
  const noticeTimerRef = useRef(null)

  // Whether this session has been dealt with at all (an absence or an
  // observation was saved, or the teacher confirmed it). A session with nothing
  // to report still needs confirming, otherwise it counts as a missed class.
  const [sessionRegister, setSessionRegister] = useState(null)
  const [confirmingHeld, setConfirmingHeld] = useState(false)

  // The admin may lock absence removal for the first minutes of a session.
  // 0 means no lock; clockNow keeps that window current on the 15-second tick.
  const [absenceLockMinutes, setAbsenceLockMinutes] = useState(0)
  const [clockNow, setClockNow] = useState(() => Date.now())

  // Guards against overlapping detection calls, and always holds the latest
  // reconcile closure for the periodic / focus re-checks.
  const reconcilingRef = useRef(false)
  const reconcileRef = useRef(null)

  // Trigger quick banner notifications. A newer message replaces the previous
  // timer so an older success cannot dismiss the message that followed it.
  const showNotice = (text, type = 'success') => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setNotification({ text, type })
    noticeTimerRef.current = setTimeout(() => setNotification(null), 4000)
  }

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
  }, [])

  // Reconciles the page with the study session that is running right now. The
  // detection itself is performed by the main process (getTeacherCurrentSession),
  // which reads the OS date/time fresh on every call. This routine is re-run on
  // mount, when the window regains focus, and periodically, so a session starting
  // or ending (or the machine clock changing) is picked up without needing to
  // close and reopen the application.
  // Offline, the server cannot answer "which class is running now". The roster
  // warm-up keeps this teacher's sessions for the coming week on disk, so the
  // class in progress is found from that saved list instead — the same rows the
  // rest of the page reads.
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
      // currently loaded roster and absences untouched.
      if (nextSessionId === currentSessionId) return

      if (activeSession) {
        setSelectedSessionId(activeSession.STUDY_SESSION_ID)
        setSelectedSession(activeSession)
        loadSessionStudentsAndAbsences(activeSession.STUDY_SESSION_ID)
        if (announce) {
          showNotice(tr('Current study session detected: {name}', {
            name: activeSession.MAJOR_LABEL || tr('Session')
          }), 'info')
        }
      } else {
        // No study session is currently in progress for this teacher.
        setSelectedSessionId('')
        setSelectedSession(null)
        setStudents([])
        setAbsences([])
        setObservations([])
        setSessionRegister(null)
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

  // A new session starts with a clean view: a search or status filter left from
  // the previous class must not hide the new roster.
  useEffect(() => {
    setSearchTerm('')
    setStatusFilter('all')
  }, [selectedSessionId])

  // The absence dialog is a keyboard surface like every other overlay.
  useEffect(() => {
    if (!showModal) return
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !savingAbsence) setShowModal(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showModal, savingAbsence])

  useEffect(() => {
    if (!user?.personId) return

    // Keep the current-session state in sync with the clock: re-check when the
    // window regains focus / becomes visible again and on a short interval while
    // the page is open.
    const recheck = () => {
      setClockNow(Date.now())
      reconcileRef.current?.({ announce: false })
    }
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

    // The three reads are separate on purpose: while the server is unreachable
    // the removal lock is simply unknown (the server re-checks it when a queued
    // change is sent) and the roster still has to open from the saved copy.
    try {
      // The admin's absence-removal lock, read so the button can show the
      // window before the server has to refuse the request.
      const settingsResult = await window.api.getSettings(user?.id)
      const lockMinutes = Number(
        (settingsResult?.data || [])
          .find((o) => o.OPTION_KEY === 'absence_removal_lock_minutes')?.OPTION_VALUE || 0
      )
      setAbsenceLockMinutes(Number.isFinite(lockMinutes) && lockMinutes > 0 ? lockMinutes : 0)
    } catch (err) {
      console.warn('The absence removal lock could not be read', err)
      setAbsenceLockMinutes(0)
    }

    // 1. Load justifications (kept for offline use by the cache warm-up)
    try {
      const justResult = await window.api.getAbsenceJustifications()
      setJustifications(justResult?.data || [])
    } catch (err) {
      console.warn('Absence justifications could not be read', err)
    }

    try {
      // 2. Detect and display the teacher's current study session.
      await reconcileCurrentSession({ announce: true })
    } catch (err) {
      console.error('Failed to load absences configuration', err)
      showNotice(ipcErrorMessage(err) || tr('Error loading initial details'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadSessionStudentsAndAbsences = async (sessionId) => {
    setStudentsLoading(true)
    setClockNow(Date.now())
    try {
      // Load roster
      const studentsResult = await window.api.getSessionStudentsForAbsence(sessionId)
      
      // Load current absences for this session
      const absencesResult = await window.api.getAbsencesForSession(sessionId)
      
      // Load current observations for this session
      const obsResult = await window.api.getObservationsForSession(sessionId)
      
      // Work queued while the server was away belongs to the register too: a
      // student another page marked absent offline is absent here as well, and
      // a note queued there counts for the "has observations" check below.
      const pending = await window.api.getSessionPending(sessionId).catch(() => null)
      const justificationById = new Map(
        justifications.map((item) => [Number(item.ABSENCE_JUSTIFICATION_ID), item])
      )

      setStudents(studentsResult?.data || [])
      setAbsences(mergePendingAbsences(absencesResult?.data || [], pending, justificationById))
      setObservations(mergePendingObservations(obsResult?.data || [], pending, new Map()))

      const regResult = await window.api.getSessionRegister(sessionId)
      setSessionRegister(regResult?.register || null)
    } catch (err) {
      console.error('Failed to load session roster/absences', err)
      showNotice(ipcErrorMessage(err) || tr('Failed to load student roster'), 'error')
    } finally {
      setStudentsLoading(false)
    }
  }

  const handleOpenAbsenceModal = (student, existingAbsence = null) => {
    setActiveStudent(student)
    if (existingAbsence) {
      setAbsenceForm({
        ABSENCE_JUSTIFICATION_ID: existingAbsence.ABSENCE_JUSTIFICATION_ID.toString(),
        TEACHER_ABSENCE_NOTE: existingAbsence.TEACHER_ABSENCE_NOTE || ''
      })
    } else {
      // Find "UNEXCUSED" code ID or select the first justification
      const unexcused = justifications.find(j => j.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED')
      setAbsenceForm({
        ABSENCE_JUSTIFICATION_ID: unexcused ? unexcused.ABSENCE_JUSTIFICATION_ID.toString() : (justifications[0]?.ABSENCE_JUSTIFICATION_ID?.toString() || ''),
        TEACHER_ABSENCE_NOTE: ''
      })
    }
    setShowModal(true)
  }

  const [confirmDeleteObs, setConfirmDeleteObs] = useState(false)

  const handleSaveAbsence = async (e) => {
    e.preventDefault()
    if (!activeStudent || !selectedSessionId || savingAbsence) return

    const studentObs = observations.filter(o => o.PERSON_ID === activeStudent.PERSON_ID)
    if (studentObs.length > 0) {
      setConfirmDeleteObs(true)
      return
    }
    await performSaveAbsence()
  }

  const performSaveAbsence = async () => {
    if (!activeStudent || !selectedSessionId || savingAbsence) return
    setSavingAbsence(true)
    try {
      // The row this teacher is looking at. The server compares it with the
      // record as it is when the change arrives, so an offline change can never
      // silently replace a colleague's edit.
      const existing = absences.find(
        (absence) => Number(absence.PERSON_ID) === Number(activeStudent.PERSON_ID)
      )
      const data = {
        PERSON_ID: activeStudent.PERSON_ID,
        STUDY_SESSION_ID: parseInt(selectedSessionId),
        ABSENCE_JUSTIFICATION_ID: parseInt(absenceForm.ABSENCE_JUSTIFICATION_ID),
        PER_PERSON_ID: user.personId,
        TEACHER_ABSENCE_NOTE: absenceForm.TEACHER_ABSENCE_NOTE.trim(),
        expectedAbsence: existing
          ? {
              justificationId: Number(existing.ABSENCE_JUSTIFICATION_ID),
              perPersonId: Number(existing.PER_PERSON_ID) || null,
              note: existing.TEACHER_ABSENCE_NOTE || ''
            }
          : null
      }

      const result = await window.api.markStudentAbsent(data)

      if (result?.queued) {
        // The cached roster cannot show a record that only exists on this
        // computer yet, so the page is updated here and the queue chip counts it.
        const justification = justifications.find(
          (item) => Number(item.ABSENCE_JUSTIFICATION_ID) === data.ABSENCE_JUSTIFICATION_ID
        )
        setAbsences((previous) => [
          ...previous.filter((absence) => Number(absence.PERSON_ID) !== Number(data.PERSON_ID)),
          {
            PERSON_ID: data.PERSON_ID,
            STUDY_SESSION_ID: data.STUDY_SESSION_ID,
            ABSENCE_JUSTIFICATION_ID: data.ABSENCE_JUSTIFICATION_ID,
            ABSENCE_JUSTIFICATION_CODE: justification?.ABSENCE_JUSTIFICATION_CODE || 'UNEXCUSED',
            ABSENCE_JUSTIFICATION_LABEL_EN: justification?.ABSENCE_JUSTIFICATION_LABEL_EN,
            ABSENCE_JUSTIFICATION_LABEL_AR: justification?.ABSENCE_JUSTIFICATION_LABEL_AR,
            ABSENCE_JUSTIFICATION_LABEL_FR: justification?.ABSENCE_JUSTIFICATION_LABEL_FR,
            TEACHER_ABSENCE_NOTE: data.TEACHER_ABSENCE_NOTE,
            PENDING_LOCAL: true
          }
        ])
        showNotice(tr('Absence saved on this computer. It will be sent when the server is back.'))
        setShowModal(false)
        return
      }

      showNotice(tr('Absence recorded for {name}', {
        name: `${activeStudent.PERSON_FIRST_NAME || ''} ${activeStudent.PERSON_LAST_NAME || ''}`.trim()
      }))
      setShowModal(false)
      // Reload absences list
      loadSessionStudentsAndAbsences(parseInt(selectedSessionId))
    } catch (err) {
      console.error('Failed to mark student absent', err)
      showNotice(ipcErrorMessage(err) || tr('Failed to record student absence'), 'error')
    } finally {
      setSavingAbsence(false)
    }
  }

  // "The class was held, there was simply nothing to record." Saving an absence
  // or an observation already registers the session; this covers the quiet day.
  const confirmSessionHeld = async () => {
    if (!selectedSessionId) return
    setConfirmingHeld(true)
    try {
      const res = await window.api.markSessionAttended(user.id, parseInt(selectedSessionId))
      if (res?.queued) {
        showNotice(tr('Session confirmation saved on this computer. It will be sent when the server is back.'))
        return
      }
      setSessionRegister(res?.register || null)
      showNotice(tr('Session confirmed as held.'))
    } catch (err) {
      console.error('Failed to confirm the session', err)
      showNotice(ipcErrorMessage(err) || tr('Failed to confirm the session.'), 'error')
    } finally {
      setConfirmingHeld(false)
    }
  }

  const handleMarkPresent = async (student) => {
    if (!selectedSessionId || busyStudentId !== null) return
    setBusyStudentId(student.PERSON_ID)
    try {
      const existing = absences.find(
        (absence) => Number(absence.PERSON_ID) === Number(student.PERSON_ID)
      )
      const result = await window.api.markStudentPresent(
        user?.id,
        student.PERSON_ID,
        parseInt(selectedSessionId),
        existing
          ? {
              justificationId: Number(existing.ABSENCE_JUSTIFICATION_ID),
              perPersonId: Number(existing.PER_PERSON_ID) || null,
              note: existing.TEACHER_ABSENCE_NOTE || ''
            }
          : null
      )

      if (result?.queued) {
        setAbsences((previous) =>
          previous.filter((absence) => Number(absence.PERSON_ID) !== Number(student.PERSON_ID))
        )
        showNotice(tr('Attendance saved on this computer. It will be sent when the server is back.'))
        return
      }

      showNotice(tr('{name} marked present', {
        name: `${student.PERSON_FIRST_NAME || ''} ${student.PERSON_LAST_NAME || ''}`.trim()
      }))
      loadSessionStudentsAndAbsences(parseInt(selectedSessionId))
    } catch (err) {
      console.error('Failed to mark student present', err)
      showNotice(ipcErrorMessage(err) || tr('Failed to update attendance'), 'error')
    } finally {
      setBusyStudentId(null)
    }
  }

  // Filter the roster by name and attendance state.
  const absentIds = new Set(absences.map((absence) => absence.PERSON_ID))
  const filteredStudents = students.filter((student) => {
    const name = `${student.PERSON_FIRST_NAME} ${student.PERSON_LAST_NAME}`.toLowerCase()
    if (!name.includes(searchTerm.toLowerCase())) return false
    if (statusFilter === 'absent' && !absentIds.has(student.PERSON_ID)) return false
    if (statusFilter === 'present' && absentIds.has(student.PERSON_ID)) return false
    return true
  })

  const fmtTodayLabel = formatDate(new Date(), { day: '2-digit', month: 'short', year: 'numeric' })

  // Stats calculation
  const totalRoster = students.length
  const absentCount = absences.length
  const presentCount = totalRoster - absentCount
  const excusedCount = absences.filter(a => a.ABSENCE_JUSTIFICATION_CODE !== 'UNEXCUSED').length
  const unexcusedCount = absentCount - excusedCount

  // The same window the main process enforces. The page re-renders on its
  // 15-second clock, so the action unlocks by itself when the window ends.
  const sessionStartMs = (() => {
    if (!selectedSession) return null
    const day = toDateString(selectedSession.STUDY_DAY_DATE)
    const time = String(selectedSession.STUDY_SESSION_START_TIME || '')
    if (!day || !time) return null
    const start = new Date(`${day}T${time.length === 5 ? `${time}:00` : time}`)
    return Number.isNaN(start.getTime()) ? null : start.getTime()
  })()
  const absenceRemovalLocked = !!(
    absenceLockMinutes > 0 &&
    sessionStartMs !== null &&
    clockNow >= sessionStartMs &&
    clockNow < sessionStartMs + absenceLockMinutes * 60000
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-ink-3 font-medium">{tr("Initializing absence manager...")}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice
        notice={notification ? { type: notification.type === 'error' ? 'error' : 'success', text: notification.text } : null}
        onDismiss={() => setNotification(null)}
      />

      <PageHeader
        kicker={tr('Attendance ledger')}
        title={tr('Session attendance')}
        meta={selectedSession?.STUDY_DAY_DATE ? formatDateLong(selectedSession.STUDY_DAY_DATE) : fmtTodayLabel}
        actions={
          selectedSession ? (
            <>
              {sessionRegister ? (
                <span className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-line bg-surface px-2.5 text-[11px] text-ink-2">
                  <CheckCircle size={12} style={{ color: 'var(--color-success)' }} />
                  {tr('Attendance taken')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={confirmSessionHeld}
                  disabled={confirmingHeld}
                  className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle size={12} />
                  {confirmingHeld ? tr('Confirming…') : tr('Held · nothing to report')}
                </button>
              )}
              <span className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-line bg-surface px-2.5 text-[11px] text-ink-2">
                <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'var(--color-success)' }} aria-hidden="true" />
                {tr('Session in progress')}
              </span>
            </>
          ) : (
            <span className="inline-flex h-8 items-center gap-2 rounded-[4px] border border-line bg-surface px-2.5 text-[11px] text-ink-3">
              <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'var(--color-ink-3)' }} aria-hidden="true" />
              {tr('No session in progress')}
            </span>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {selectedSession ? (
          <>
            <section className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="flex flex-wrap items-stretch">
                <div className="min-w-[230px] flex-1 px-3.5 py-2.5">
                  <div className="kicker text-[9px]">{tr('Current session')}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="truncate text-[15px] font-medium text-ink">{selectedSession.MAJOR_LABEL || tr('Session')}</span>
                    <span className="mono shrink-0 text-[10px] text-ink-3">{tr(selectedSession.STUDY_SESSION_TYPE_LABEL)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
                    <span className="inline-flex items-center gap-1"><Calendar size={10} /> {formatDateLong(selectedSession.STUDY_DAY_DATE)}</span>
                    <span className="inline-flex items-center gap-1"><Clock size={10} /> {String(selectedSession.STUDY_SESSION_START_TIME).slice(0, 5)}–{String(selectedSession.STUDY_SESSION_END_TIME).slice(0, 5)}</span>
                    <span className="inline-flex items-center gap-1"><MapPin size={10} /> {selectedSession.CLASSROOM_LABEL || tr('No room')}</span>
                  </div>
                </div>

                <div className="grid w-full shrink-0 grid-cols-4 divide-x divide-line border-t border-line sm:w-auto sm:border-t-0">
                  {[
                    [tr('Roster'), totalRoster, 'text-ink'],
                    [tr('Present'), presentCount, 'text-ink'],
                    [tr('Absent'), absentCount, absentCount ? 'text-danger-ink' : 'text-ink'],
                    [tr('Unexcused'), unexcusedCount, unexcusedCount ? 'text-warning-ink' : 'text-ink']
                  ].map(([label, value, tone]) => (
                    <div key={label} className="min-w-[74px] px-3 py-2">
                      <div className="kicker text-[9px]">{label}</div>
                      <div className={`serif figure mt-1 text-[24px] leading-none ${tone}`}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 border-t border-line bg-surface-muted px-3 py-1.5">
                <div className="h-[3px] w-full max-w-[260px] overflow-hidden rounded-sm bg-line">
                  <span
                    className="block h-full"
                    style={{ width: `${totalRoster ? Math.round((presentCount / totalRoster) * 100) : 0}%`, background: 'var(--color-success)' }}
                  />
                </div>
                <span className="mono text-[10px] text-ink-3">
                  {totalRoster ? Math.round((presentCount / totalRoster) * 100) : 0}% {tr('present')}
                </span>
                <span className="mono ms-auto text-[10px] text-ink-3">{tr('Session')} #{selectedSession.STUDY_SESSION_ID}</span>
              </div>
            </section>

            <section className="mt-3 overflow-hidden rounded-md border border-line bg-surface">
              <div className="flex h-[46px] flex-wrap items-center gap-2 border-b border-line px-2.5">
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={tr('Search the roster')}
                    aria-label={tr('Search the roster')}
                    className="field h-7 w-[210px] ps-6 pe-7 text-[11.5px]"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      aria-label={tr('Clear search')}
                      className="absolute end-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-[2px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
                <FilterBar
                  activeCount={(searchTerm ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)}
                  onClear={() => { setSearchTerm(''); setStatusFilter('all') }}
                  matchCount={filteredStudents.length}
                  matchLabel="student"
                  title={tr('Filter the roster')}
                >
                  <FilterField label={tr('Status')}>
                    <select
                      className={filterInputCls}
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      aria-label={tr('Filter by attendance status')}
                    >
                      <option value="all">{tr('All')} ({totalRoster})</option>
                      <option value="present">{tr('Present')} ({presentCount})</option>
                      <option value="absent">{tr('Absent')} ({absentCount})</option>
                    </select>
                  </FilterField>
                </FilterBar>
                <span className="mono ms-auto text-[10px] text-ink-3">
                  {filteredStudents.length} / {totalRoster}
                </span>
              </div>

              <div className="overflow-x-auto">
                <DataTable
                  className="data-table min-w-[760px]"
                  label={tr('Attendance roster')}
                  columns={[
                    { key: 'c0', width: 62, header: <>{tr('Ref')}</> },
                    { key: 'c1', header: <>{tr('Student')}</> },
                    { key: 'c2', width: 108, header: <>{tr('Status')}</> },
                    { key: 'c3', width: 160, header: <>{tr('Justification')}</> },
                    { key: 'c4', header: <>{tr('Note')}</> },
                    { key: 'c5', width: 168, className: "text-end", header: <>{tr('Record')}</> },
                  ]}
                >
                    {studentsLoading ? (
                      Array.from({ length: 8 }, (_, index) => (
                        <tr key={`skeleton-${index}`} aria-hidden="true">
                          <td><span className="block h-3 w-8 rounded-sm bg-surface-muted" /></td>
                          <td><span className="block h-3 w-40 rounded-sm bg-surface-muted" /></td>
                          <td><span className="block h-3 w-14 rounded-sm bg-surface-muted" /></td>
                          <td><span className="block h-3 w-20 rounded-sm bg-surface-muted" /></td>
                          <td><span className="block h-3 w-32 rounded-sm bg-surface-muted" /></td>
                          <td />
                        </tr>
                      ))
                    ) : filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="!h-24 text-center text-[12px] text-ink-3">
                          <span className="inline-flex flex-col items-center gap-1.5">
                            <span>{searchTerm || statusFilter !== 'all' ? tr('No student matches this view.') : tr('This session has no students on its roster.')}</span>
                            {(searchTerm || statusFilter !== 'all') && (
                              <button
                                type="button"
                                onClick={() => { setSearchTerm(''); setStatusFilter('all') }}
                                className="text-[10.5px] font-medium text-jade-600 hover:underline"
                              >
                                {tr('Clear filters')}
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    ) : (
                      filteredStudents.map((student) => {
                        const studentAbsence = absences.find((absence) => absence.PERSON_ID === student.PERSON_ID)
                        const isAbsent = !!studentAbsence
                        const unexcused = studentAbsence?.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED'
                        return (
                          <tr key={student.PERSON_ID} data-selected={isAbsent || undefined}>
                            <td className="mono text-[10.5px] text-ink-3">#{String(student.PERSON_ID).padStart(4, '0')}</td>
                            <td>
                              <div className="flex items-center gap-2.5">
                                <span
                                  className="mono grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line-strong text-[10px] leading-none text-ink-3"
                                  aria-hidden="true"
                                >
                                  {rosterPhotos[Number(student.PERSON_ID)]
                                    ? <PhotoZoom src={rosterPhotos[Number(student.PERSON_ID)]} alt={`${student.PERSON_FIRST_NAME || ''} ${student.PERSON_LAST_NAME || ''}`.trim()} />
                                    : initialsOf(student.PERSON_FIRST_NAME, student.PERSON_LAST_NAME)}
                                </span>
                                <span className="font-medium text-ink">{personNameLastFirst(student.PERSON_LAST_NAME, student.PERSON_FIRST_NAME)}</span>
                              </div>
                            </td>
                            <td>
                              {isAbsent ? (
                                <StateMark tone={unexcused ? 'bad' : 'warn'} className="text-[11px] text-ink-2">{tr('Absent')}</StateMark>
                              ) : (
                                <StateMark tone="good" className="text-[11px] text-ink-2">{tr('Present')}</StateMark>
                              )}
                            </td>
                            <td className="max-w-0 truncate">
                              {isAbsent ? (
                                <span className="inline-flex items-center gap-1">
                                  <span className={`inline-flex h-[20px] items-center rounded-[3px] border px-1.5 text-[10px] ${
                                    unexcused
                                      ? 'border-danger/30 bg-danger-bg text-danger-ink'
                                      : 'border-warning/30 bg-warning-bg text-warning-ink'
                                  }`}>
                                    {studentAbsence.ABSENCE_JUSTIFICATION_LABEL}
                                  </span>
                                  {/* Recorded while the server was away: saved here,
                                      not yet part of the register. */}
                                  {studentAbsence.PENDING_LOCAL && (
                                    <span
                                      className="inline-flex h-[20px] items-center rounded-[3px] border border-warning/40 bg-warning-bg px-1 text-[9px] font-medium uppercase tracking-[0.05em] text-warning-ink"
                                      title={tr('Saved on this computer, not sent yet.')}
                                    >
                                      {tr('Pending')}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-ink-3">—</span>
                              )}
                            </td>
                            <td className="max-w-0 truncate text-[11.5px] text-ink-3" title={studentAbsence?.TEACHER_ABSENCE_NOTE || undefined}>
                              {isAbsent && studentAbsence.TEACHER_ABSENCE_NOTE ? studentAbsence.TEACHER_ABSENCE_NOTE : '—'}
                            </td>
                            <td className="!pe-2 text-end">
                              {isAbsent ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleMarkPresent(student)}
                                    disabled={absenceRemovalLocked || busyStudentId !== null}
                                    title={absenceRemovalLocked
                                      ? tr('Absences cannot be removed during the first {count} minutes after the session begins.', { count: absenceLockMinutes })
                                      : undefined}
                                    className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-1.5 text-[10.5px] text-ink-2 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <UserCheck size={11} />
                                    {busyStudentId === student.PERSON_ID ? tr('Saving…') : tr('Present')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenAbsenceModal(student, studentAbsence)}
                                    className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                                    aria-label={tr('Edit the absence note')}
                                    title={tr('Edit the absence note')}
                                  >
                                    <Edit3 size={11} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenAbsenceModal(student)}
                                  className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-1.5 text-[10.5px] text-danger-ink hover:bg-danger-bg"
                                >
                                  <UserX size={11} /> {tr('Mark absent')}
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                </DataTable>
              </div>

              <div className="flex h-9 items-center gap-3 border-t border-line bg-surface-muted px-3 text-[10px] text-ink-3">
                {absenceRemovalLocked ? (
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-warning-ink)' }}>
                    <Lock size={10} />
                    {tr('Removal locked for the first {count} minutes of the session.', { count: absenceLockMinutes })}
                  </span>
                ) : (
                  <span>{tr('Absences are written to the session immediately. Justification can be corrected at any time.')}</span>
                )}
                <span className="mono ms-auto">{tr('Justifications')}: {justifications.length}</span>
              </div>
            </section>
          </>
        ) : (
          <section className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex h-9 items-center justify-between border-b border-line bg-surface-muted px-3">
              <span className="kicker text-[9.5px]">{tr('Session console')}</span>
              <span className="mono text-[10px] text-ink-3">{tr('IDLE')}</span>
            </div>
            <div className="grid gap-5 px-4 py-5 md:grid-cols-[minmax(0,1fr)_320px]">
              <div>
                <h2 className="serif text-[26px] leading-tight text-ink">{tr('No session is in progress.')}</h2>
                <p className="mt-2 max-w-[420px] text-[12px] leading-relaxed text-ink-2">
                  {tr('Attendance opens automatically when one of your scheduled sessions begins. The registry re-checks the clock every fifteen seconds, so you can leave this page open between classes.')}
                </p>
                <div className="mt-4 flex gap-2">
                  <a href="#/teacher-schedule" className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted">
                    {tr('Open my timetable')}
                  </a>
                  <button
                    type="button"
                    onClick={() => reconcileCurrentSession({ announce: true })}
                    className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted"
                  >
                    {tr('Check again')}
                  </button>
                </div>
              </div>
              <dl className="border-t border-line pt-2 md:border-s md:border-t-0 md:ps-4 md:pt-0">
                {[
                  [tr('Detected by'), tr('Host clock')],
                  [tr('Re-check'), tr('Every 15 seconds')],
                  [tr('Justifications'), String(justifications.length)],
                  [tr('Roster'), tr('Loaded on session start')]
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-[7px] last:border-0">
                    <dt className="text-[11px] text-ink-3">{label}</dt>
                    <dd className="mono text-[10.5px] text-ink-2">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        )}
      </div>

      {/* Modal Dialog for Recording / Editing Student Absence */}
      {showModal && activeStudent && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tr('Document absence')}
            className="my-auto w-full max-w-[440px] border border-line-strong bg-surface shadow-2xl"
          >
            <div className="flex h-11 items-center justify-between gap-3 border-b border-line bg-surface-muted px-4">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="kicker shrink-0 text-[9.5px]">{tr('Attendance ledger')}</span>
                <h4 className="serif truncate text-[17px] leading-none text-ink">{tr('Document absence')}</h4>
              </div>
              <button
                type="button"
                onClick={() => { if (!savingAbsence) setShowModal(false) }}
                disabled={savingAbsence}
                aria-label={tr('Close')}
                className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSaveAbsence} className="space-y-3 px-4 py-3" aria-busy={savingAbsence || undefined}>
              {/* Student header */}
              <div className="flex items-center gap-2.5 border border-line bg-surface-muted/40 px-2.5 py-2">
                <UserX size={14} style={{ color: 'var(--color-danger-ink)' }} className="shrink-0" />
                <div className="min-w-0">
                  <div className="kicker text-[9px]">{tr('Student')}</div>
                  <div className="truncate text-[12.5px] font-medium text-ink">
                    {personNameLastFirst(activeStudent.PERSON_LAST_NAME, activeStudent.PERSON_FIRST_NAME)}
                  </div>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="absence-justification">{tr('Absence justification')}</label>
                <select
                  id="absence-justification"
                  value={absenceForm.ABSENCE_JUSTIFICATION_ID}
                  onChange={(e) => setAbsenceForm({ ...absenceForm, ABSENCE_JUSTIFICATION_ID: e.target.value })}
                  required
                  className="field"
                >
                  <option value="">{tr('Choose a justification…')}</option>
                  {justifications.map(j => (
                    <option key={j.ABSENCE_JUSTIFICATION_ID} value={j.ABSENCE_JUSTIFICATION_ID}>
                      {j.ABSENCE_JUSTIFICATION_LABEL}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="absence-note">{tr('Teacher note')}</label>
                <textarea
                  id="absence-note"
                  value={absenceForm.TEACHER_ABSENCE_NOTE}
                  onChange={(e) => setAbsenceForm({ ...absenceForm, TEACHER_ABSENCE_NOTE: e.target.value })}
                  placeholder={tr('Context for the record: parent contacted, left early, medical certificate expected.')}
                  className="field min-h-[88px] py-1.5 leading-relaxed"
                />
              </div>

              <div className="flex justify-end gap-1.5 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => { if (!savingAbsence) setShowModal(false) }}
                  disabled={savingAbsence}
                  className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                >{tr('Cancel')}</button>
                <button
                  type="submit"
                  disabled={savingAbsence}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ color: 'var(--color-on-jade)' }}
                >
                  <Save size={13} strokeWidth={2.2} />
                  <span>{savingAbsence ? tr('Saving…') : tr('Save record')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteObs}
        title={tr("Delete behavioral observations")}
        message={activeStudent ? tr('This student has {count} behavioral observations recorded for this session. Marking them absent will permanently delete these observations.', { count: observations.filter(o => o.PERSON_ID === activeStudent.PERSON_ID).length }) : ''}
        confirmLabel={tr("Mark absent & delete")}
        onCancel={() => setConfirmDeleteObs(false)}
        onConfirm={async () => {
          setConfirmDeleteObs(false)
          try {
            await window.api.deleteStudentObservationsForSession(activeStudent.PERSON_ID, parseInt(selectedSessionId))
            await performSaveAbsence()
          } catch (err) {
            console.error('Failed to delete observations', err)
            showNotice(ipcErrorMessage(err) || tr('Failed to delete observation'), 'error')
          }
        }}
      />
    </div>
  )
}

export default Absences
