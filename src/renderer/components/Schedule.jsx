import React, { useState, useEffect, useMemo } from 'react'
import { formatTime } from '../dateFormat'
import { createPortal } from 'react-dom'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, MapPin, BookOpen, X, Check, Plus, AlertCircle, FileText, ShieldAlert } from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import SearchSelect from './ui/SearchSelect'
import SessionDetailsModal from './SessionDetailsModal'
import ScheduleVolumePanel from './ScheduleVolumePanel'
import SplitPane from './ui/SplitPane'
import { PageHeader } from './ui/PageHeader'
import { CONSTRAINT_POLICIES, constraintPolicyLabel, normalizeConstraintPolicy } from '../constraintPolicies'
import { usePersistentState } from '../usePersistentState'
import { useDraft } from '../useDraft'
import { weekdayName, formatDayShort, formatDateLabel, sessionTypeLabel, pickCurrentYearId, pickCurrentSemesterId, pickCurrentWeekId, pickCurrentOrUpcomingDayId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { tr } from '../i18n'

// One row per teaching hour, 06:00 through the 23:00 row that ends at 24:00.
const HOURS = Array.from({ length: 18 }, (_, i) => i + 6) // 6 AM to midnight

// Per-session-type colors for the timetable cards. Matches by CODE first
// (stable across databases), then falls back to a hash of the label so any
// custom type still gets a consistent, distinct color.
const SESSION_TYPE_COLORS = {
  LEC: { bg: 'bg-blue-50', border: 'border-blue-500', title: 'text-blue-900', strong: 'text-blue-700', soft: 'text-blue-600', faint: 'text-blue-500' },
  PRC: { bg: 'bg-emerald-50', border: 'border-emerald-500', title: 'text-emerald-900', strong: 'text-emerald-700', soft: 'text-emerald-600', faint: 'text-emerald-500' },
  SEM: { bg: 'bg-amber-50', border: 'border-amber-500', title: 'text-amber-900', strong: 'text-amber-700', soft: 'text-amber-600', faint: 'text-amber-500' },
  EXM: { bg: 'bg-purple-50', border: 'border-purple-500', title: 'text-purple-900', strong: 'text-purple-700', soft: 'text-purple-600', faint: 'text-purple-500' }
}
const SESSION_TYPE_COLOR_FALLBACKS = [
  SESSION_TYPE_COLORS.LEC,
  SESSION_TYPE_COLORS.PRC,
  SESSION_TYPE_COLORS.SEM,
  SESSION_TYPE_COLORS.EXM,
  { bg: 'bg-rose-50', border: 'border-rose-500', title: 'text-rose-900', strong: 'text-rose-700', soft: 'text-rose-600', faint: 'text-rose-500' },
  { bg: 'bg-cyan-50', border: 'border-cyan-500', title: 'text-cyan-900', strong: 'text-cyan-700', soft: 'text-cyan-600', faint: 'text-cyan-500' },
  { bg: 'bg-lime-50', border: 'border-lime-500', title: 'text-lime-900', strong: 'text-lime-700', soft: 'text-lime-600', faint: 'text-lime-500' },
  { bg: 'bg-orange-50', border: 'border-orange-500', title: 'text-orange-900', strong: 'text-orange-700', soft: 'text-orange-600', faint: 'text-orange-500' }
]
const sessionTypeColorOf = (session) => {
  const code = String(session?.STUDY_SESSION_TYPE_CODE || '').toUpperCase()
  if (SESSION_TYPE_COLORS[code]) return SESSION_TYPE_COLORS[code]
  const label = String(session?.STUDY_SESSION_TYPE_LABEL || '')
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return SESSION_TYPE_COLOR_FALLBACKS[hash % SESSION_TYPE_COLOR_FALLBACKS.length]
}

// Duration between two 'HH:MM' times, in hours.
const getDurationHours = (start, end) => {
  const [startH, startM] = (start || '00:00').split(':').map(Number)
  const [endH, endM] = (end || '00:00').split(':').map(Number)
  const minutes = endH * 60 + endM - startH * 60 - startM
  // 00:00 as an end closes the timetable day: it is midnight, not the start.
  return (minutes < 0 ? minutes + 24 * 60 : minutes) / 60
}

// A time from the database ('08:00:00') and one from a time input ('08:00') have
// to compare as the same moment, so everything is cut to minutes first.
const timeKey = (value) => String(value || '').slice(0, 5)

// Midnight can close a session: an end of 00:00 sorts before an evening start,
// so it is read as 24:00 wherever times are compared.
const endTimeKey = (start, end) => {
  const startKey = timeKey(start)
  const endKey = timeKey(end)
  return startKey && endKey && endKey <= startKey ? '24:00' : endKey
}

// Two sessions overlap when each starts before the other ends. Touching slots
// (one ends at 10:00, the next starts at 10:00) do not.
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && aEnd > bStart

// Human-friendly formatting: '2' instead of '2.0', '1.5' stays '1.5'.
const fmtHrs = (n) => `${Number.isInteger(n) ? n : n.toFixed(1)}`
const hrsWord = (n) => `${fmtHrs(n)} ${n === 1 ? 'hour' : 'hours'}`

// Seat capacity of a room as a number, or null when the room has no capacity
// set — then there is nothing to compare a group's roster against.
const classroomSeats = (room) => {
  const raw = room?.CLASSROOM_CAPACITY
  if (raw === null || raw === undefined || raw === '') return null
  const seats = Number(raw)
  return Number.isNaN(seats) ? null : seats
}

const Schedule = ({ user }) => {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')
  
  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [weeks, setWeeks] = useState([])
  const [days, setDays] = useState([])
  const [sections, setSections] = useState([])
  
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [selectedWeek, setSelectedWeek] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')

  // Roll the timetable over to the new current period at midnight / on wake-up
  // while this page stays open (unless the user is browsing another period).
  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester },
    { rows: weeks, pickId: pickCurrentWeekId, selectedId: selectedWeek, setSelectedId: setSelectedWeek }
  ])
  // Exam blocks drawn on the timetable: exams whose window overlaps the
  // selected week, one block per (exam, room). Loaded alongside sessions.
  const [examEvents, setExamEvents] = useState([])

  // New states for session creation
  const [showModal, setShowModal] = useState(false)
  const [classrooms, setClassrooms] = useState([])
  const [majors, setMajors] = useState([])
  const [teachers, setTeachers] = useState([])
  const [majorTeachers, setMajorTeachers] = useState({})
  // Teaching groups for the GROUP filter dropdown: scoped to the selected
  // year/semester (teaching groups belong to a semester). Falls back to all
  // groups when neither is chosen.
  const [filterGroups, setFilterGroups] = useState([])
  // Teaching groups of the major selected INSIDE the session modal, scoped to
  // the selected semester — only groups that study that major are offered.
  const [modalGroups, setModalGroups] = useState([])
  const [modalGroupsLoading, setModalGroupsLoading] = useState(false)
  // The signed-in account's teaching-category scope: a scheduler only reads and
  // writes the weekly timetable of the categories an admin gave them.
  const [scope, setScope] = useState(null)
  const [allCategories, setAllCategories] = useState([])
  const [newGroupCategory, setNewGroupCategory] = useState('')
  // The whole selected week, unfiltered by the GROUP dropdown: the dialog has
  // to know which classes are already booked at the slot being filled, and the
  // page's own list is narrowed by that filter.
  const [modalSessions, setModalSessions] = useState([])
  // The predefined start/end pairs an Admin keeps in Settings, offered by the
  // session dialog next to the manual times.
  const [timeSlots, setTimeSlots] = useState([])
  const [sessionTypes, setSessionTypes] = useState([])
  // Volume is a page-level tool over the whole major, opened from the header.
  const [showVolumePanel, setShowVolumePanel] = useState(false)
  const [promotions, setPromotions] = useState([])
  const [isCreatingNewGroup, setIsCreatingNewGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  // Weekly teacher constraints. The Admin may force a policy, in which case the
  // scheduler's own choice below is not read; when the feature is off, neither
  // the list nor the policy control is drawn and the server ignores the rows.
  const [constraintSettings, setConstraintSettings] = useState({ enabled: false, forced: false, policy: 'hard' })
  const [weekConstraints, setWeekConstraints] = useState([])
  const [showSoftPicker, setShowSoftPicker] = useState(false)
  const [constraintPolicy, setConstraintPolicy] = usePersistentState(
    `teacher-constraint-policy:${user?.id || 'anonymous'}`,
    ''
  )
  const [selectedSoftConstraintIds, setSelectedSoftConstraintIds] = usePersistentState(
    `teacher-constraint-soft:${user?.id || 'anonymous'}`,
    []
  )

  
  const [selectedSessionForView, setSelectedSessionForView] = useState(null)
  const [showSessionDetailsModal, setShowSessionDetailsModal] = useState(false)
  
  const [currentSession, setCurrentSession] = useState({
    CLASSROOM_ID: '',
    STUDY_SESSION_TYPE_ID: '',
    STUDY_DAY_ID: '',
    STUDY_SESSION_START_TIME: '08:00',
    STUDY_SESSION_END_TIME: '10:00',
    MAJOR_ID: '',
    TEACHING_GROUP_ID: '',
    INSTRUCTOR_ID: ''
  })

  const loadScope = async () => {
    try {
      const [scopeRes, categoriesRes] = await Promise.all([
        window.api.getMyTeachingScope(user?.id),
        window.api.getTeachingCategories()
      ])
      setScope(scopeRes || null)
      setAllCategories(categoriesRes?.data || [])
    } catch (err) {
      console.error('Failed to load the teaching scope', err)
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

  const loadWeekConstraints = async (weekId) => {
    try {
      const result = await window.api.getTeacherConstraints(weekId)
      const rows = result?.data || []
      setWeekConstraints(rows)
      // A soft window removed or moved to another week leaves no tick behind.
      const softIds = rows
        .filter((row) => String(row.CONSTRAINT_KIND).toUpperCase() === 'SOFT')
        .map((row) => Number(row.TEACHER_CONSTRAINT_ID))
      setSelectedSoftConstraintIds((prev) => (
        (Array.isArray(prev) ? prev : [])
          .map((id) => Number(id))
          .filter((id) => softIds.includes(id))
      ))
    } catch (err) {
      console.error('Failed to load teacher constraints', err)
      setWeekConstraints([])
    }
  }

  // A group outside the account's categories is neither offered nor drawn. A
  // scheduler must also satisfy their department scope: the group's major must
  // name a major category owned by one of their departments.
  const inScopeGroup = (group) => {
    if (!scope?.restricted) return true
    const categoryId = group?.TEACHING_CATEGORY_ID
    if (categoryId === null || categoryId === undefined ||
        !scope.categoryIds.map(Number).includes(Number(categoryId))) {
      return false
    }
    if (scope.departmentRestricted) {
      const majorCategoryId = group?.MAJOR_CATEGORY_ID
      return majorCategoryId !== null && majorCategoryId !== undefined &&
        (scope.majorCategoryIds || []).map(Number).includes(Number(majorCategoryId))
    }
    return true
  }

  // The majors a scheduler may schedule in: only those whose major category is
  // owned by one of their departments. Everyone else sees every major.
  const scopedMajors = useMemo(() => {
    if (!scope?.departmentRestricted) return majors
    const allowed = (scope.majorCategoryIds || []).map(Number)
    return majors.filter((major) => allowed.includes(Number(major.MAJOR_CATEGORY_ID)))
  }, [majors, scope])

  const groupCategoryOptions = useMemo(() => {
    const rows = scope?.restricted ? (scope.categories || []) : allCategories
    return rows.map((category) => ({
      TEACHING_CATEGORY_ID: category.TEACHING_CATEGORY_ID,
      TEACHING_CATEGORY_LABEL: category.TEACHING_CATEGORY_LABEL
        || category.TEACHING_CATEGORY_LABEL_EN
        || category.TEACHING_CATEGORY_LABEL_AR
        || category.TEACHING_CATEGORY_LABEL_FR
        || `#${category.TEACHING_CATEGORY_ID}`
    }))
  }, [scope, allCategories])

  useEffect(() => {
    loadYears()
    loadFormData()
    loadSections()
    loadScope()
    loadConstraintSettings()
  }, [])

  const loadFormData = async () => {
    try {
      const [cls, mjs, tchs, mTeachers, typs, prms, slots] = await Promise.all([
        window.api.getClassrooms(),
        window.api.getMajors(),
        window.api.getTeachers(),
        window.api.getMajorTeachers(),
        window.api.getStudySessionTypes(),
        window.api.getPromotions(),
        window.api.getStudySessionTimeSlots()
      ])

      setClassrooms(cls?.data || [])
      setMajors(mjs?.data || [])
      setTeachers(tchs?.data || [])
      setMajorTeachers((mTeachers?.data || []).reduce((acc, row) => {
        const majorId = String(row.MAJOR_ID)
        acc[majorId] = acc[majorId] || []
        acc[majorId].push(row)
        return acc
      }, {}))
      setSessionTypes(typs?.data || [])
      setPromotions(prms?.data || [])
      setTimeSlots(slots?.data || [])

    } catch (err) {
      console.error('Failed to load form data', err)
    }
  }

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

  // The GROUP filter follows the year/semester selection: when the semester
  // changes, reload its groups and reset the filter if the selected group no
  // longer belongs to the new scope.
  useEffect(() => {
    let mounted = true
    const loadFilterGroups = async () => {
      try {
        const res = await window.api.getTeachingGroupsForSemester(selectedSemester, selectedYear)
        if (!mounted) return
        const data = res?.data || []
        setFilterGroups(data)
        setSelectedGroup(prev =>
          prev && data.some(g => String(g.TEACHING_GROUP_ID) === String(prev)) ? prev : ''
        )
      } catch (err) {
        console.error('Failed to load groups for filter', err)
        if (mounted) setFilterGroups([])
      }
    }
    loadFilterGroups()
    return () => { mounted = false }
  }, [selectedSemester, selectedYear])

  useEffect(() => {
    if (selectedWeek) {
      loadSchedule(selectedWeek, selectedGroup)
      loadExamEvents(selectedWeek, selectedGroup)
    } else {
      setSessions([])
      setExamEvents([])
    }
  }, [selectedWeek, selectedGroup])

  useEffect(() => {
    if (selectedWeek) {
      loadWeekDays(selectedWeek)
    } else {
      setDays([])
    }
  }, [selectedWeek])

  // Constraints of the week drawn on the grid, and of the slot being filled in
  // the dialog. Reloaded when the Admin switches the feature back on.
  useEffect(() => {
    if (selectedWeek && constraintSettings.enabled) {
      loadWeekConstraints(selectedWeek)
    } else {
      setWeekConstraints([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeek, constraintSettings.enabled])

  // Load the teaching groups that study the major chosen in the session
  // modal, within the selected semester. Re-runs whenever the modal's major
  // changes; the chosen group is kept only if it still belongs to the scope.
  useEffect(() => {
    let mounted = true
    const loadModalGroups = async () => {
      const majorId = currentSession.MAJOR_ID
      if (!majorId || !selectedSemester) {
        setModalGroups([])
        return
      }
      setModalGroupsLoading(true)
      try {
        const res = await window.api.getTeachingGroupsByMajor(majorId, selectedSemester)
        if (!mounted) return
        const data = (res?.data || []).filter(inScopeGroup)
        setModalGroups(data)
        setCurrentSession(prev =>
          prev.TEACHING_GROUP_ID && data.some(g => String(g.TEACHING_GROUP_ID) === String(prev.TEACHING_GROUP_ID))
            ? prev
            : { ...prev, TEACHING_GROUP_ID: data.length > 0 ? String(data[0].TEACHING_GROUP_ID) : '' }
        )
      } catch (err) {
        console.error('Failed to load groups for major', err)
        if (mounted) setModalGroups([])
      } finally {
        if (mounted) setModalGroupsLoading(false)
      }
    }
    loadModalGroups()
    return () => { mounted = false }
  }, [currentSession.MAJOR_ID, selectedSemester, showModal, scope])

  // The week's full timetable, loaded when the dialog opens, so availability is
  // known while the user is picking instead of only when the save is refused.
  useEffect(() => {
    if (!showModal || !selectedWeek) return undefined
    let mounted = true
    ;(async () => {
      try {
        // No group argument: the whole week, every class.
        const res = await window.api.getSchedule(user?.id, selectedWeek)
        if (mounted) setModalSessions(res?.data || [])
      } catch (err) {
        console.error('Failed to load the week for availability checks', err)
        if (mounted) setModalSessions([])
      }
    })()
    return () => { mounted = false }
  }, [showModal, selectedWeek])

  // What is already booked in the slot the dialog is filling: one entry per
  // class, room and teacher that cannot take this session.
  const slotConflicts = useMemo(() => {
    const dayId = String(currentSession.STUDY_DAY_ID || '')
    const start = timeKey(currentSession.STUDY_SESSION_START_TIME)
    const end = endTimeKey(start, currentSession.STUDY_SESSION_END_TIME)
    const empty = { groups: new Map(), classrooms: new Map(), instructors: new Map() }
    if (!dayId || !start || !end || start >= end) return empty

    const groups = new Map()
    const classrooms = new Map()
    const instructors = new Map()
    for (const session of modalSessions) {
      if (String(session.STUDY_DAY_ID) !== dayId) continue
      const existingStart = timeKey(session.STUDY_SESSION_START_TIME)
      const existingEnd = endTimeKey(existingStart, session.STUDY_SESSION_END_TIME)
      if (!overlaps(start, end, existingStart, existingEnd)) continue
      if (session.TEACHING_GROUP_ID) groups.set(String(session.TEACHING_GROUP_ID), session)
      if (session.CLASSROOM_ID) classrooms.set(String(session.CLASSROOM_ID), session)
      if (session.INSTRUCTOR_ID) instructors.set(String(session.INSTRUCTOR_ID), session)
    }
    return { groups, classrooms, instructors }
  }, [
    modalSessions,
    currentSession.STUDY_DAY_ID,
    currentSession.STUDY_SESSION_START_TIME,
    currentSession.STUDY_SESSION_END_TIME
  ])

  // The policy actually in force on this page: the Admin's forced choice wins;
  // otherwise the scheduler's own selection applies, falling back to the
  // policy the Admin configured as the default.
  const effectiveConstraintPolicy = constraintSettings.enabled
    ? (constraintSettings.forced
        ? normalizeConstraintPolicy(constraintSettings.policy)
        : normalizeConstraintPolicy(constraintPolicy || constraintSettings.policy))
    : 'none'

  const softConstraintsOfWeek = useMemo(
    () => weekConstraints.filter((row) => String(row.CONSTRAINT_KIND).toUpperCase() === 'SOFT'),
    [weekConstraints]
  )

  const hardConstraintsOfWeek = useMemo(
    () => weekConstraints.filter((row) => String(row.CONSTRAINT_KIND).toUpperCase() === 'HARD'),
    [weekConstraints]
  )

  const selectedSoftCount = useMemo(() => {
    const picked = (Array.isArray(selectedSoftConstraintIds) ? selectedSoftConstraintIds : []).map(Number)
    return softConstraintsOfWeek.filter((row) => picked.includes(Number(row.TEACHER_CONSTRAINT_ID))).length
  }, [softConstraintsOfWeek, selectedSoftConstraintIds])

  // What the server will be told to apply when the session is created. Hard
  // windows are always binding on the server; this choice only decides which
  // soft windows are read as well.
  const constraintChoice = useMemo(() => ({
    policy: effectiveConstraintPolicy === 'none' ? 'hard' : effectiveConstraintPolicy,
    softConstraintIds: effectiveConstraintPolicy === 'some'
      ? (Array.isArray(selectedSoftConstraintIds) ? selectedSoftConstraintIds : []).map(Number)
      : []
  }), [effectiveConstraintPolicy, selectedSoftConstraintIds])

  // Constraints of the instructor chosen in the dialog that overlap the slot
  // being filled, split by what the current policy does with them.
  const sessionConstraintConflicts = useMemo(() => {
    const empty = { hard: [], soft: [], ignoredSoft: [] }
    if (!constraintSettings.enabled) return empty

    const instructorId = String(currentSession.INSTRUCTOR_ID || '')
    const dayId = String(currentSession.STUDY_DAY_ID || '')
    const start = timeKey(currentSession.STUDY_SESSION_START_TIME)
    const end = endTimeKey(start, currentSession.STUDY_SESSION_END_TIME)
    if (!instructorId || !dayId || !start || !end || start >= end) return empty

    const overlapsSlot = weekConstraints
      .filter((row) => String(row.INSTRUCTOR_ID) === instructorId && String(row.STUDY_DAY_ID) === dayId)
      .filter((row) => {
        const rowStart = timeKey(row.CONSTRAINT_START_TIME)
        const rowEnd = endTimeKey(rowStart, row.CONSTRAINT_END_TIME)
        return overlaps(start, end, rowStart, rowEnd)
      })

    const hard = overlapsSlot.filter((row) => String(row.CONSTRAINT_KIND).toUpperCase() === 'HARD')
    const allSoft = overlapsSlot.filter((row) => String(row.CONSTRAINT_KIND).toUpperCase() === 'SOFT')
    const picked = (Array.isArray(selectedSoftConstraintIds) ? selectedSoftConstraintIds : []).map(Number)
    const consideredSoft = effectiveConstraintPolicy === 'all'
      ? allSoft
      : effectiveConstraintPolicy === 'some'
        ? allSoft.filter((row) => picked.includes(Number(row.TEACHER_CONSTRAINT_ID)))
        : []
    const consideredIds = new Set(consideredSoft.map((row) => Number(row.TEACHER_CONSTRAINT_ID)))

    return {
      hard,
      soft: consideredSoft,
      ignoredSoft: allSoft.filter((row) => !consideredIds.has(Number(row.TEACHER_CONSTRAINT_ID)))
    }
  }, [
    constraintSettings.enabled,
    weekConstraints,
    currentSession.INSTRUCTOR_ID,
    currentSession.STUDY_DAY_ID,
    currentSession.STUDY_SESSION_START_TIME,
    currentSession.STUDY_SESSION_END_TIME,
    effectiveConstraintPolicy,
    selectedSoftConstraintIds
  ])

  // A hard window is always binding, and a soft window the current policy
  // considers is refused by the server too: either one blocks the submit.
  const constraintBlocked = sessionConstraintConflicts.hard.length > 0
    || sessionConstraintConflicts.soft.length > 0

  // One line naming a declared window, with its teacher, day, hours and note.
  const constraintRowText = (row) => {
    const start = String(row.CONSTRAINT_START_TIME || '').slice(0, 5)
    const end = String(row.CONSTRAINT_END_TIME || '').slice(0, 5)
    const when = row.STUDY_DAY_DATE ? formatDateLabel(row.STUDY_DAY_DATE) : ''
    const note = row.CONSTRAINT_NOTE ? ` — ${row.CONSTRAINT_NOTE}` : ''
    return [row.INSTRUCTOR_NAME, when, `${start}–${end}`].filter(Boolean).join(' · ') + note
  }

  const toggleSoftConstraint = (row) => {
    const id = Number(row.TEACHER_CONSTRAINT_ID)
    setSelectedSoftConstraintIds((prev) => {
      const list = (Array.isArray(prev) ? prev : []).map(Number)
      return list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
    })
  }

  // The same rule for one entry of the instructor dropdown, so a blocked pick
  // is named before it is chosen rather than only refused on save.
  const constraintStateForInstructor = (personId) => {
    if (!constraintSettings.enabled) return { hard: false, soft: false, ignoredSoft: false }
    const dayId = String(currentSession.STUDY_DAY_ID || '')
    const start = timeKey(currentSession.STUDY_SESSION_START_TIME)
    const end = endTimeKey(start, currentSession.STUDY_SESSION_END_TIME)
    if (!dayId || !start || !end || start >= end) return { hard: false, soft: false, ignoredSoft: false }

    const rows = weekConstraints
      .filter((row) => String(row.INSTRUCTOR_ID) === String(personId) && String(row.STUDY_DAY_ID) === dayId)
      .filter((row) => {
        const rowStart = timeKey(row.CONSTRAINT_START_TIME)
        const rowEnd = endTimeKey(rowStart, row.CONSTRAINT_END_TIME)
        return overlaps(start, end, rowStart, rowEnd)
      })
    const hard = rows.some((row) => String(row.CONSTRAINT_KIND).toUpperCase() === 'HARD')
    const allSoft = rows.filter((row) => String(row.CONSTRAINT_KIND).toUpperCase() === 'SOFT')
    const picked = (Array.isArray(selectedSoftConstraintIds) ? selectedSoftConstraintIds : []).map(Number)
    const consideredSoft = effectiveConstraintPolicy === 'all'
      ? allSoft
      : effectiveConstraintPolicy === 'some'
        ? allSoft.filter((row) => picked.includes(Number(row.TEACHER_CONSTRAINT_ID)))
        : []
    const consideredIds = new Set(consideredSoft.map((row) => Number(row.TEACHER_CONSTRAINT_ID)))
    return {
      hard,
      soft: consideredSoft.length > 0,
      ignoredSoft: allSoft.some((row) => !consideredIds.has(Number(row.TEACHER_CONSTRAINT_ID)))
    }
  }

  // A class booked at this time drops out of the list, so the chosen one may
  // have become impossible while the user was editing the day or the hours.
  useEffect(() => {
    if (!showModal) return
    const chosen = String(currentSession.TEACHING_GROUP_ID || '')
    if (!chosen || !slotConflicts.groups.has(chosen)) return
    const free = modalGroups.find((group) => !slotConflicts.groups.has(String(group.TEACHING_GROUP_ID)))
    setCurrentSession((prev) => ({ ...prev, TEACHING_GROUP_ID: free ? String(free.TEACHING_GROUP_ID) : '' }))
  }, [showModal, slotConflicts, modalGroups, currentSession.TEACHING_GROUP_ID])

  // The same rule for the room and the teacher: a pick that is already taken in
  // this slot would only be refused on save, so it moves to a free one first.
  useEffect(() => {
    if (!showModal) return
    const roomId = String(currentSession.CLASSROOM_ID || '')
    const teacherId = String(currentSession.INSTRUCTOR_ID || '')
    const roomBusy = !!roomId && slotConflicts.classrooms.has(roomId)
    const teacherBusy = !!teacherId && slotConflicts.instructors.has(teacherId)
    if (!roomBusy && !teacherBusy) return

    setCurrentSession((prev) => {
      const next = { ...prev }
      if (roomBusy) {
        const freeRoom = classrooms.find((room) => !slotConflicts.classrooms.has(String(room.CLASSROOM_ID)))
        next.CLASSROOM_ID = freeRoom ? String(freeRoom.CLASSROOM_ID) : ''
      }
      if (teacherBusy) {
        const list = majorTeachers[String(prev.MAJOR_ID)] || []
        const freeTeacher = list.find((t) => !slotConflicts.instructors.has(String(t.PERSON_ID)))
        next.INSTRUCTOR_ID = freeTeacher ? String(freeTeacher.PERSON_ID) : ''
      }
      return next
    })
  }, [showModal, slotConflicts, classrooms, majorTeachers, currentSession.CLASSROOM_ID, currentSession.INSTRUCTOR_ID])

  // The instructor list belongs to the chosen major: a pick that does not teach
  // this major is replaced by one of its teachers (or cleared), so the dialog
  // never shows a blank field holding a mismatched instructor.
  useEffect(() => {
    if (!showModal) return
    const list = majorTeachers[String(currentSession.MAJOR_ID)] || []
    const chosen = String(currentSession.INSTRUCTOR_ID || '')
    if (chosen && list.some((teacher) => String(teacher.PERSON_ID) === chosen)) return
    setCurrentSession((prev) => ({ ...prev, INSTRUCTOR_ID: list[0] ? String(list[0].PERSON_ID) : '' }))
  }, [showModal, majorTeachers, currentSession.MAJOR_ID, currentSession.INSTRUCTOR_ID])

  const bookedGroupsAtSlot = useMemo(
    () => modalGroups.filter((group) => slotConflicts.groups.has(String(group.TEACHING_GROUP_ID))).length,
    [modalGroups, slotConflicts]
  )

  // The instructor list follows the major chosen in the dialog; each dropdown
  // filters itself, so these are just the source lists.
  const modalInstructorOptions = majorTeachers[String(currentSession.MAJOR_ID)] || []

  // Only the classes that are free at the chosen day and hours.
  const modalGroupOptions = useMemo(
    () => modalGroups.filter((group) => inScopeGroup(group) && !slotConflicts.groups.has(String(group.TEACHING_GROUP_ID))),
    [modalGroups, slotConflicts, scope]
  )

  // How many students the dialog's group has (null while a brand-new group is
  // being created, or before a group is chosen). Every classroom list below
  // reads the same number, so a room is marked too small only when the roster
  // is actually known to be larger than its seats.
  const groupStudentCount = useMemo(() => {
    if (isCreatingNewGroup) return null
    const group = modalGroups.find((item) => String(item.TEACHING_GROUP_ID) === String(currentSession.TEACHING_GROUP_ID || ''))
    if (!group) return null
    return Number(group.STUDENT_COUNT) || 0
  }, [isCreatingNewGroup, modalGroups, currentSession.TEACHING_GROUP_ID])

  const chosenClassroom = useMemo(
    () => classrooms.find((item) => String(item.CLASSROOM_ID) === String(currentSession.CLASSROOM_ID || '')) || null,
    [classrooms, currentSession.CLASSROOM_ID]
  )

  // A classroom has to seat the whole class. When the chosen group has more
  // students than the chosen room has seats, the session is refused: the room
  // is too small for it.
  const seatOverflow = useMemo(() => {
    if (groupStudentCount === null || !chosenClassroom) return null
    const seats = classroomSeats(chosenClassroom)
    if (seats === null || groupStudentCount <= seats) return null
    return { seats, students: groupStudentCount }
  }, [groupStudentCount, chosenClassroom])

  // The predefined slot matching the times currently chosen, so the picker
  // reads as selected when the manual times happen to match a slot.
  const activeTimeSlotId = useMemo(() => {
    const start = timeKey(currentSession.STUDY_SESSION_START_TIME)
    const end = timeKey(currentSession.STUDY_SESSION_END_TIME)
    const slot = timeSlots.find((item) =>
      timeKey(item.STUDY_SESSION_TIME_SLOT_START_TIME) === start &&
      timeKey(item.STUDY_SESSION_TIME_SLOT_END_TIME) === end)
    return slot ? String(slot.STUDY_SESSION_TIME_SLOT_ID) : ''
  }, [timeSlots, currentSession.STUDY_SESSION_START_TIME, currentSession.STUDY_SESSION_END_TIME])

  useEffect(() => {
    if (!currentSession.MAJOR_ID) return

    const selectedMajorId = String(currentSession.MAJOR_ID)
    const available = majorTeachers[selectedMajorId] || []

    if (available.length > 0) {
      if (!available.some(t => String(t.PERSON_ID) === String(currentSession.INSTRUCTOR_ID))) {
        setCurrentSession((prev) => ({
          ...prev,
          INSTRUCTOR_ID: String(available[0].PERSON_ID)
        }))
      }
    } else if (currentSession.INSTRUCTOR_ID) {
      setCurrentSession((prev) => ({
        ...prev,
        INSTRUCTOR_ID: ''
      }))
    }
  }, [currentSession.MAJOR_ID, currentSession.INSTRUCTOR_ID, majorTeachers])

  const loadYears = async () => {
    try {
      const result = await window.api.getStudyYears()
      const data = result?.data || []
      setYears(data)
      if (data.length > 0 && !selectedYear) {
        // Default to the year containing today's date when its dates are set.
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

  const loadSections = async () => {
    try {
      const result = await window.api.getSections()
      setSections(result?.data || [])
    } catch (err) {
      console.error('Failed to load sections', err)
    }
  }

  const loadSchedule = async (weekId, teachingGroupId) => {
    setLoading(true)
    try {
      if (!weekId) {
        setSessions([])
        return
      }

      const result = await window.api.getSchedule(user?.id, weekId, teachingGroupId)
      setSessions(result?.data || [])
    } catch (err) {
      console.error('Failed to load schedule', err)
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  const loadExamEvents = async (weekId, teachingGroupId) => {
    try {
      const result = await window.api.getExamEvents(weekId, teachingGroupId)
      setExamEvents(result?.data || [])
    } catch (err) {
      console.error('Failed to load exam events', err)
      setExamEvents([])
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

  const handleCreateSession = (studyDayId, hour = 8) => {
    try {
      let targetWeekId = selectedWeek;
      
      if (!targetWeekId) {
        if (weeks.length > 0) {
          targetWeekId = weeks[0].STUDY_WEEK_ID;
          setSelectedWeek(targetWeekId);
        } else {
          setSessionError(tr('Please select a study week first. If no weeks are available, create them in the Academic management page.'));
          return;
        }
      }

      const missingData = [];
      if (scopedMajors.length === 0) missingData.push('Majors');
      if (classrooms.length === 0) missingData.push('Classrooms');
      if (teachers.length === 0) missingData.push('Teachers');
      if (sessionTypes.length === 0) missingData.push('Session Types');

      if (missingData.length > 0) {
        setSessionError(`Cannot schedule: Missing ${missingData.join(', ')}. Please set these up first.`);
        return;
      }

      // NOTE: the group list is deliberately NOT checked here. It is scoped
      // to (major, semester) and loads inside the modal — gating on it here
      // would block opening the modal before it ever loads. If no group
      // studies the default major in this semester, the modal's dropdown
      // says so and offers "+ Create New Group..." instead.
      setIsCreatingNewGroup(false);
      setNewGroupName('');

      // Sessions attach to a study_day of the selected week; each study day is a date.
      // Default to today's day when the week contains it, else the next upcoming day.
      const selectedDayId = studyDayId ?? pickCurrentOrUpcomingDayId(days) ?? '';
      if (!selectedDayId) {
        setSessionError(tr('This week has no study days yet. Please choose a week that covers the day you want to schedule.'));
        return;
      }

      // "Lecture" is the ordinary class, so it is the better starting point
      // than whichever type happens to sort first (Examination).
      const lectureType = sessionTypes.find((type) => String(type.STUDY_SESSION_TYPE_CODE || '').toUpperCase() === 'LEC')

      const newSession = {
        CLASSROOM_ID: classrooms[0]?.CLASSROOM_ID || '',
        STUDY_SESSION_TYPE_ID: (lectureType || sessionTypes[0])?.STUDY_SESSION_TYPE_ID || '',
        STUDY_DAY_ID: selectedDayId,
        STUDY_SESSION_START_TIME: `${(hour || 6).toString().padStart(2, '0')}:00`,
        // A slot clicked at 22:00 or 23:00 runs to midnight, not past it.
        STUDY_SESSION_END_TIME: (hour || 6) + 2 >= 24 ? '00:00' : `${((hour || 6) + 2).toString().padStart(2, '0')}:00`,
        MAJOR_ID: scopedMajors[0]?.MAJOR_ID || '',
        // The modal's group effect picks the first group of the scoped list
        // once it loads (and keeps the pick in sync on major changes).
        TEACHING_GROUP_ID: '',
        INSTRUCTOR_ID: teachers[0]?.PERSON_ID || ''
      };

      setCurrentSession(newSession);
      setNewGroupCategory('');
      setIsCreatingNewGroup(false);
      setSessionError('');
      setShowModal(true);
    } catch (error) {
      console.error('CRITICAL ERROR in handleCreateSession:', error);
      setSessionError('Failed to open session creator: ' + error.message);
    }
  }

  // A session being set up is kept on this computer too: closing the dialog by
  // mistake, a refresh or a lost connection must not cost a filled form. The
  // offer is explicit — nothing is created until the scheduler submits.
  const {
    draft: sessionDraft,
    restore: restoreSessionDraft,
    discard: discardSessionDraft,
    clear: clearSessionDraft
  } = useDraft({
    key: `schedule-session:${selectedWeek || 'none'}`,
    userId: user?.id,
    value: { session: currentSession, isCreatingNewGroup, newGroupName, newGroupCategory },
    enabled: showModal && !!(
      currentSession.MAJOR_ID || currentSession.STUDY_DAY_ID || currentSession.INSTRUCTOR_ID ||
      currentSession.CLASSROOM_ID || currentSession.STUDY_SESSION_TYPE_ID ||
      isCreatingNewGroup || newGroupName
    ),
    reloadOn: showModal,
    onRestore: (value) => {
      if (!value) return
      if (value.session) setCurrentSession(value.session)
      setIsCreatingNewGroup(!!value.isCreatingNewGroup)
      setNewGroupName(String(value.newGroupName || ''))
      setNewGroupCategory(String(value.newGroupCategory || ''))
    }
  })

  const handleSaveSession = async (e) => {
    e.preventDefault()
    setSessionError('')
    const startTime = timeKey(currentSession.STUDY_SESSION_START_TIME)
    const endTime = endTimeKey(startTime, currentSession.STUDY_SESSION_END_TIME)
    if (!startTime || !endTime || startTime >= endTime) {
      setSessionError(tr('The end time must be after the start time.'))
      return
    }

    let sessionToSave = { ...currentSession, STUDY_SESSION_START_TIME: startTime, STUDY_SESSION_END_TIME: endTime };

    // The dropdowns are custom (so each can carry its own search), which means
    // the form no longer validates them for us.
    const incomplete = ['MAJOR_ID', 'STUDY_DAY_ID', 'INSTRUCTOR_ID', 'CLASSROOM_ID', 'STUDY_SESSION_TYPE_ID']
      .some((field) => !sessionToSave[field])
    if (incomplete) {
      setSessionError(tr('Please fill in every field of the session.'))
      return
    }

    // The room must seat every student of the group; the submit button is
    // disabled for this, and the check still holds if the form is submitted
    // another way.
    if (seatOverflow) {
      setSessionError(tr('This classroom has {seats} seats but the group has {students} students. Choose a classroom with enough seats.', seatOverflow))
      return
    }

    // Hard windows and the soft windows the current policy considers are
    // refused by the server too; naming the window here explains the refusal.
    if (constraintBlocked) {
      const conflict = sessionConstraintConflicts.hard[0] || sessionConstraintConflicts.soft[0]
      setSessionError(tr('This instructor declared a constraint that covers this slot: {detail}', {
        detail: constraintRowText(conflict)
      }))
      return
    }

    try {
      // A group must be chosen (or created) before the session can be saved.
      if (!isCreatingNewGroup && !sessionToSave.TEACHING_GROUP_ID) {
        setSessionError(tr('Please select a teaching group (or create a new one) for this major and semester.'))
        return
      }

      // Handle dynamic group creation if needed
      if (isCreatingNewGroup) {
        if (!newGroupName.trim()) {
          setSessionError(tr('Please enter a name for the new teaching group.'));
          return;
        }

        if (!newGroupCategory) {
          setSessionError(tr('Choose the teaching category this group belongs to.'));
          return;
        }

        // The inline dialog collects a single name, so it fills all three label
        // columns with it (the legacy `teaching_group_label` is now a generated
        // alias and rejects direct writes). Leaving a language empty would make
        // a French sheet fall back to English for this group.
        const newGroup = await window.api.createTeachingGroup(user?.id, {
           TEACHING_GROUP_LABEL_EN: newGroupName,
           TEACHING_GROUP_LABEL_AR: newGroupName,
           TEACHING_GROUP_LABEL_FR: newGroupName,
           TEACHING_GROUP_CODE: newGroupName.toUpperCase().replace(/\s+/g, '_').substring(0, 10),
           TEACHING_CATEGORY_ID: Number(newGroupCategory),
           PROMOTION_ID: null, // Promotion is optional for temporary groups
           // Attach the group to the major and semester being scheduled so it
           // counts as a group that studies this major in this semester.
           ...(currentSession.MAJOR_ID && { MAJOR_ID: Number(currentSession.MAJOR_ID) }),
           ...(selectedSemester && { STUDY_SEMESTER_ID: Number(selectedSemester) })
         });

        sessionToSave.TEACHING_GROUP_ID = newGroup.TEACHING_GROUP_ID;

        // Refresh the scoped modal list so the new group is selectable right
        // away, plus the page-level lists.
        if (currentSession.MAJOR_ID && selectedSemester) {
          const refreshedModalGroups = await window.api.getTeachingGroupsByMajor(currentSession.MAJOR_ID, selectedSemester);
          setModalGroups(refreshedModalGroups?.data || []);
        }
        // Keep the GROUP filter dropdown in sync too.
        const refreshedFilterGroups = await window.api.getTeachingGroupsForSemester(selectedSemester, selectedYear);
        setFilterGroups(refreshedFilterGroups?.data || []);
      } else {
        // Before submitting: check the remaining hours for the chosen session type & group.
        try {
          const budget = await window.api.getSessionTypeRemainingHours({
            MAJOR_ID: sessionToSave.MAJOR_ID,
            STUDY_DAY_ID: sessionToSave.STUDY_DAY_ID,
            STUDY_SESSION_TYPE_ID: sessionToSave.STUDY_SESSION_TYPE_ID,
            TEACHING_GROUP_ID: sessionToSave.TEACHING_GROUP_ID
          })
          if (budget?.hasTarget) {
            const duration = getDurationHours(sessionToSave.STUDY_SESSION_START_TIME, sessionToSave.STUDY_SESSION_END_TIME)
            if (duration > budget.remainingHours + 1e-9) {
              const typeName = budget.sessionTypeLabel || tr('this session type')
              const groupName = budget.teachingGroupLabel || tr('this group')
              const target = Math.round(budget.target * 10) / 10
              const used = Math.round(budget.scheduledHours * 10) / 10
              const left = Math.max(0, Math.round(budget.remainingHours * 10) / 10)
              const need = Math.round(duration * 10) / 10

              const usedText = used >= target
                ? `all ${hrsWord(target)} allowed for this type are already used`
                : `${hrsWord(used)} of the ${hrsWord(target)} allowed for this type are already used`

              setSessionError(
                `Sorry, this session can't be scheduled. There isn't enough time left for ${typeName} in the ${groupName} group: ${usedText}, so only ${hrsWord(left)} remain free. ` +
                `This session needs ${hrsWord(need)}, which doesn't fit. ` +
                `You can choose a shorter time slot, or allow more hours for ${typeName} sessions first.`
              )
              return
            }
          }
        } catch (err) {
          console.error('Failed to check remaining hours before save', err)
          // The server-side guard still enforces the budget if this pre-check fails.
        }
      }

      // Create a single session for the teaching group
      await window.api.createSession(user?.id, sessionToSave, constraintChoice)
      // The session exists now: the kept form has nothing left to restore.
      clearSessionDraft()

      setSessionError('')
      setShowModal(false)
      loadSchedule(selectedWeek, selectedGroup)
      
    } catch (err) {
      console.error('Failed to save session', err)
      setSessionError(err?.message || String(err))
    }
  }

  const [confirmTarget, setConfirmTarget] = useState(null)

  const handleDeleteSession = async (sessionId) => {
    try {
      await window.api.deleteSession(user?.id, sessionId)
      loadSchedule(selectedWeek, selectedGroup)

    } catch (err) {
      console.error('Failed to delete session', err)
      setSessionError('Failed to delete session: ' + err.message)
    }
  }



  const modal = showModal && typeof document !== 'undefined' ? createPortal(
    <div
      id="schedule-modal-debug"
      key="schedule-modal"
      style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', zIndex: 2147483647, backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={() => setShowModal(false)}
    >
      <div
        className="w-full max-w-[860px] border border-line-strong bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 items-center justify-between gap-3 border-b border-line bg-surface-muted px-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="kicker shrink-0 text-[9.5px]">{tr('Master timetable')}</span>
            <h4 className="serif truncate text-[17px] leading-none text-ink">{tr('Schedule new session')}</h4>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(false)}
            aria-label={tr('Close')}
            className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
        
        <form onSubmit={handleSaveSession} className="space-y-3 px-4 py-3">
          {sessionDraft && (
            <div className="flex flex-wrap items-center gap-2 rounded-[3px] border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-900">
              <span>
                {tr('Unsaved session details from {when} are saved on this computer.', {
                  when: new Date(sessionDraft.savedAt).toLocaleString()
                })}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={restoreSessionDraft}
                  className="rounded-[3px] border border-amber-400 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100"
                >
                  {tr('Restore')}
                </button>
                <button
                  type="button"
                  onClick={discardSessionDraft}
                  className="rounded-[3px] px-2 py-0.5 underline-offset-2 hover:underline"
                >
                  {tr('Discard')}
                </button>
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 [&>div]:min-w-0">
            <div className="col-span-2">
              <label className="field-label flex items-center gap-1.5">
                <BookOpen size={16} className="text-ink-3" />{' '}{tr("Major / Subject")}</label>
              <SearchSelect
                value={String(currentSession.MAJOR_ID)}
                onChange={(next) => setCurrentSession({ ...currentSession, MAJOR_ID: next })}
                options={scopedMajors.map((major) => ({ value: String(major.MAJOR_ID), label: major.MAJOR_LABEL }))}
                placeholder={tr('Choose a major…')}
                emptyLabel={tr('No major has been set up yet.')}
              />
            </div>

            <div>
              <label className="field-label flex items-center gap-1.5">
                <CalendarIcon size={16} className="text-ink-3" />{' '}{tr("Date")}</label>
              <SearchSelect
                value={String(currentSession.STUDY_DAY_ID || '')}
                onChange={(next) => setCurrentSession({ ...currentSession, STUDY_DAY_ID: parseInt(next, 10) })}
                options={days.map((day) => ({ value: String(day.STUDY_DAY_ID), label: formatDateLabel(day.STUDY_DAY_DATE) }))}
                placeholder={tr('Choose a day…')}
                emptyLabel={tr('No study days available for this week')}
              />
            </div>

            <div>
              <label className="field-label flex items-center gap-1.5">
                <BookOpen size={16} className="text-ink-3" />{' '}{tr("Instructor")}</label>
              <SearchSelect
                value={String(currentSession.INSTRUCTOR_ID)}
                onChange={(next) => setCurrentSession({ ...currentSession, INSTRUCTOR_ID: next })}
                options={modalInstructorOptions.map((t) => {
                  const busy = slotConflicts.instructors.has(String(t.PERSON_ID))
                  const constraintState = constraintStateForInstructor(t.PERSON_ID)
                  const blocked = constraintState.hard || constraintState.soft
                  return {
                    value: String(t.PERSON_ID),
                    label: `${t.PERSON_FIRST_NAME} ${t.PERSON_LAST_NAME}`,
                    disabled: busy || blocked,
                    hint: busy
                      ? tr('already booked at this time')
                      : constraintState.hard
                        ? tr('unavailable')
                        : constraintState.soft
                          ? tr('not recommended')
                          : ''
                  }
                })}
                placeholder={tr('Choose an instructor…')}
                emptyLabel={tr('No teachers assigned to this major')}
              />
            </div>

            <div>
              <label className="field-label flex items-center gap-1.5">
                <MapPin size={16} className="text-ink-3" />{' '}{tr("Classroom")}</label>
              <SearchSelect
                value={String(currentSession.CLASSROOM_ID)}
                onChange={(next) => setCurrentSession({ ...currentSession, CLASSROOM_ID: next })}
                options={classrooms.map((c) => {
                  const busy = slotConflicts.classrooms.has(String(c.CLASSROOM_ID))
                  const seats = classroomSeats(c)
                  const tooSmall = groupStudentCount !== null && seats !== null && groupStudentCount > seats
                  return {
                    value: String(c.CLASSROOM_ID),
                    label: c.CLASSROOM_LABEL,
                    disabled: busy || tooSmall,
                    hint: busy
                      ? tr('already booked at this time')
                      : tooSmall
                        ? tr('too small: {seats} seats for {students} students', { seats, students: groupStudentCount })
                        : ''
                  }
                })}
                placeholder={tr('Choose a classroom…')}
                emptyLabel={tr('No classroom has been set up yet.')}
              />
              {seatOverflow && (
                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--color-danger-ink)' }}>
                  {tr('This classroom has {seats} seats but the group has {students} students. Choose a classroom with enough seats.', seatOverflow)}
                </p>
              )}
            </div>

            <div>
              <label className="field-label flex items-center gap-1.5">
                <BookOpen size={16} className="text-ink-3" />{' '}{tr("Teaching Group")}</label>
              {!isCreatingNewGroup ? (
                <>
                <SearchSelect
                  value={String(currentSession.TEACHING_GROUP_ID)}
                  onChange={(next) => {
                    if (next === 'NEW') {
                      setIsCreatingNewGroup(true)
                      setNewGroupCategory((prev) => prev || String(groupCategoryOptions[0]?.TEACHING_CATEGORY_ID || ''))
                    } else {
                      setCurrentSession({ ...currentSession, TEACHING_GROUP_ID: next })
                    }
                  }}
                  options={[
                    ...modalGroupOptions.map((g) => ({ value: String(g.TEACHING_GROUP_ID), label: g.TEACHING_GROUP_LABEL })),
                    { value: 'NEW', label: tr('+ Create New Group...') }
                  ]}
                  placeholder={tr('Choose a teaching group…')}
                  emptyLabel={modalGroupsLoading
                    ? tr('Loading groups…')
                    : modalGroups.length === 0
                      ? tr('No groups study this major in this semester yet')
                      : tr('Every class of this major is already booked at this time')}
                />
                {groupStudentCount !== null && (
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
                    {groupStudentCount === 1
                      ? tr('1 student in this group')
                      : tr('{count} students in this group', { count: groupStudentCount })}
                  </p>
                )}
                {bookedGroupsAtSlot > 0 && (
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
                    {bookedGroupsAtSlot} {tr('already booked at this time')}
                  </p>
                )}
                </>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex space-x-2">
                    <input 
                      type="text"
                      placeholder={tr("New Group Name")}
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="field min-w-0 flex-1"
                      required={isCreatingNewGroup}
                      autoFocus
                    />
                    {modalGroupOptions.length > 0 && (
                      <button 
                        type="button"
                        onClick={() => setIsCreatingNewGroup(false)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-[4px] border border-line-strong bg-surface text-ink-3 hover:bg-surface-muted hover:text-ink"
                        title={tr('Back to list')}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <SearchSelect
                    value={String(newGroupCategory)}
                    onChange={(next) => setNewGroupCategory(next)}
                    options={groupCategoryOptions.map((category) => ({
                      value: String(category.TEACHING_CATEGORY_ID),
                      label: category.TEACHING_CATEGORY_LABEL
                    }))}
                    placeholder={tr('Teaching category')}
                    emptyLabel={tr('No teaching category has been set up yet.')}
                  />
                </div>
              )}
            </div>

            <div>
              <label className="field-label flex items-center gap-1.5">
                <Clock size={16} className="text-ink-3" />{' '}{tr("Session Type")}</label>
              <SearchSelect
                value={String(currentSession.STUDY_SESSION_TYPE_ID)}
                onChange={(next) => setCurrentSession({ ...currentSession, STUDY_SESSION_TYPE_ID: next })}
                options={sessionTypes.map((st) => ({ value: String(st.STUDY_SESSION_TYPE_ID), label: sessionTypeLabel(st) }))}
                placeholder={tr('Choose a session type…')}
                emptyLabel={tr('No session type has been set up yet.')}
              />
            </div>

            {timeSlots.length > 0 && (
              <div className="col-span-2">
                <label className="field-label flex items-center gap-1.5">
                  <Clock size={16} className="text-ink-3" />{' '}{tr("Predefined Time Slot")}</label>
                <SearchSelect
                  value={activeTimeSlotId}
                  onChange={(next) => {
                    const slot = timeSlots.find((item) => String(item.STUDY_SESSION_TIME_SLOT_ID) === next)
                    if (!slot) return
                    setCurrentSession({
                      ...currentSession,
                      STUDY_SESSION_START_TIME: timeKey(slot.STUDY_SESSION_TIME_SLOT_START_TIME),
                      STUDY_SESSION_END_TIME: timeKey(slot.STUDY_SESSION_TIME_SLOT_END_TIME)
                    })
                  }}
                  options={timeSlots.map((slot) => ({
                    value: String(slot.STUDY_SESSION_TIME_SLOT_ID),
                    label: `${timeKey(slot.STUDY_SESSION_TIME_SLOT_START_TIME)} – ${timeKey(slot.STUDY_SESSION_TIME_SLOT_END_TIME)}`
                  }))}
                  placeholder={tr('Choose a slot, or set the times below…')}
                  emptyLabel={tr('No predefined slot yet')}
                />
              </div>
            )}

            <div>
              <label className="field-label flex items-center gap-1.5">
                <Clock size={16} className="text-ink-3" />{' '}{tr("Start Time")}</label>
              <input 
                type="time"
                min="06:00"
                value={currentSession.STUDY_SESSION_START_TIME}
                onChange={(e) => setCurrentSession({...currentSession, STUDY_SESSION_START_TIME: e.target.value})}
                className="field"
                required
              />
            </div>

            <div>
              <label className="field-label flex items-center gap-1.5">
                <Clock size={16} className="text-ink-3" />{' '}{tr("End Time")}</label>
              <input 
                type="time"
                value={currentSession.STUDY_SESSION_END_TIME}
                onChange={(e) => setCurrentSession({...currentSession, STUDY_SESSION_END_TIME: e.target.value})}
                className="field"
                required
              />
            </div>
          </div>

          {constraintSettings.enabled && (
            (sessionConstraintConflicts.hard.length > 0
              || sessionConstraintConflicts.soft.length > 0
              || sessionConstraintConflicts.ignoredSoft.length > 0) && (
              <div className="space-y-1">
                {sessionConstraintConflicts.hard.length > 0 && (
                  <div
                    className="flex items-start gap-2 border px-2.5 py-2 text-[11.5px] leading-relaxed"
                    style={{ background: 'var(--color-danger-bg)', borderColor: 'var(--color-danger)', color: 'var(--color-danger-ink)' }}
                  >
                    <ShieldAlert size={13} className="mt-px shrink-0" />
                    <span>
                      <strong className="font-semibold">{tr('Hard constraint: this instructor is unavailable.')}</strong>{' '}
                      {sessionConstraintConflicts.hard.map(constraintRowText).join('; ')}
                    </span>
                  </div>
                )}
                {sessionConstraintConflicts.soft.length > 0 && (
                  <div className="flex items-start gap-2 border border-warning/40 bg-warning-bg px-2.5 py-2 text-[11.5px] leading-relaxed text-warning-ink">
                    <ShieldAlert size={13} className="mt-px shrink-0" />
                    <span>
                      <strong className="font-semibold">{tr('Soft constraint in force: this slot is not recommended.')}</strong>{' '}
                      {sessionConstraintConflicts.soft.map(constraintRowText).join('; ')}
                    </span>
                  </div>
                )}
                {sessionConstraintConflicts.ignoredSoft.length > 0 && (
                  <div className="flex items-start gap-2 border border-line bg-surface-muted px-2.5 py-2 text-[11px] leading-relaxed text-ink-3">
                    <ShieldAlert size={13} className="mt-px shrink-0" />
                    <span>
                      {tr('The current policy ignores these soft constraints:')}{' '}
                      {sessionConstraintConflicts.ignoredSoft.map(constraintRowText).join('; ')}
                    </span>
                  </div>
                )}
              </div>
            )
          )}

          {sessionError && (
            <div
              className="flex items-start gap-2 border px-2.5 py-2 text-[11.5px] leading-relaxed"
              style={{ background: 'var(--color-danger-bg)', borderColor: 'var(--color-danger)', color: 'var(--color-danger-ink)' }}
            >
              <AlertCircle size={13} className="mt-px shrink-0" />
              <span>{sessionError}</span>
            </div>
          )}

          <div className="flex justify-end gap-1.5 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setShowModal(false)}
              className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted"
            >{tr('Cancel')}</button>
            <button
              type="submit"
              disabled={!!seatOverflow || constraintBlocked}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
              style={{ color: 'var(--color-on-jade)' }}
            >
              <Check size={13} strokeWidth={2.2} />
              <span>{tr('Create session')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.documentElement
  ) : null
  const sessionDetailsModal = showSessionDetailsModal && selectedSessionForView ? (
    <SessionDetailsModal
      session={selectedSessionForView}
      onClose={() => { setShowSessionDetailsModal(false); setSelectedSessionForView(null) }}
    />
  ) : null


  // Session-type colours are a categorical scale, so the hues have to be far
  // apart: the greens and teals of the app's intent palette sat next to each
  // other in the legend and could not be told apart.
  const typeTone = (code) => {
    const tones = {
      LEC: '#5aa9f0', // azure
      PRC: '#3ba97d', // jade
      SEM: '#e0a458', // amber
      EXM: '#e2674a' // ember
    }
    const key = String(code || '').toUpperCase()
    if (tones[key]) return tones[key]
    const palette = ['#a78bfa', '#e07a9e', '#b3c95c']
    let hash = 0
    const label = String(code || '')
    for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
    return palette[hash % palette.length]
  }

  const weekIndex = weeks.findIndex((week) => String(week.STUDY_WEEK_ID) === String(selectedWeek))
  const weekHours = sessions.reduce(
    (total, session) => total + Math.max(0, getDurationHours(session.STUDY_SESSION_START_TIME, session.STUDY_SESSION_END_TIME)),
    0
  )
  const selectedTone = selectedSessionForView ? typeTone(selectedSessionForView.STUDY_SESSION_TYPE_CODE) : null
  const overlappingSessions = selectedSessionForView
    ? sessions.filter((session) => {
        if (String(session.STUDY_SESSION_ID) === String(selectedSessionForView.STUDY_SESSION_ID)) return false
        if (String(session.STUDY_DAY_ID) !== String(selectedSessionForView.STUDY_DAY_ID)) return false
        const start = timeKey(session.STUDY_SESSION_START_TIME)
        const end = endTimeKey(start, session.STUDY_SESSION_END_TIME)
        const selectedStart = timeKey(selectedSessionForView.STUDY_SESSION_START_TIME)
        const selectedEnd = endTimeKey(selectedStart, selectedSessionForView.STUDY_SESSION_END_TIME)
        return overlaps(start, end, selectedStart, selectedEnd)
      })
    : []

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={tr('Master timetable')}
        title={tr('Weekly schedule')}
        meta={selectedWeek ? `${days.length} ${tr('days')} · ${sessions.length} ${tr('sessions')}` : ''}
        actions={
          <>
            <div className="hidden items-center gap-1.5 md:flex">
              <select
                aria-label={tr('Academic year')}
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="field h-8 w-auto max-w-[138px] text-[11.5px]"
              >
                {years.map((year) => (
                  <option key={year.STUDY_YEAR_ID} value={year.STUDY_YEAR_ID}>{year.STUDY_YEAR_LABEL}</option>
                ))}
              </select>
              <select
                aria-label={tr('Semester')}
                value={selectedSemester}
                onChange={(event) => setSelectedSemester(event.target.value)}
                disabled={!selectedYear}
                className="field h-8 w-auto max-w-[132px] text-[11.5px]"
              >
                {semesters.map((semester) => (
                  <option key={semester.STUDY_SEMESTER_ID} value={semester.STUDY_SEMESTER_ID}>{semester.STUDY_SEMESTER_LABEL}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); setShowVolumePanel(true) }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted"
            >
              <Clock size={12} /> {tr('Volume')}
            </button>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); handleCreateSession() }}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11.5px] font-semibold text-on-jade hover:brightness-110"
              style={{ color: 'var(--color-on-jade)' }}
            >
              <Plus size={12} strokeWidth={2.2} /> {tr('Session')}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-0.5 rounded-[4px] border border-line bg-surface p-0.5">
          <button
            type="button"
            disabled={weekIndex < 0 || weekIndex >= weeks.length - 1}
            onClick={() => setSelectedWeek(weeks[weekIndex + 1]?.STUDY_WEEK_ID)}
            aria-label={tr('Next week')}
            className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink disabled:opacity-30"
          >
            <ChevronLeft size={12} />
          </button>
          <select
            aria-label={tr('Study week')}
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
            className="h-6 max-w-[330px] border-0 bg-transparent px-1 text-[11px] text-ink outline-none"
          >
            {weeks.map((week) => (
              <option key={week.STUDY_WEEK_ID} value={week.STUDY_WEEK_ID}>
                {week.STUDY_WEEK_LABEL} · {formatDateLabel(week.STUDY_WEEK_START_DATE)} → {formatDateLabel(week.STUDY_WEEK_END_DATE)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={weekIndex <= 0}
            onClick={() => setSelectedWeek(weeks[weekIndex - 1]?.STUDY_WEEK_ID)}
            aria-label={tr('Previous week')}
            className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink disabled:opacity-30"
          >
            <ChevronRight size={12} />
          </button>
        </div>

        {/* The group list can run long in a faculty with many cohorts, so it
            carries the same search box as the session dialog's dropdowns. */}
        <SearchSelect
          value={selectedGroup}
          onChange={(next) => setSelectedGroup(next)}
          options={[
            { value: '', label: tr('All groups') },
            ...filterGroups.filter(inScopeGroup).map((group) => ({
              value: String(group.TEACHING_GROUP_ID),
              label: group.TEACHING_GROUP_LABEL
            }))
          ]}
          disabled={filterGroups.length === 0}
          emptyLabel={tr('No group for this semester')}
          className="w-[170px] shrink-0"
        />

        <span className="mono text-[10px] text-ink-3">
          {weekHours ? `${fmtHrs(weekHours)} ${tr('hours')}` : ''}
        </span>

        <div className="ms-auto flex flex-wrap items-center gap-2.5">
          {sessionTypes.filter((type) => String(type.STUDY_SESSION_TYPE_CODE).toUpperCase() !== 'EXM').map((type) => (
            <span key={type.STUDY_SESSION_TYPE_ID} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-3">
              <span className="h-[3px] w-5" style={{ background: typeTone(type.STUDY_SESSION_TYPE_CODE) }} />
              {sessionTypeLabel(type)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-3">
            <span className="h-[3px] w-5" style={{ background: 'var(--color-danger)' }} />
            {sessionTypeLabel(sessionTypes.find((type) => String(type.STUDY_SESSION_TYPE_CODE).toUpperCase() === 'EXM')) || tr('Examination')}
          </span>
        </div>
      </div>

      {constraintSettings.enabled && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[4px] border border-line bg-surface px-2.5 py-1.5">
          <ShieldAlert size={12} className="text-ink-3" aria-hidden="true" />
          <span className="text-[11px] font-medium text-ink">{tr('Teacher constraints')}</span>
          <span className="mono text-[10px] text-ink-3">
            {hardConstraintsOfWeek.length} {tr('hard')} · {softConstraintsOfWeek.length} {tr('soft')}
          </span>

          {constraintSettings.forced ? (
            <span className="mono text-[10px] text-ink-3">
              {tr('Policy set by the administrator:')}{' '}
              <span className="text-ink-2">{tr(constraintPolicyLabel(constraintSettings.policy))}</span>
            </span>
          ) : (
            <div
              role="radiogroup"
              aria-label={tr('Teacher constraint policy')}
              className="flex items-center gap-0.5 rounded-[4px] border border-line bg-surface p-0.5"
            >
              {CONSTRAINT_POLICIES.map((policy) => {
                const active = effectiveConstraintPolicy === policy.id
                return (
                  <button
                    key={policy.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setConstraintPolicy(policy.id)}
                    className={`inline-flex h-6 items-center rounded-[3px] px-2 text-[10.5px] ${
                      active
                        ? 'bg-selection font-medium text-ink'
                        : 'text-ink-3 hover:bg-surface-muted hover:text-ink'
                    }`}
                  >
                    {tr(policy.label)}
                  </button>
                )
              })}
            </div>
          )}

          {effectiveConstraintPolicy === 'some' && (
            <button
              type="button"
              onClick={() => setShowSoftPicker(true)}
              disabled={softConstraintsOfWeek.length === 0}
              className="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tr('Choose soft constraints')}
              <span className="mono text-[9.5px] text-ink-3">
                {selectedSoftCount}/{softConstraintsOfWeek.length}
              </span>
            </button>
          )}

          <span className="ms-auto text-[10px] text-ink-3">
            {tr('Hard constraints always apply; soft ones follow the policy above.')}
          </span>
        </div>
      )}

      {days.length === 0 && !loading && (
        <div className="rounded-[4px] border border-line bg-warning-bg px-3 py-2 text-[11px] text-warning-ink">
          {tr('This week has no study days. Sessions attach to the concrete days of a study week.')}
        </div>
      )}

      <div className="flex" style={{ height: 'calc(100vh - 270px)', minHeight: 430 }}>
      <SplitPane
        storageKey="enote-schedule-split"
        initial={320}
        min={300}
        max={520}
        asideLabel={tr('Session details')}
        aside={
          selectedSessionForView ? (
            <>
              <div className="flex h-[64px] shrink-0 items-center gap-2 border-b border-line px-3.5">
                <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: selectedTone }} aria-hidden="true" />
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-medium text-ink">
                    {selectedSessionForView.MAJOR_LABEL || selectedSessionForView.EXAMINATION_LABEL || tr('Session')}
                  </div>
                  <div className="mono mt-0.5 text-[10px] text-ink-3">
                    {selectedSessionForView.EXAMINATION_ID
                      ? tr('Examination')
                      : selectedSessionForView.STUDY_SESSION_TYPE_LABEL ? sessionTypeLabel(selectedSessionForView) : tr('Study session')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSessionForView(null)}
                  aria-label={tr('Close session detail')}
                  className="ms-auto grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                >
                  <X size={14} strokeWidth={1.8} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <dl className="px-3.5 py-1">
                  {[
                    [tr('Day'), selectedSessionForView.STUDY_DAY_DATE ? formatDateLabel(selectedSessionForView.STUDY_DAY_DATE) : '—'],
                    [tr('Time'), selectedSessionForView.EXAMINATION_START_DATETIME
                      ? `${formatTime(new Date(selectedSessionForView.EXAMINATION_START_DATETIME), { hour: '2-digit', minute: '2-digit' })} → ${formatTime(new Date(selectedSessionForView.EXAMINATION_END_DATETIME), { hour: '2-digit', minute: '2-digit' })}`
                      : `${String(selectedSessionForView.STUDY_SESSION_START_TIME || '').slice(0, 5)} → ${String(selectedSessionForView.STUDY_SESSION_END_TIME || '').slice(0, 5)}`],
                    [tr('Room'), selectedSessionForView.CLASSROOM_LABEL || '—'],
                    [tr('Group'), selectedSessionForView.TEACHING_GROUP_LABEL || '—'],
                    [tr('Instructor'), selectedSessionForView.INSTRUCTOR_NAME || '—']
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-[7px] last:border-0">
                      <dt className="shrink-0 text-[11px] text-ink-3">{label}</dt>
                      <dd className="truncate text-end text-[12px] text-ink-2">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="kicker border-y border-line bg-surface-muted px-3.5 py-1.5">{tr('Room & staff load')}</div>
                <div className="px-3.5 py-2.5 text-[11.5px] text-ink-2">
                  <p>{tr('{count} sessions share this week in the selected group.', { count: sessions.length })}</p>
                  {overlappingSessions.length > 0 ? (
                    <p className="mt-1.5 inline-flex items-center gap-1.5" style={{ color: 'var(--color-warning-ink)' }}>
                      <AlertCircle size={11} /> {tr('Overlaps {count} other sessions.', { count: overlappingSessions.length })}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-ink-3">{tr('No overlap with another session on this day.')}</p>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-line bg-surface-muted p-2">
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowSessionDetailsModal(true)}
                    className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted"
                  >
                    <FileText size={12} /> {tr('Full details')}
                  </button>
                  {!selectedSessionForView.EXAMINATION_ID && (
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(selectedSessionForView.STUDY_SESSION_ID)}
                      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-danger-ink hover:bg-danger-bg"
                    >
                      <X size={12} /> {tr('Delete')}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-3.5">
                <span className="kicker">{tr('Week at a glance')}</span>
                <span className="mono text-[10px] text-ink-3">{selectedWeek ? tr('SELECTED') : '—'}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line">
                  {[
                    [tr('Days'), days.length],
                    [tr('Sessions'), sessions.length],
                    [tr('Contact hours'), weekHours ? fmtHrs(weekHours) : '0'],
                    [tr('Groups'), filterGroups.length]
                  ].map(([label, value]) => (
                    <div key={label} className="bg-surface px-2.5 py-2">
                      <div className="kicker text-[9px]">{label}</div>
                      <div className="serif mt-1 text-[22px] leading-none text-ink">{value}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
                  {tr('Select a block to read it here, or click an empty hour to schedule a new session. The seam can be dragged.')}
                </p>
                <div className="mt-3 border-t border-line pt-2">
                  <div className="kicker mb-1.5 text-[9px]">{tr('Legend')}</div>
                  <div className="space-y-1.5">
                    {sessionTypes.filter((type) => String(type.STUDY_SESSION_TYPE_CODE).toUpperCase() !== 'EXM').map((type) => (
                      <div key={type.STUDY_SESSION_TYPE_ID} className="flex items-center gap-2 text-[11px] text-ink-2">
                        <span className="h-[4px] w-7 rounded-full" style={{ background: typeTone(type.STUDY_SESSION_TYPE_CODE) }} />
                        {sessionTypeLabel(type)}
                      </div>
                    ))}
                    <div className="flex items-center gap-2 text-[11px] text-ink-2">
                      <span className="h-[4px] w-7 rounded-full" style={{ background: typeTone('EXM') }} />
                      {sessionTypeLabel(sessionTypes.find((type) => String(type.STUDY_SESSION_TYPE_CODE).toUpperCase() === 'EXM')) || tr('Examination')}
                    </div>
                  </div>
                </div>

                {constraintSettings.enabled && (
                  <div className="mt-3 border-t border-line pt-2">
                    <div className="kicker mb-1.5 flex items-center gap-1.5 text-[9px]">
                      <ShieldAlert size={10} /> {tr('Teacher constraints')}
                    </div>
                    {weekConstraints.length === 0 ? (
                      <p className="text-[11px] text-ink-3">{tr('No teacher constraints for this week.')}</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {weekConstraints.map((row) => {
                          const hard = String(row.CONSTRAINT_KIND).toUpperCase() === 'HARD'
                          return (
                            <li key={row.TEACHER_CONSTRAINT_ID} className="flex items-start gap-1.5">
                              <span
                                className="mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full"
                                style={{ background: hard ? 'var(--color-danger)' : 'var(--color-warning)' }}
                                aria-hidden="true"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] text-ink">
                                  {row.INSTRUCTOR_NAME || tr('Teacher')}
                                </span>
                                <span className="mono block truncate text-[9.5px] text-ink-3">
                                  {row.STUDY_DAY_DATE ? formatDayShort(row.STUDY_DAY_DATE) : '—'} · {String(row.CONSTRAINT_START_TIME || '').slice(0, 5)}–{String(row.CONSTRAINT_END_TIME || '').slice(0, 5)} · {hard ? tr('Unavailable') : tr('Not recommended')}
                                </span>
                                {row.CONSTRAINT_NOTE && (
                                  <span className="block truncate text-[9.5px] text-ink-3">{row.CONSTRAINT_NOTE}</span>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </>
          )
        }
      >
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line bg-surface">
          <div style={{ minWidth: `${58 + days.length * 132}px` }}>
            <div
              className="sticky top-0 z-20 grid border-b border-line bg-surface-muted"
              style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(132px, 1fr))` }}
            >
              <div className="sticky start-0 z-10 border-e border-line bg-surface-muted px-2 py-1.5 text-[9.5px] uppercase tracking-[0.07em] text-ink-3">
                {tr('Time')}
              </div>
              {days.map((day) => {
                const isToday = new Date(day.STUDY_DAY_DATE).toDateString() === new Date().toDateString()
                return (
                  <div key={day.STUDY_DAY_ID} className="border-e border-line px-2 py-1.5 last:border-e-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-[10.5px] font-semibold uppercase tracking-[0.05em] ${isToday ? 'text-jade-600' : 'text-ink-2'}`}>
                        {weekdayName(day.STUDY_DAY_DATE)}
                      </span>
                      <span className="mono text-[9.5px] text-ink-3">{formatDayShort(day.STUDY_DAY_DATE)}</span>
                      {isToday && <span className="ms-auto h-[4px] w-[4px] rounded-full" style={{ background: 'var(--color-jade-500)' }} />}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="grid"              style={{ gridTemplateColumns: `58px repeat(${days.length}, minmax(116px, 1fr))` }}
            >
              <div className="sticky start-0 z-10 border-e border-line bg-surface">
                {HOURS.map((hour) => (
                  <div key={hour} style={{ height: 68 }} className="border-b border-line px-1.5 pt-1 text-end last:border-b-0">
                    <span className="mono text-[9.5px] text-ink-3">{String(hour).padStart(2, '0')}:00</span>
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const daySessions = sessions.filter((session) => String(session.STUDY_DAY_ID) === String(day.STUDY_DAY_ID))
                const dayStart = new Date(day.STUDY_DAY_DATE)
                dayStart.setHours(0, 0, 0, 0)
                const dayEnd = new Date(day.STUDY_DAY_DATE)
                dayEnd.setHours(23, 59, 59, 999)
                const dayExams = examEvents.filter((event) => {
                  const start = new Date(event.EXAMINATION_START_DATETIME)
                  const end = new Date(event.EXAMINATION_END_DATETIME)
                  return start <= dayEnd && end >= dayStart
                })
                return (
                  <div key={day.STUDY_DAY_ID} style={{ height: HOURS.length * 68 }} className="relative border-e border-line last:border-e-0">
                    {HOURS.map((hour) => (
                      <div
                        key={hour}
                        style={{ height: 68 }}
                        onClick={(event) => { event.stopPropagation(); handleCreateSession(day.STUDY_DAY_ID, hour) }}
                        className="group border-b border-line last:border-b-0 hover:bg-surface-muted"
                        title={tr('Schedule a session at {hour}:00', { hour: String(hour).padStart(2, '0') })}
                      >
                        <span className="ms-1 mt-1 hidden h-4 w-4 place-items-center rounded-[2px] border border-line-strong text-ink-3 group-hover:grid">
                          <Plus size={9} strokeWidth={2.2} />
                        </span>
                      </div>
                    ))}

                    {daySessions.map((session) => {
                      const [startH, startM] = (session.STUDY_SESSION_START_TIME || '08:00').split(':').map(Number)
                      const [rawEndH, endM] = (session.STUDY_SESSION_END_TIME || '10:00').split(':').map(Number)
                      const startHourOfTimetable = HOURS[0] || 6
                      // An end before the grid start is after midnight (24:00).
                      const endH = rawEndH < startHourOfTimetable ? rawEndH + 24 : rawEndH
                      const startMin = Math.max(0, (startH - startHourOfTimetable) * 60 + startM)
                      const endMin = Math.min(HOURS.length * 60, (endH - startHourOfTimetable) * 60 + endM)
                      const topPx = (startMin / 60) * 68
                      const heightPx = Math.max(26, ((endMin - startMin) / 60) * 68)
                      const tone = typeTone(session.STUDY_SESSION_TYPE_CODE)
                      const active = String(selectedSessionForView?.STUDY_SESSION_ID) === String(session.STUDY_SESSION_ID)
                      return (
                        <button
                          key={session.STUDY_SESSION_ID}
                          type="button"
                          onClick={(event) => { event.stopPropagation(); setSelectedSessionForView(session) }}
                          onDoubleClick={() => { setSelectedSessionForView(session); setShowSessionDetailsModal(true) }}
                          style={{
                            position: 'absolute',
                            top: topPx,
                            height: heightPx - 2,
                            insetInline: 3,
                            zIndex: 10,
                            background: `color-mix(in srgb, ${tone} 13%, var(--color-surface))`,
                            borderInlineStart: `2px solid ${tone}`,
                            boxShadow: active ? `inset 0 0 0 1px ${tone}` : 'none'
                          }}
                          className="overflow-hidden rounded-[2px] p-1 text-start hover:brightness-110"
                          title={`${sessionTypeLabel(session)} — ${session.MAJOR_LABEL || ''}`}
                        >
                          <div className="mono text-[9px] leading-none text-ink-2">
                            {String(session.STUDY_SESSION_START_TIME || '').slice(0, 5)}–{String(session.STUDY_SESSION_END_TIME || '').slice(0, 5)}
                          </div>
                          <div className="mt-1 truncate text-[11px] font-medium leading-[13px] text-ink">{session.MAJOR_LABEL}</div>
                          {heightPx > 52 && (
                            <div className="mt-0.5 truncate text-[9.5px] leading-[12px] text-ink-3">
                              {session.CLASSROOM_LABEL}{session.TEACHING_GROUP_LABEL ? ` · ${session.TEACHING_GROUP_LABEL}` : ''}
                            </div>
                          )}
                          {heightPx > 78 && session.INSTRUCTOR_NAME && (
                            <div className="truncate text-[9.5px] leading-[12px] text-ink-3">{session.INSTRUCTOR_NAME}</div>
                          )}
                        </button>
                      )
                    })}

                    {dayExams.map((event) => {
                      const clampedStart = new Date(Math.max(new Date(event.EXAMINATION_START_DATETIME), dayStart))
                      const clampedEnd = new Date(Math.min(new Date(event.EXAMINATION_END_DATETIME), dayEnd))
                      const startMin = Math.max(0, (clampedStart.getHours() - (HOURS[0] || 8)) * 60 + clampedStart.getMinutes())
                      const endMin = Math.min(HOURS.length * 60, (clampedEnd.getHours() - (HOURS[0] || 8)) * 60 + clampedEnd.getMinutes())
                      const topPx = (startMin / 60) * 68
                      const heightPx = Math.max(26, ((endMin - startMin) / 60) * 68)
                      return (
                        <button
                          key={`exam-${event.EXAMINATION_ID}-${event.CLASSROOM_ID}`}
                          type="button"
                          onClick={(clickEvent) => { clickEvent.stopPropagation(); setSelectedSessionForView(event) }}
                          onDoubleClick={() => { setSelectedSessionForView(event); setShowSessionDetailsModal(true) }}
                          style={{
                            position: 'absolute',
                            top: topPx,
                            height: heightPx - 2,
                            insetInline: 3,
                            zIndex: 15,
                            background: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-surface))',
                            borderInlineStart: '2px solid var(--color-danger)'
                          }}
                          className="overflow-hidden rounded-[2px] p-1 text-start hover:brightness-110"
                          title={`${event.EXAMINATION_LABEL || event.EXAMINATION_CODE || ''} — ${event.CLASSROOM_LABEL || ''}`}
                        >
                          <div className="mono text-[9px] leading-none" style={{ color: 'var(--color-danger-ink)' }}>
                            {tr('EXAM')} · {String(clampedStart.getHours()).padStart(2, '0')}:{String(clampedStart.getMinutes()).padStart(2, '0')}
                          </div>
                          <div className="mt-1 truncate text-[11px] font-medium leading-[13px] text-ink">
                            {event.EXAMINATION_LABEL || event.EXAMINATION_CODE || ''}
                          </div>
                          <div className="mt-0.5 truncate text-[9.5px] text-ink-3">
                            {event.CLASSROOM_LABEL || tr('No room')}{Number(event.GROUP_COUNT) > 1 ? ` · ${event.GROUP_COUNT}` : ''}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </SplitPane>
      </div>

      <ScheduleVolumePanel
        open={showVolumePanel}
        onClose={() => setShowVolumePanel(false)}
        majors={scopedMajors}
        semesterId={selectedSemester}
        semesterLabel={semesters.find((semester) => String(semester.STUDY_SEMESTER_ID) === String(selectedSemester))?.STUDY_SEMESTER_LABEL || ''}
      />

      {/* Which soft windows the "some" policy should honour. Hard windows are
          not listed: they are binding under every policy. */}
      <Modal
        open={showSoftPicker}
        onClose={() => setShowSoftPicker(false)}
        title={tr('Choose soft constraints')}
        maxWidth="max-w-[560px]"
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowSoftPicker(false)}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Done')}
            </button>
          </div>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-2">
          {tr('Only the ticked soft constraints are enforced under the current policy. Hard constraints are always enforced.')}
        </p>

        {softConstraintsOfWeek.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedSoftConstraintIds(
                softConstraintsOfWeek.map((row) => Number(row.TEACHER_CONSTRAINT_ID))
              )}
              className="inline-flex h-6 items-center rounded-[4px] border border-line-strong bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Select all')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedSoftConstraintIds([])}
              className="inline-flex h-6 items-center rounded-[4px] border border-line-strong bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Clear')}
            </button>
            <span className="mono ms-auto text-[10px] text-ink-3">
              {selectedSoftCount}/{softConstraintsOfWeek.length} {tr('selected')}
            </span>
          </div>
        )}

        {softConstraintsOfWeek.length === 0 ? (
          <p className="mt-3 text-[11.5px] text-ink-3">{tr('No teacher declared a soft constraint for this week.')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-[4px] border border-line">
            {softConstraintsOfWeek.map((row) => {
              const picked = (Array.isArray(selectedSoftConstraintIds) ? selectedSoftConstraintIds : [])
                .map(Number)
                .includes(Number(row.TEACHER_CONSTRAINT_ID))
              return (
                <li key={row.TEACHER_CONSTRAINT_ID}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={picked}
                    onClick={() => toggleSoftConstraint(row)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-start hover:bg-surface-muted"
                  >
                    <span
                      className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border"
                      style={{
                        borderColor: picked ? 'var(--color-jade-600)' : 'var(--color-line-strong)',
                        background: picked ? 'var(--color-jade-solid)' : 'transparent',
                        color: 'var(--color-on-jade)'
                      }}
                      aria-hidden="true"
                    >
                      {picked && <Check size={10} strokeWidth={2.4} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium text-ink">
                        {row.INSTRUCTOR_NAME || tr('Teacher')}
                      </span>
                      <span className="mono block truncate text-[10px] text-ink-3">
                        {row.STUDY_DAY_DATE ? formatDateLabel(row.STUDY_DAY_DATE) : '—'} · {String(row.CONSTRAINT_START_TIME || '').slice(0, 5)}–{String(row.CONSTRAINT_END_TIME || '').slice(0, 5)}
                      </span>
                      {row.CONSTRAINT_NOTE && (
                        <span className="block truncate text-[10px] text-ink-3">{row.CONSTRAINT_NOTE}</span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>

      {modal}
      {sessionDetailsModal}
      <ConfirmDialog
        open={!!confirmTarget}
        title={tr("Delete Session")}
        message={tr('Are you sure you want to delete this session?')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => { const id = confirmTarget; setConfirmTarget(null); handleDeleteSession(id) }}
      />
    </div>
  )
}

export default Schedule
