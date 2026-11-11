import React, { useState, useEffect } from 'react'
import { formatDateTime as formatDateTimeValue } from '../dateFormat'
import { Plus, Trash2, Edit2, Check, X, Search, Calendar, Clock, DoorOpen, Tag, Award, ShieldCheck, AlertTriangle, Users, Shuffle, Hash, FileKey } from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import FilterBar, { FilterField } from './ui/FilterBar'
import { pickCurrentYearId, pickCurrentSemesterId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import Modal from './ui/Modal'
import LocalizedInput, { hasLocalizedValue } from './ui/LocalizedInput'
import { tr } from '../i18n'
import { PageIntro } from './ui/PageHeader'

// Each major has its own exams during the semester (it can have none). An
// exam's type comes from the examination_type lookup (written, practical,
// oral...). The students of the major's teaching groups are SHUFFLED into exam
// groups ("Manage seating"): each exam group sits the exam in one classroom
// (chosen per group in the seating modal), and every student gets a seat in
// that room plus the code of their response
// paper. Saving persists examination_group rows and person_has_examination
// rows (group + seat + paper code). Guards proctor the exam itself; no
// timetable sessions are spawned.

// datetime-local inputs use the local "YYYY-MM-DDTHH:MM" format. The DB stores
// full timestamps, so we trim them down for the form and re-expand on save.
const toDatetimeLocal = (value) => {
  if (!value) return ''
  // Already a wall-clock "YYYY-MM-DDTHH:MM[:SS]" string (as the services now
  // return): use as-is — parsing it into a Date and back would be identity,
  // but an ISO string with a Z/offset would get re-shifted by the timezone.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !/[Zz+]/.test(value.slice(19))) {
    return value.slice(0, 16)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// "YYYY-MM-DDTHH:MM" (datetime-local) -> "YYYY-MM-DD HH:MM:SS" for Postgres
// TIMESTAMP columns, with NO timezone conversion in either direction.
const toWallClock = (value) => {
  if (!value) return null
  const m = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(value)
  if (!m) return null
  return value.replace('T', ' ') + (value.length === 16 ? ':00' : '')
}

const EMPTY_FORM = {
  EXAMINATION_CODE: '',
  EXAMINATION_LABEL_EN: '',
  EXAMINATION_LABEL_AR: '',
  EXAMINATION_LABEL_FR: '',
  EXAMINATION_TYPE_ID: '',
  MAJOR_ID: '',
  STUDY_SEMESTER_ID: '',
  EXAMINATION_START_DATETIME: '',
  EXAMINATION_END_DATETIME: '',
  EXAMINATION_FACTOR: ''
}

const Examinations = ({ user }) => {
  const [examinations, setExaminations] = useState([])
  const [majors, setMajors] = useState([])
  const [examTypes, setExamTypes] = useState([])
  const [classrooms, setClassrooms] = useState([])
  const [studyYears, setStudyYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [persons, setPersons] = useState([])
  const [selectedMajor, setSelectedMajor] = useState('')
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  // Keep the exam list on the current year/semester while the page is open.
  useCurrentPeriodSync([
    { rows: studyYears, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester }
  ])
  // Structured filters for the list: semester, exam type, a time frame
  // (upcoming / past / all), seating status and factor presence. Combined
  // with the free-text search below. The trigger sits in the list toolbar so
  // it never covers rows or the last card.
  const [filterSemester, setFilterSemester] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterTiming, setFilterTiming] = useState('all')
  const [filterSeating, setFilterSeating] = useState('all')
  const [filterFactor, setFilterFactor] = useState('all')
  // Create-examination form lives in a modal opened by the header button.
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  // Guard selection for the exam being created. Staff only, and only those
  // free during the exam's time window (recomputed when start/end change).
  const [selectedGuards, setSelectedGuards] = useState([])
  const [freeGuards, setFreeGuards] = useState([])
  // Free-text filter for the guard picker (matches against the full name).
  const [guardSearch, setGuardSearch] = useState('')

  // Seating modal state. seatingExam is the exam being seated; seatingRows is
  // the student roster; groups holds the exam groups (label + room);
  // groupAssign maps PERSON_ID -> EXAMINATION_GROUP_ID (null = unassigned);
  // seatDraft / paperDraft hold the per-student seat number and paper code.
  const [seatingExam, setSeatingExam] = useState(null)
  const [seatingRows, setSeatingRows] = useState([])
  const [groups, setGroups] = useState([])
  const [groupAssign, setGroupAssign] = useState({})
  const [seatDraft, setSeatDraft] = useState({})
  const [paperDraft, setPaperDraft] = useState({})
  const [shuffleSize, setShuffleSize] = useState('')
  // Real seats per room: roomId -> [{ SEAT_NUMBER, OCCUPANT_PERSON_ID }]. A
  // student can only take a seat that physically exists in their group's room.
  const [roomSeats, setRoomSeats] = useState({})

  const [createForm, setCreateForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)

  // Refresh the guard list whenever the exam's schedule changes: anyone
  // guarding or sitting an overlapping exam is filtered out server-side, so
  // the user never sees (and can never pick) a guard who would conflict.
  useEffect(() => {
    let cancelled = false
    const start = createForm.EXAMINATION_START_DATETIME
    const end = createForm.EXAMINATION_END_DATETIME
    ;(async () => {
      try {
        const res = await window.api.getFreeGuards(start || null, end || null)
        if (cancelled) return
        const list = res?.data || []
        setFreeGuards(list)
        // Drop ticks for guards that disappeared (no longer free at these times).
        const ids = new Set(list.map(g => g.PERSON_ID))
        setSelectedGuards(prev => prev.filter(id => ids.has(id)))
      } catch {
        if (!cancelled) setFreeGuards([])
      }
    })()
    return () => { cancelled = true }
  }, [createForm.EXAMINATION_START_DATETIME, createForm.EXAMINATION_END_DATETIME])

  useEffect(() => {
    fetchReferenceData()
  }, [])

  useEffect(() => {
    fetchExaminations(selectedMajor)
  }, [selectedMajor])

  // Semesters are scoped by study year. Reload them whenever the year changes,
  // auto-selecting the first one (matches the Schedule/Sections page behavior).
  useEffect(() => {
    if (!selectedYear) {
      setSemesters([])
      setSelectedSemester('')
      setFilterSemester('')
      return
    }
    // The semester filter is scoped to the selected year's semesters — reset
    // it when the year changes so it can't reference a semester of another year.
    setFilterSemester('')
    let cancelled = false
    ;(async () => {
      try {
        const result = await window.api.getStudySemesters(selectedYear)
        if (cancelled) return
        const data = result?.data || []
        setSemesters(data)
        setSelectedSemester(data.length > 0 ? pickCurrentSemesterId(data) : '')
      } catch (err) {
        console.error('Failed to load semesters', err)
        if (!cancelled) {
          setSemesters([])
          setSelectedSemester('')
        }
      }
    })()
    return () => { cancelled = true }
  }, [selectedYear])

  const showMessage = (type, text) => {
    setMessage({ type, text })
    window.setTimeout(() => setMessage({ type: '', text: '' }), 4000)
  }

  const fetchReferenceData = async () => {
    setLoading(true)
    try {
      const [majorsRes, examTypesRes, classroomsRes, yearsRes, personsRes] = await Promise.all([
        window.api.getMajors(),
        window.api.getExaminationTypes(),
        window.api.getClassrooms(),
        window.api.getStudyYears(),
        window.api.getPersons()
      ])
      const fetchedMajors = majorsRes?.data || []
      const fetchedYears = yearsRes?.data || []
      setMajors(fetchedMajors)
      setExamTypes(examTypesRes?.data || [])
      setClassrooms(classroomsRes?.data || [])
      setStudyYears(fetchedYears)
      // Guards must be staff (not students). They proctor the exam.
      setPersons((personsRes?.data || []).filter(p => !p.IS_STUDENT))
      if (fetchedMajors.length > 0) {
        setSelectedMajor(fetchedMajors[0].MAJOR_ID)
      }
      if (fetchedYears.length > 0) {
        setSelectedYear(pickCurrentYearId(fetchedYears))
      }
    } catch (error) {
      console.error(error)
      showMessage('error', tr('Unable to load reference data'))
    }
    setLoading(false)
  }

  const fetchExaminations = async (majorId) => {
    if (!majorId) {
      setExaminations([])
      return
    }
    setLoading(true)
    try {
      const result = await window.api.getExaminations(user?.id, majorId)
      setExaminations(result?.data || [])
    } catch (error) {
      console.error(error)
      setExaminations([])
      showMessage('error', tr('Unable to load examinations'))
    }
    setLoading(false)
  }

  // Coerce the form fields into the shapes the DB expects (numbers for FKs and
  // the factor, ISO timestamps for the datetime range). Empty optionals are
  // dropped so the column stays NULL rather than becoming 0 / ''. Rooms are
  // NOT set here: each exam group picks its room in the seating modal.
  const buildPayload = (form, majorId, semesterId) => {
    const payload = {
      EXAMINATION_CODE: form.EXAMINATION_CODE,
      EXAMINATION_LABEL_EN: form.EXAMINATION_LABEL_EN,
      EXAMINATION_LABEL_AR: form.EXAMINATION_LABEL_AR,
      EXAMINATION_LABEL_FR: form.EXAMINATION_LABEL_FR,
      MAJOR_ID: Number(majorId)
    }
    if (semesterId) {
      payload.STUDY_SEMESTER_ID = Number(semesterId)
    }
    if (form.EXAMINATION_TYPE_ID) {
      payload.EXAMINATION_TYPE_ID = Number(form.EXAMINATION_TYPE_ID)
    }
    if (form.EXAMINATION_START_DATETIME) {
      // The DB column is TIMESTAMP WITHOUT TIME ZONE (wall-clock). Send the
      // datetime-local value as a plain wall-clock string — going through
      // Date/toISOString would apply the local UTC offset and shift the
      // stored time by the timezone difference (compounding on every edit).
      payload.EXAMINATION_START_DATETIME = toWallClock(form.EXAMINATION_START_DATETIME)
    }
    if (form.EXAMINATION_END_DATETIME) {
      payload.EXAMINATION_END_DATETIME = toWallClock(form.EXAMINATION_END_DATETIME)
    }
    if (form.EXAMINATION_FACTOR !== '' && form.EXAMINATION_FACTOR !== null && form.EXAMINATION_FACTOR !== undefined) {
      payload.EXAMINATION_FACTOR = Number(form.EXAMINATION_FACTOR)
    }
    return payload
  }

  const validateForm = (form, majorId, semesterId) => {
    if (!form.EXAMINATION_CODE || !hasLocalizedValue(form, 'EXAMINATION_LABEL')) {
      showMessage('error', tr('Code and English label are required'))
      return false
    }
    if (!majorId) {
      showMessage('error', tr('Select a major first'))
      return false
    }
    if (!semesterId) {
      showMessage('error', tr('Select a study semester (needed to resolve teaching groups)'))
      return false
    }
    if (form.EXAMINATION_START_DATETIME && form.EXAMINATION_END_DATETIME &&
        new Date(form.EXAMINATION_START_DATETIME) >= new Date(form.EXAMINATION_END_DATETIME)) {
      showMessage('error', tr('Start datetime must be before end datetime'))
      return false
    }
    return true
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    // Use the page-level semester selector as the exam's semester — it must be
    // set so the (major, semester) teaching groups can be resolved when seating.
    const semesterId = selectedSemester || createForm.STUDY_SEMESTER_ID
    if (!validateForm(createForm, selectedMajor, semesterId)) return

    setLoading(true)
    try {
      await window.api.createExamination(
        buildPayload(createForm, selectedMajor, semesterId),
        selectedGuards
      )
      setCreateForm({ ...EMPTY_FORM, MAJOR_ID: selectedMajor })
      setSelectedGuards([])
      await fetchExaminations(selectedMajor)
      closeCreateModal()
      showMessage('success', tr('Examination added. Use "Manage seating" to shuffle exam groups and assign seats.'))
    } catch (error) {
      console.error(error)
      showMessage('error', error?.message || tr('Failed to add examination'))
    }
    setLoading(false)
  }

  // Closing the create modal also clears the guard filter, so reopening it
  // starts from the full list.
  const closeCreateModal = () => {
    setShowCreateModal(false)
    setGuardSearch('')
  }

  const startEdit = (exam) => {
    setEditingId(exam.EXAMINATION_ID)
    setEditForm({
      EXAMINATION_CODE: exam.EXAMINATION_CODE || '',
      EXAMINATION_LABEL_EN: exam.EXAMINATION_LABEL_EN ?? exam.EXAMINATION_LABEL ?? '',
      EXAMINATION_LABEL_AR: exam.EXAMINATION_LABEL_AR ?? '',
      EXAMINATION_LABEL_FR: exam.EXAMINATION_LABEL_FR ?? '',
      EXAMINATION_TYPE_ID: exam.EXAMINATION_TYPE_ID || '',
      MAJOR_ID: exam.MAJOR_ID || selectedMajor,
      STUDY_SEMESTER_ID: exam.STUDY_SEMESTER_ID || '',
      EXAMINATION_START_DATETIME: toDatetimeLocal(exam.EXAMINATION_START_DATETIME),
      EXAMINATION_END_DATETIME: toDatetimeLocal(exam.EXAMINATION_END_DATETIME),
      EXAMINATION_FACTOR: exam.EXAMINATION_FACTOR !== null && exam.EXAMINATION_FACTOR !== undefined ? String(exam.EXAMINATION_FACTOR) : ''
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm(EMPTY_FORM)
  }

  const handleUpdate = async (id) => {
    if (!validateForm(editForm, editForm.MAJOR_ID || selectedMajor, editForm.STUDY_SEMESTER_ID || selectedSemester)) return

    setLoading(true)
    try {
      await window.api.updateExamination(id, buildPayload(editForm, editForm.MAJOR_ID || selectedMajor, editForm.STUDY_SEMESTER_ID || selectedSemester))
      cancelEdit()
      await fetchExaminations(selectedMajor)
      showMessage('success', tr('Examination updated'))
    } catch (error) {
      console.error(error)
      showMessage('error', error?.message || tr('Failed to update examination'))
    }
    setLoading(false)
  }

  const toggleGuard = (personId) => {
    setSelectedGuards(prev =>
      prev.includes(personId) ? prev.filter(id => id !== personId) : [...prev, personId]
    )
  }

  // --- Seating: exam groups, seats, paper codes ---
  // Load the roster + saved exam groups; every student keeps the group, seat
  // and paper code they were given last time (if any).
  const openSeating = async (exam) => {
    setLoading(true)
    try {
      const result = await window.api.getExaminationSeating(user?.id, exam.EXAMINATION_ID)
      const rows = result?.data || []
      const loadedGroups = result?.groups || []
      setSeatingExam(exam)
      setSeatingRows(rows)
      setGroups(loadedGroups)
      const assign = {}
      const seats = {}
      const papers = {}
      // groupAssign holds the group's ARRAY INDEX (what the select and shuffle
      // logic use), but the DB stores EXAMINATION_GROUP_IDs — convert ids to
      // indices; assignments pointing at groups that no longer exist are dropped.
      const indexOfGroupId = new Map(loadedGroups.map((g, i) => [g.EXAMINATION_GROUP_ID, i]))
      for (const r of rows) {
        assign[r.PERSON_ID] = indexOfGroupId.has(r.EXAMINATION_GROUP_ID)
          ? indexOfGroupId.get(r.EXAMINATION_GROUP_ID)
          : ''
        if (r.SEAT_NUMBER != null) seats[r.PERSON_ID] = String(r.SEAT_NUMBER)
        if (r.PAPER_CODE) papers[r.PERSON_ID] = r.PAPER_CODE
      }
      setGroupAssign(assign)
      setSeatDraft(seats)
      setPaperDraft(papers)
      setShuffleSize('')
      await loadRoomSeats(result?.groups || [])
      if (rows.length === 0) {
        showMessage('error', tr('No students in this major/semester teaching groups to seat'))
      }
    } catch (error) {
      console.error(error)
      showMessage('error', error?.message || tr('Failed to load seating'))
    }
    setLoading(false)
  }

  // Load the real seats of every room used by the exam's groups.
  const loadRoomSeats = async (groupList) => {
    const roomIds = [...new Set(groupList.map(g => Number(g.CLASSROOM_ID)).filter(Boolean))]
    const next = {}
    await Promise.all(roomIds.map(async (roomId) => {
      try {
        const res = await window.api.getClassroomSeats(roomId)
        next[roomId] = (res.data || []).map(s => ({
          SEAT_NUMBER: s.SEAT_NUMBER,
          OCCUPANT_PERSON_ID: s.OCCUPANT_PERSON_ID || null
        }))
      } catch {
        next[roomId] = []
      }
    }))
    setRoomSeats(prev => ({ ...prev, ...next }))
  }

  const closeSeating = () => {
    setSeatingExam(null)
    setSeatingRows([])
    setGroups([])
    setGroupAssign({})
    setSeatDraft({})
    setPaperDraft({})
    setShuffleSize('')
    setRoomSeats({})
  }

  // Change an exam group's room: reset that group's members' seats (numbers
  // from the old room are meaningless in the new one) and load its seats.
  const setGroupRoom = async (groupIndex, roomId) => {
    const newRoom = roomId === '' ? null : Number(roomId)
    const oldRoom = groups[groupIndex]?.CLASSROOM_ID
    setGroups(prev => prev.map((g, j) => j === groupIndex ? { ...g, CLASSROOM_ID: newRoom } : g))
    if (newRoom && !roomSeats[newRoom]) await loadRoomSeats([{ CLASSROOM_ID: newRoom }])
    if (oldRoom !== newRoom) {
      setSeatDraft(prev => {
        const next = { ...prev }
        for (const [pidStr, gi] of Object.entries(groupAssign)) {
          if (gi === groupIndex) delete next[Number(pidStr)]
        }
        return next
      })
    }
  }

  // Shuffle the roster into exam groups of the given size. Rooms are taken
  // round-robin from the available classrooms, each capped at its capacity so
  // no group outgrows its room. Students are distributed in roster order
  // (deterministic; use the page search + ordering as-is). Reassigning keeps
  // existing seat/paper drafts where possible and clears seats for students
  // whose room changed.
  const shuffleGroups = async () => {
    const size = parseInt(shuffleSize, 10)
    if (!size || size <= 0) {
      showMessage('error', tr('Enter a group size first'))
      return
    }
    const orderedRooms = classrooms.map(c => c.CLASSROOM_ID)
    if (orderedRooms.length === 0) {
      showMessage('error', tr('No classrooms available'))
      return
    }

    const capacityOf = (roomId) => {
      const c = classrooms.find(x => x.CLASSROOM_ID === roomId)
      return c?.CLASSROOM_CAPACITY && c.CLASSROOM_CAPACITY > 0 ? c.CLASSROOM_CAPACITY : size
    }

    const oldAssign = { ...groupAssign }
    const oldGroups = groups.map(g => ({ ...g }))
    const nextGroups = []
    const nextAssign = {}
    const roster = seatingRows.filter(r => r.PERSON_ID)

    let gi = 0
    let ri = 0
    while (ri < roster.length) {
      const room = orderedRooms[gi % orderedRooms.length]
      const cap = Math.min(size, capacityOf(room))
      const group = {
        EXAMINATION_GROUP_LABEL: `Exam Group ${gi + 1}`,
        CLASSROOM_ID: room
      }
      let placed = 0
      while (ri < roster.length && placed < cap) {
        const personId = roster[ri].PERSON_ID
        nextAssign[personId] = gi
        ri += 1
        placed += 1
      }
      nextGroups.push(group)
      gi += 1
    }

    // Preserve seat/paper drafts for students whose room stayed the same;
    // clear stale seat numbers when the room changed.
    const nextSeats = {}
    const nextPapers = { ...paperDraft }
    for (const [pidStr, oldGroupId] of Object.entries(oldAssign)) {
      const pid = Number(pidStr)
      const newGroupId = nextAssign[pid]
      if (newGroupId === undefined || newGroupId === '') continue
      const oldRoom = oldGroups[oldGroupId]?.CLASSROOM_ID
      const newRoom = nextGroups[newGroupId]?.CLASSROOM_ID
      if (oldRoom === newRoom && seatDraft[pid] !== undefined) {
        nextSeats[pid] = seatDraft[pid]
      } else if (oldGroups[oldGroupId] && nextGroups[newGroupId]) {
        // same room, different group index — keep the seat
        if (oldRoom === nextGroups[newGroupId].CLASSROOM_ID && seatDraft[pid] !== undefined) {
          nextSeats[pid] = seatDraft[pid]
        }
      }
    }

    setGroups(nextGroups)
    setGroupAssign(Object.fromEntries(Object.entries(nextAssign).map(([k, v]) => [k, v])))
    setSeatDraft(nextSeats)
    setPaperDraft(nextPapers)
    // Load the real seats of every room the shuffled groups sit in — without
    // this the seat pickers render empty for freshly created groups.
    await loadRoomSeats(nextGroups)
    showMessage('success', `Shuffled ${roster.length} students into ${nextGroups.length} exam groups. Review seats and paper codes, then save.`)
  }

  // Fill paper codes for every seated student that has none: <EXAM>-<G><SS>,
  // e.g. "EX5-2A7" = exam 5, group 2, seat 7. Existing codes are kept.
  const autoPaperCodes = () => {
    const examId = seatingExam?.EXAMINATION_ID || 0
    setPaperDraft(prev => {
      const next = { ...prev }
      for (const [pidStr, gIdx] of Object.entries(groupAssign)) {
        const pid = Number(pidStr)
        if (gIdx === '' || gIdx === null) continue
        if (next[pid]) continue
        const seat = seatDraft[pid] || seatingRows.findIndex(r => r.PERSON_ID === pid) + 1
        next[pid] = `EX${examId}-G${gIdx + 1}${String(seat).padStart(3, '0')}`
      }
      return next
    })
  }

  // Give each student of each group the next free REAL seat in that group's
  // room. Seats are unique per ROOM (groups can share a room), so the used-set
  // is keyed by room and skips both DB-booked seats and seats held by another
  // student's draft. Falls back to plain numbering only if the room has no
  // seat rows yet (save will then refuse invalid seats).
  const autoSeats = () => {
    setSeatDraft(prev => {
      const next = { ...prev }
      const usedByRoom = {}
      for (const [pidStr, gIdx] of Object.entries(groupAssign)) {
        if (gIdx === '' || gIdx === null) continue
        const v = parseInt(next[Number(pidStr)], 10)
        if (Number.isNaN(v)) continue
        const room = groups[gIdx]?.CLASSROOM_ID
        const key = room != null ? String(room) : `g${gIdx}`
        usedByRoom[key] = usedByRoom[key] || new Set()
        usedByRoom[key].add(v)
      }
      for (const [pidStr, gIdx] of Object.entries(groupAssign)) {
        if (gIdx === '' || gIdx === null) continue
        const pid = Number(pidStr)
        const cur = parseInt(next[pid], 10)
        if (!Number.isNaN(cur)) continue
        const room = groups[gIdx]?.CLASSROOM_ID
        const key = room != null ? String(room) : `g${gIdx}`
        const used = usedByRoom[key] || new Set()
        usedByRoom[key] = used
        const roomSeatRows = roomSeats[room] || []
        const candidates = roomSeatRows.length > 0
          ? roomSeatRows.map(s => s.SEAT_NUMBER)
          : []
        let picked = null
        for (const n of candidates) {
          if (used.has(n)) continue
          // skip seats DB-booked by another exam student in this room
          const dbOccupant = roomSeatRows.find(s => s.SEAT_NUMBER === n && s.OCCUPANT_PERSON_ID && s.OCCUPANT_PERSON_ID !== pid)
          if (dbOccupant) continue
          picked = n
          break
        }
        if (picked == null) {
          let n = 1
          while (used.has(n)) n += 1
          picked = n
        }
        next[pid] = String(picked)
        used.add(picked)
      }
      return next
    })
  }

  // Paper-code duplicates within the current draft: a code used by two
  // students gets flagged on both inputs (codes are globally unique, so this
  // is never allowed).
  const duplicatePaperCodes = () => {
    const seen = new Map()
    for (const [pidStr, code] of Object.entries(paperDraft)) {
      const c = (code || '').trim()
      if (!c) continue
      if (!seen.has(c)) seen.set(c, [])
      seen.get(c).push(Number(pidStr))
    }
    const dups = new Set()
    for (const pids of seen.values()) {
      if (pids.length > 1) pids.forEach(p => dups.add(p))
    }
    return dups
  }

  const handleSaveSeating = async () => {
    if (!seatingExam) return
    const assigned = Object.entries(groupAssign).filter(([, gIdx]) => gIdx !== '' && gIdx !== null)
    if (groups.length === 0 || assigned.length === 0) {
      showMessage('error', tr('Create at least one exam group and assign a student to it'))
      return
    }
    const groupPayload = groups.map((g, i) => ({
      EXAMINATION_GROUP_LABEL: g.EXAMINATION_GROUP_LABEL || `Exam Group ${i + 1}`,
      CLASSROOM_ID: g.CLASSROOM_ID ? Number(g.CLASSROOM_ID) : null,
      EXAMINATION_GROUP_ID: g.EXAMINATION_GROUP_ID || undefined
    }))
    const seating = assigned.map(([pidStr, gIdx]) => {
      const pid = Number(pidStr)
      const seat = parseInt(seatDraft[pid], 10)
      return {
        PERSON_ID: pid,
        // New groups have no id yet — the backend resolves GROUP_INDEX against
        // the groups it saves in this same call.
        GROUP_INDEX: Number(gIdx),
        EXAMINATION_GROUP_ID: groupPayload[gIdx].EXAMINATION_GROUP_ID,
        SEAT_NUMBER: Number.isNaN(seat) ? null : seat,
        PAPER_CODE: (paperDraft[pid] || '').trim() || null
      }
    })
    // Block the save up front when two students share a draft code.
    const dupCode = seating.find(s => s.PAPER_CODE && seating.filter(o => o.PAPER_CODE === s.PAPER_CODE).length > 1)
    if (dupCode) {
      showMessage('error', `Paper code "${dupCode.PAPER_CODE}" is assigned to more than one student. Codes must be unique.`)
      return
    }
    setLoading(true)
    try {
      await window.api.saveExaminationSeating(seatingExam.EXAMINATION_ID, groupPayload, seating)
      showMessage('success', `Seating saved: ${groups.length} exam group${groups.length === 1 ? '' : 's'}, ${seating.length} student${seating.length === 1 ? '' : 's'} seated.`)
      await fetchExaminations(selectedMajor)
      closeSeating()
    } catch (error) {
      console.error(error)
      showMessage('error', error?.message || tr('Failed to save seating'))
    }
    setLoading(false)
  }

  const classroomLabel = (id) => {
    const c = classrooms.find(c => c.CLASSROOM_ID === Number(id))
    return c ? `${c.CLASSROOM_LABEL} (${c.CLASSROOM_CODE})` : ''
  }

  const [confirmTarget, setConfirmTarget] = useState(null)

  const handleDelete = async (id) => {
    setLoading(true)
    try {
      await window.api.deleteExamination(id)
      await fetchExaminations(selectedMajor)
      showMessage('success', tr('Examination deleted'))
    } catch (error) {
      console.error(error)
      showMessage('error', tr('Failed to delete examination'))
    }
    setLoading(false)
  }

  const nowTs = Date.now()
  const filteredExaminations = examinations.filter((exam) => {
    if (filterSemester !== '' && Number(exam.STUDY_SEMESTER_ID) !== Number(filterSemester)) return false
    if (filterType !== '' && Number(exam.EXAMINATION_TYPE_ID) !== Number(filterType)) return false
    if (filterTiming !== 'all') {
      const start = exam.EXAMINATION_START_DATETIME ? new Date(exam.EXAMINATION_START_DATETIME).getTime() : NaN
      // Exams without a date are only shown under "all" — they can't be
      // meaningfully placed before or after "now".
      if (Number.isNaN(start)) return false
      if (filterTiming === 'upcoming' && start < nowTs) return false
      if (filterTiming === 'past' && start >= nowTs) return false
    }
    if (filterSeating === 'seated' && Number(exam.GROUP_COUNT) <= 0) return false
    if (filterSeating === 'not_seated' && Number(exam.GROUP_COUNT) > 0) return false
    if (filterFactor === 'with' && (exam.EXAMINATION_FACTOR === null || exam.EXAMINATION_FACTOR === undefined)) return false
    if (filterFactor === 'without' && exam.EXAMINATION_FACTOR !== null && exam.EXAMINATION_FACTOR !== undefined) return false
    const search = searchTerm.toLowerCase()
    return (
      (exam.EXAMINATION_LABEL || '').toLowerCase().includes(search) ||
      (exam.EXAMINATION_CODE || '').toLowerCase().includes(search) ||
      (exam.EXAMINATION_TYPE_LABEL || '').toLowerCase().includes(search)
    )
  })

  // Guard picker filter: match the typed text against the staff member's name.
  const guardQuery = guardSearch.trim().toLowerCase()
  const visibleGuards = guardQuery
    ? freeGuards.filter((p) => `${p.PERSON_FIRST_NAME} ${p.PERSON_LAST_NAME}`.toLowerCase().includes(guardQuery))
    : freeGuards
  const activeFilterCount =
    (filterSemester !== '' ? 1 : 0) +
    (filterType !== '' ? 1 : 0) +
    (filterTiming !== 'all' ? 1 : 0) +
    (filterSeating !== 'all' ? 1 : 0) +
    (filterFactor !== 'all' ? 1 : 0)
  const filtersActive = activeFilterCount > 0
  const clearFilters = () => {
    setFilterSemester('')
    setFilterType('')
    setFilterTiming('all')
    setFilterSeating('all')
    setFilterFactor('all')
    setSearchTerm('')
  }

  // The filter panel is a popover anchored to its toolbar trigger. Reusable
  // select props for the panel so each filter stays consistent.
  const filterSelect = (ariaLabel, value, onChange, options, className = '') => (
    <select
      className={`field h-7 w-full text-[11.5px] ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{tr(o.label)}</option>
      ))}
    </select>
  )

  const formatDateTime = (value) => {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return formatDateTimeValue(date, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
  }

  return (
    <div className="space-y-8">
      <PageIntro
        kicker={tr('Examinations')}
        title={tr('Examinations')}
        actions={
          <>
            {message.text && (
              <span className="inline-flex items-center gap-1.5 border border-line-strong bg-surface px-2 py-1 text-[10.5px] text-ink-2">
                {message.text}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110"
            >
              <Plus size={12} /> {tr('Add Examination')}
            </button>
          </>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Manage the exams scheduled for each major during the semester. Each exam has its own type; students are shuffled into exam groups that sit the exam in assigned rooms.')}
        </p>
      </PageIntro>

      {/* Create-examination modal: opened by the header "Add Examination"
          button. The major/year/semester selectors and the guards picker are
          part of the create flow, so they live in the modal too. */}
      <Modal
        open={showCreateModal}
        onClose={closeCreateModal}
        maxWidth="max-w-[820px]"
        title={tr("Add Examination")}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeCreateModal}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Cancel')}
            </button>
            <button
              type="submit"
              form="create-examination-form"
              disabled={loading || !selectedMajor || !selectedSemester}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={11} /> {tr("Add Examination")}
            </button>
          </div>
        }
      >
        <form id="create-examination-form" onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Left column: the exam's own details. */}
          <div className="space-y-3.5">
            <p className="text-[12px] leading-relaxed text-ink-2">{tr("Exams belong to a major. Pick the major below first.")}</p>

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("Major")}</label>
              <select
                className="field h-8 w-full text-[12px]"
                value={selectedMajor}
                onChange={(e) => setSelectedMajor(e.target.value ? Number(e.target.value) : '')}
              >
                {majors.map((major) => (
                  <option key={major.MAJOR_ID} value={major.MAJOR_ID}>
                    {major.MAJOR_LABEL || major.MAJOR_CODE}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("Study Year")}</label>
              <select
                className="field h-8 w-full text-[12px]"
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">{tr("-- Select Year --")}</option>
                {studyYears.map((y) => (
                  <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>{y.STUDY_YEAR_LABEL || y.STUDY_YEAR_CODE}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("Semester")}</label>
              <select
                className="field h-8 w-full text-[12px]"
                value={selectedSemester}
                onChange={(e) => setSelectedSemester(e.target.value ? Number(e.target.value) : '')}
                disabled={!selectedYear}
              >
                <option value="">{tr("-- Select Semester --")}</option>
                {semesters.map((s) => (
                  <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>{s.STUDY_SEMESTER_LABEL || s.STUDY_SEMESTER_CODE}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("Examination Code")} *</label>
              <input
                type="text"
                className="field h-8 w-full text-[12px]"
                value={createForm.EXAMINATION_CODE}
                onChange={(e) => setCreateForm({ ...createForm, EXAMINATION_CODE: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("Type")}</label>
              <select
                className="field h-8 w-full text-[12px]"
                value={createForm.EXAMINATION_TYPE_ID || ''}
                onChange={(e) => setCreateForm({ ...createForm, EXAMINATION_TYPE_ID: e.target.value })}
              >
                <option value="">{tr("-- No Type --")}</option>
                {examTypes.map((type) => (
                  <option key={type.EXAMINATION_TYPE_ID} value={type.EXAMINATION_TYPE_ID}>
                    {type.EXAMINATION_TYPE_LABEL} ({type.EXAMINATION_TYPE_CODE})
                  </option>
                ))}
              </select>
            </div>

            <LocalizedInput
              base="EXAMINATION_LABEL"
              form={createForm}
              setForm={setCreateForm}
              required
              inputClassName="field h-8 w-full text-[12px]"
            />

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("Start Datetime")}</label>
              <input
                type="datetime-local"
                className="field h-8 w-full text-[12px]"
                value={createForm.EXAMINATION_START_DATETIME}
                onChange={(e) => setCreateForm({ ...createForm, EXAMINATION_START_DATETIME: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("End Datetime")}</label>
              <input
                type="datetime-local"
                className="field h-8 w-full text-[12px]"
                value={createForm.EXAMINATION_END_DATETIME}
                onChange={(e) => setCreateForm({ ...createForm, EXAMINATION_END_DATETIME: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <label className="kicker block text-[9px]">{tr("Factor (optional)")}</label>
              <input
                type="number"
                step="0.01"
                placeholder={tr("e.g. 1.00")}
                className="field h-8 w-full text-[12px]"
                value={createForm.EXAMINATION_FACTOR}
                onChange={(e) => setCreateForm({ ...createForm, EXAMINATION_FACTOR: e.target.value })}
              />
            </div>
          </div>

          {/* Right column: guards proctor the exam in the rooms its exam
              groups sit in. */}
          <div className="space-y-1.5">
            <label className="kicker flex items-center gap-1 text-[9px]">
              <ShieldCheck size={11} /> {tr("Guards (staff)")}
            </label>
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={13} />
              <input
                type="text"
                placeholder={tr("Search staff by name...")}
                className="field h-8 w-full ps-8 text-[12px]"
                value={guardSearch}
                onChange={(e) => setGuardSearch(e.target.value)}
              />
            </div>
            <div className="max-h-96 divide-y divide-line overflow-y-auto rounded-[4px] border border-line">
              {visibleGuards.length === 0 ? (
                <p className="px-2.5 py-3 text-[11px] text-ink-3">
                  {freeGuards.length > 0
                    ? tr('No staff member matches your search.')
                    : persons.length === 0
                      ? tr('No staff persons available.')
                      : createForm.EXAMINATION_START_DATETIME && createForm.EXAMINATION_END_DATETIME
                        ? tr('No staff member is free during this time window — every eligible guard is busy in another overlapping exam.')
                        : tr('No staff persons available. Set the exam times to see available guards.')}
                </p>
              ) : (
                visibleGuards.map((p) => {
                  const checked = selectedGuards.includes(p.PERSON_ID)
                  return (
                    <label key={p.PERSON_ID} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGuard(p.PERSON_ID)}
                        className="h-3.5 w-3.5 rounded border-line-strong text-jade-600 focus:ring-jade-500/30"
                      />
                      <span className="flex-1 text-[12px] text-ink">
                        {p.PERSON_FIRST_NAME} {p.PERSON_LAST_NAME}
                      </span>
                    </label>
                  )
                })
              )}
            </div>
            <p className="text-[11px] text-ink-3">{tr("Guards proctor the exam; the list only shows staff free during the exam's time window — busy guards are hidden automatically.")}</p>
          </div>
        </form>
      </Modal>

      {/* List */}
      <div className="bg-surface rounded-[4px] border border-line">
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[3px] bg-surface-muted text-jade-600">
              <Calendar size={14} strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">{tr("Examinations")}</h2>
              <p className="text-[11px] text-ink-3">{tr("Exams for the selected major.")}</p>
            </div>
            <span className="mono ms-auto shrink-0 text-[10.5px] text-ink-3">
              {filteredExaminations.length}{' / '}{examinations.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <div className="relative min-w-[12rem] flex-1">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={13} />
              <input
                type="text"
                placeholder={tr("Search by label, code or type...")}
                className="field h-8 w-full ps-8 text-[12px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <FilterBar
              activeCount={activeFilterCount}
              onClear={clearFilters}
              matchCount={filteredExaminations.length}
              matchLabel="exam"
              title={tr("Filter examinations")}
            >
              <FilterField label={tr("Semester")}>
                {filterSelect('Filter by semester', filterSemester, setFilterSemester, [
                  { value: '', label: tr('All semesters') },
                  ...semesters.map((s) => ({
                    value: String(s.STUDY_SEMESTER_ID),
                    label: s.STUDY_SEMESTER_LABEL || s.STUDY_SEMESTER_CODE
                  }))
                ])}
              </FilterField>
              <FilterField label={tr("Exam type")}>
                {filterSelect('Filter by exam type', filterType, setFilterType, [
                  { value: '', label: tr('All types') },
                  ...examTypes.map((t) => ({
                    value: String(t.EXAMINATION_TYPE_ID),
                    label: `${t.EXAMINATION_TYPE_LABEL} (${t.EXAMINATION_TYPE_CODE})`
                  }))
                ])}
              </FilterField>
              <FilterField label={tr("Timing")}>
                {filterSelect('Filter by timing', filterTiming, setFilterTiming, [
                  { value: 'all', label: tr('All dates') },
                  { value: 'upcoming', label: tr('Upcoming only') },
                  { value: 'past', label: tr('Past only') }
                ])}
              </FilterField>
              <FilterField label={tr("Seating")}>
                {filterSelect('Filter by seating status', filterSeating, setFilterSeating, [
                  { value: 'all', label: tr('All exams') },
                  { value: 'seated', label: tr('Seated only (has groups)') },
                  { value: 'not_seated', label: tr('Not seated yet') }
                ])}
              </FilterField>
              <FilterField label={tr("Factor")}>
                {filterSelect('Filter by factor presence', filterFactor, setFilterFactor, [
                  { value: 'all', label: tr('All exams') },
                  { value: 'with', label: tr('With factor') },
                  { value: 'without', label: tr('Without factor') }
                ])}
              </FilterField>
            </FilterBar>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[10.5px] font-medium text-ink-2 hover:bg-surface-muted"
              >
                <X size={11} />{' '}{tr("Clear filters")}
              </button>
            )}
          </div>

          <div className="space-y-2 p-4">
            {            !selectedMajor ? (
              <p className="text-[12.5px] text-ink-3">{tr("Select a major to see its examinations.")}</p>
            ) : filteredExaminations.length === 0 ? (
              examinations.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">{tr("No examinations defined for this major yet.")}</p>
              ) : (
                <div className="text-[12.5px] text-ink-3 space-y-2">
                  <p>{tr("No examinations match the current search and filters.")}</p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-jade-600 hover:text-jade-500 font-medium text-[12.5px]"
                  >{tr("Clear all filters")}</button>
                </div>
              )
            ) : (
              filteredExaminations.map((exam) => (
                <div key={exam.EXAMINATION_ID} className="rounded-[4px] border border-line bg-surface-muted/30 p-3 transition-colors hover:border-line-strong">
                  {editingId === exam.EXAMINATION_ID ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          type="text"
                          className="w-full p-2 border border-line rounded-md text-[12.5px]"
                          value={editForm.EXAMINATION_CODE}
                          onChange={(e) => setEditForm({ ...editForm, EXAMINATION_CODE: e.target.value })}
                        />
                        <LocalizedInput
                          base="EXAMINATION_LABEL"
                          form={editForm}
                          setForm={setEditForm}
                          required
                          inputClassName="w-full p-2 border border-line rounded-md text-[12.5px]"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <select
                            className="w-full p-2 border border-line rounded-md text-[12.5px]"
                            value={editForm.EXAMINATION_TYPE_ID || ''}
                            onChange={(e) => setEditForm({ ...editForm, EXAMINATION_TYPE_ID: e.target.value })}
                          >
                            <option value="">{tr("-- No Type --")}</option>
                            {examTypes.map((type) => (
                              <option key={type.EXAMINATION_TYPE_ID} value={type.EXAMINATION_TYPE_ID}>
                                {type.EXAMINATION_TYPE_LABEL} ({type.EXAMINATION_TYPE_CODE})
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <input
                          type="datetime-local"
                          className="w-full p-2 border border-line rounded-md text-[12.5px]"
                          value={editForm.EXAMINATION_START_DATETIME}
                          onChange={(e) => setEditForm({ ...editForm, EXAMINATION_START_DATETIME: e.target.value })}
                        />
                        <input
                          type="datetime-local"
                          className="w-full p-2 border border-line rounded-md text-[12.5px]"
                          value={editForm.EXAMINATION_END_DATETIME}
                          onChange={(e) => setEditForm({ ...editForm, EXAMINATION_END_DATETIME: e.target.value })}
                        />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={tr("Factor")}
                        className="w-full p-2 border border-line rounded-md text-[12.5px]"
                        value={editForm.EXAMINATION_FACTOR}
                        onChange={(e) => setEditForm({ ...editForm, EXAMINATION_FACTOR: e.target.value })}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="px-4 py-2 rounded-md border border-line-strong text-[12.5px] text-ink hover:bg-surface-muted flex items-center gap-2"
                        ><X size={16} />{' '}{tr("Cancel")}</button>
                        <button
                          type="button"
                          onClick={() => handleUpdate(exam.EXAMINATION_ID)}
                          className="px-4 py-2 rounded-md bg-jade-solid text-on-jade text-[12.5px] hover:brightness-110 flex items-center gap-2"
                        ><Check size={16} />{' '}{tr("Save")}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-ink">{exam.EXAMINATION_LABEL}</p>
                          <p className="text-[11px] text-ink-3">{exam.EXAMINATION_CODE}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openSeating(exam)}
                            className="px-3 py-2 rounded-md bg-selection text-ink hover:bg-selection/70 flex items-center gap-1.5 text-[11px] font-medium"
                            title={tr("Shuffle students into exam groups, assign seats and paper codes")}
                          ><Users size={16} />{' '}{tr("Seating")}</button>
                          <button
                            onClick={() => startEdit(exam)}
                            className="p-2 rounded-md bg-surface-muted text-ink hover:bg-surface"
                          ><Edit2 size={16} /></button>
                          <button
                            onClick={() => setConfirmTarget(exam.EXAMINATION_ID)}
                            className="p-2 rounded-md bg-danger-bg text-danger-ink hover:brightness-110"
                          ><Trash2 size={16} /></button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-ink-2">
                        {exam.EXAMINATION_TYPE_LABEL && (
                          <span className="inline-flex items-center gap-1 text-jade-600 font-medium">
                            <Tag size={14} /> {exam.EXAMINATION_TYPE_LABEL}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Clock size={14} className="text-ink-3" /> {formatDateTime(exam.EXAMINATION_START_DATETIME)} → {formatDateTime(exam.EXAMINATION_END_DATETIME)}
                        </span>
                        {exam.ROOMS && (
                          <span className="inline-flex items-center gap-1">
                            <DoorOpen size={14} className="text-ink-3" /> {exam.ROOMS}
                          </span>
                        )}
                        {exam.EXAMINATION_FACTOR !== null && exam.EXAMINATION_FACTOR !== undefined && (
                          <span className="inline-flex items-center gap-1">
                            <Award size={14} className="text-ink-3" />{' '}{tr("Factor:")}{' '}{exam.EXAMINATION_FACTOR}
                          </span>
                        )}
                        {Number(exam.GROUP_COUNT) > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Users size={14} className="text-ink-3" /> {exam.GROUP_COUNT}{' '}{tr("exam group")}{Number(exam.GROUP_COUNT) === 1 ? '' : 's'} · {exam.SEEDED_COUNT}{' '}{tr("seated")}{' '}{Number(exam.ROOM_SEAT_COUNT) > 0 && ` · ${exam.SEEDED_COUNT}/${exam.ROOM_SEAT_COUNT} seats`}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      {/* Seating modal — shuffle the major's students into exam groups (each
          with its own room), then give every student a seat number and the
          code of their response paper. */}
      {seatingExam && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-sunken/80 p-4">
          <div className="bg-raised rounded-lg border border-line-strong w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-4 p-5 border-b">
              <div className="flex items-start gap-3">
                <Users className="text-jade-600 shrink-0 mt-0.5" size={22} />
                <div>
                  <h2 className="text-lg font-semibold text-ink">{tr("Manage seating —")}{' '}{seatingExam.EXAMINATION_LABEL}</h2>
                  <p className="text-[11px] text-ink-3 mt-0.5">{tr("Shuffle students into exam groups (each group sits in one room), then assign every student a seat number and a response-paper code.")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeSeating}
                className="text-ink-3 hover:text-ink-2 p-1"
              ><X size={20} /></button>
            </div>

            {/* Shuffle bar */}
            <div className="px-5 py-3 border-b bg-surface-muted flex flex-wrap items-center gap-3">
              <label className="text-[11px] font-medium text-ink inline-flex items-center gap-2">{tr("Group size")}{' '}<input
                  type="number"
                  min="1"
                  className="w-20 p-2 border border-line rounded-md text-[12.5px]"
                  value={shuffleSize}
                  onChange={(e) => setShuffleSize(e.target.value)}
                  placeholder={tr("e.g. 20")}
                />
              </label>
              <button
                type="button"
                onClick={() => shuffleGroups()}
                className="inline-flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-md bg-jade-solid text-on-jade hover:brightness-110"
              ><Shuffle size={14} />{' '}{tr("Shuffle into exam groups")}</button>
              <button
                type="button"
                onClick={autoSeats}
                className="inline-flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-md border border-line-strong text-ink-2 hover:bg-surface-muted"
              ><Hash size={14} />{' '}{tr("Auto seats")}</button>
              <button
                type="button"
                onClick={autoPaperCodes}
                className="inline-flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-md border border-line-strong text-ink-2 hover:bg-surface-muted"
              ><FileKey size={14} />{' '}{tr("Auto paper codes")}</button>
              <span className="text-[11px] text-ink-3 ms-auto">{seatingRows.length}{' '}{tr("student")}{seatingRows.length === 1 ? '' : 's'}</span>
            </div>

            {/* Exam groups editor */}
            <div className="px-5 py-3 border-b space-y-2 max-h-44 overflow-y-auto">
              {groups.length === 0 ? (
                <p className="text-[11px] text-ink-3">{tr("No exam groups yet — set a group size and shuffle, or add groups manually below.")}</p>
              ) : (
                groups.map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-ink-2 w-24">{tr("Group")}{' '}{i + 1}</span>
                    <input
                      type="text"
                      className="flex-1 p-2 border border-line rounded-md text-[12.5px]"
                      value={g.EXAMINATION_GROUP_LABEL}
                      onChange={(e) => setGroups(prev => prev.map((x, j) => j === i ? { ...x, EXAMINATION_GROUP_LABEL: e.target.value } : x))}
                      placeholder={tr("Group label")}
                    />
                    <select
                      className="p-2 border border-line rounded-md text-[12.5px] w-56"
                      value={g.CLASSROOM_ID || ''}
                      onChange={(e) => setGroupRoom(i, e.target.value)}
                    >
                      <option value="">{tr("-- Room --")}</option>
                      {classrooms.map((c) => (
                        <option key={c.CLASSROOM_ID} value={c.CLASSROOM_ID}>
                          {c.CLASSROOM_LABEL} ({c.CLASSROOM_CODE}){c.CLASSROOM_CAPACITY ? ` · cap. ${c.CLASSROOM_CAPACITY}` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="text-[11px] text-ink-3 w-20 text-end">
                      {Object.values(groupAssign).filter(gi => gi === i).length}{' '}{tr("st.")}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setGroups(prev => prev.filter((_, j) => j !== i))
                        setGroupAssign(prev => Object.fromEntries(Object.entries(prev).map(([pid, gi]) => [pid, gi === i ? '' : gi > i ? gi - 1 : gi])))
                      }}
                      className="p-2 rounded-md bg-danger-bg text-danger-ink hover:brightness-110"
                      title={tr("Remove this exam group")}
                    ><Trash2 size={14} /></button>
                  </div>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  setGroups(prev => [...prev, { EXAMINATION_GROUP_LABEL: `Exam Group ${prev.length + 1}`, CLASSROOM_ID: '' }])
                }}
                className="text-[11px] inline-flex items-center gap-1 text-jade-600 hover:text-jade-500 font-medium"
              ><Plus size={12} />{' '}{tr("Add exam group")}</button>
            </div>

            {/* Per-student assignment */}
            <div className="overflow-y-auto p-5 space-y-2 flex-1">
              {seatingRows.length === 0 ? (
                <p className="text-[12.5px] text-ink-3">{tr("No students in this major/semester teaching groups.")}</p>
              ) : (
                seatingRows.map((r) => (
                  <div key={r.PERSON_ID} className="flex flex-wrap items-center gap-2 border border-line rounded-md p-3">
                    <div className="flex-1 min-w-[10rem]">
                      <p className="text-[12.5px] font-medium text-ink truncate">
                        {r.PERSON_FIRST_NAME} {r.PERSON_LAST_NAME}
                      </p>
                      <p className="text-[11px] text-ink-3">
                        {r.TEACHING_GROUP_LABEL || tr('No teaching group')}
                        {r.SECTION_LABEL ? ` · ${r.SECTION_LABEL}` : ''}
                      </p>
                    </div>
                    <select
                      className="p-2 border border-line rounded-md text-[12.5px] w-44"
                      value={groupAssign[r.PERSON_ID] ?? ''}
                      onChange={(e) => setGroupAssign(prev => ({ ...prev, [r.PERSON_ID]: e.target.value === '' ? '' : Number(e.target.value) }))}
                    >
                      <option value="">{tr("-- Not seated --")}</option>
                      {groups.map((g, i) => (
                        <option key={i} value={i}>
                          {g.EXAMINATION_GROUP_LABEL || `Group ${i + 1}`}
                          {g.CLASSROOM_ID ? ` · ${classroomLabel(g.CLASSROOM_ID)}` : ''}
                        </option>
                      ))}
                    </select>
                    <select
                      className="p-2 border border-line rounded-md text-[12.5px] w-28"
                      value={seatDraft[r.PERSON_ID] ?? ''}
                      onChange={(e) => setSeatDraft(prev => ({ ...prev, [r.PERSON_ID]: e.target.value }))}
                      disabled={groupAssign[r.PERSON_ID] === '' || groupAssign[r.PERSON_ID] == null}
                    >
                      <option value="">{tr("-- Seat --")}</option>
                      {(() => {
                        const gi = groupAssign[r.PERSON_ID]
                        const room = groups[gi]?.CLASSROOM_ID
                        const all = roomSeats[room] || []
                        // A seat is taken when a student of ANOTHER exam booked it
                        // in the DB, or when a different student of THIS modal
                        // holds it in their draft for a group in the same room.
                        const draftHolders = new Map()
                        for (const [pidStr, otherGi] of Object.entries(groupAssign)) {
                          if (Number(pidStr) === r.PERSON_ID) continue
                          const v = parseInt(seatDraft[Number(pidStr)], 10)
                          if (Number.isNaN(v)) continue
                          const otherRoom = groups[otherGi]?.CLASSROOM_ID
                          if (otherRoom === room) draftHolders.set(v, Number(pidStr))
                        }
                        return all
                          .filter(s => {
                            if (s.OCCUPANT_PERSON_ID && s.OCCUPANT_PERSON_ID !== r.PERSON_ID) return false
                            if (draftHolders.has(s.SEAT_NUMBER)) return false
                            return true
                          })
                          .map(s => (
                            <option key={s.SEAT_NUMBER} value={s.SEAT_NUMBER}>{tr("Seat")}{' '}{s.SEAT_NUMBER}
                            </option>
                          ))
                      })()}
                    </select>
                    <input
                      type="text"
                      className={`p-2 border border-line rounded-md text-[12.5px] w-40 mono ${duplicatePaperCodes().has(r.PERSON_ID) ? 'border-danger bg-danger-bg' : 'border-line-strong'}`}
                      placeholder={tr("Paper code")}
                      value={paperDraft[r.PERSON_ID] ?? ''}
                      onChange={(e) => setPaperDraft(prev => ({ ...prev, [r.PERSON_ID]: e.target.value }))}
                      disabled={groupAssign[r.PERSON_ID] === '' || groupAssign[r.PERSON_ID] == null}
                    />
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-5 border-t">
              <button
                type="button"
                onClick={closeSeating}
                className="px-4 py-2 rounded-md border border-line-strong text-[12.5px] text-ink hover:bg-surface-muted"
              >{tr("Close")}</button>
              <button
                type="button"
                onClick={handleSaveSeating}
                disabled={loading || groups.length === 0}
                className="px-4 py-2 rounded-md bg-jade-solid text-on-jade text-[12.5px] hover:brightness-110 disabled:opacity-50 flex items-center gap-2"
              ><Check size={16} />{' '}{tr("Save seating")}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmTarget}
        title={tr("Delete Examination")}
        message={tr('Delete this examination?')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => { const id = confirmTarget; setConfirmTarget(null); handleDelete(id) }}
      />
    </div>
  )
}

export default Examinations
