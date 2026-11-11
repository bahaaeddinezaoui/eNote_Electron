import React, { useState, useEffect, useMemo, useRef } from 'react'
import { formatDate, formatDateTime as formatDateTimeValue, formatTime as formatTimeValue } from '../dateFormat'
import { dateLocale } from '../scheduleUtils'
import {
  Search,
  UserX,
  Notebook,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  UserRound,
  BookOpen,
  History,
  Gavel,
  Award,
  Filter,
  BarChart3,
  X
} from 'lucide-react'
import { formatDateLong } from '../scheduleUtils'
import { PageIntro } from './ui/PageHeader'
import Modal from './ui/Modal'
import PhotoZoom from './ui/PhotoZoom'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import { localizedLabel, tr } from '../i18n'
import { usePersonPhotos } from '../personPhotos'
import { TrendChart, DonutChart, VBarChart } from './historyCharts'

const formatTime = (value) => {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (isNaN(d.getTime())) return String(value)
  return formatTimeValue(d, { hour: '2-digit', minute: '2-digit' })
}

const formatDateTime = (value) => {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (isNaN(d.getTime())) return String(value)
  return formatDateTimeValue(d, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

const StudentHistory = ({ user }) => {
  // Student selection
  const [students, setStudents] = useState([])
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  // Picker filters: narrow the student list itself, separately from the record
  // filters that narrow a chosen student's history.
  const [studentSex, setStudentSex] = useState('all')
  const [studentSection, setStudentSection] = useState('all')
  const [studentCategory, setStudentCategory] = useState('all')
  const [studentPlacement, setStudentPlacement] = useState('all')
  // The student picker is a search box with a result list, not a select: the
  // roster is long and typing two letters is faster than scrolling it.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerIndex, setPickerIndex] = useState(0)
  const pickerRef = useRef(null)

  // History data
  const [absences, setAbsences] = useState([])
  const [observations, setObservations] = useState([])
  const [punishments, setPunishments] = useState([])
  const [rewards, setRewards] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Filters
  const [recordType, setRecordType] = useState('all') // all | absences | observations
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [justificationFilter, setJustificationFilter] = useState('all')
  const [motifFilter, setMotifFilter] = useState('all')
  const [majorFilter, setMajorFilter] = useState('all')
  const [teacherFilter, setTeacherFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedRows, setExpandedRows] = useState({})
  // Filters are one dialog opened from the carousel toolbar, not a panel of
  // their own, so the record itself keeps the page height.
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Six records per page: the timeline stays a panel instead of a long scroll.
  const [timelinePage, setTimelinePage] = useState(0)

  const [loadingStudents, setLoadingStudents] = useState(true)

  // Which panel of the dossier is open: overview, analytics or timeline.
  const [slide, setSlide] = useState(0)

  useEffect(() => {
    loadStudents()
  }, [user?.id])

  const loadStudents = async () => {
    try {
      // The roster query carries each student's current section and teaching
      // category, which is what the picker filters need; getPersons has neither.
      const result = await window.api.getStudentsWithSections(user?.id)
      setStudents(result?.data || [])
    } catch (err) {
      console.error('Failed to load students', err)
    } finally {
      setLoadingStudents(false)
    }
  }

  const selectedStudent = students.find(
    s => s.PERSON_ID === parseInt(selectedStudentId, 10)
  )

  // The roster carries each student's photo path; read the ones on screen so
  // the record header can show the face and fall back to the monogram.
  const studentPhotos = usePersonPhotos(students)

  const loadHistory = async (personId) => {
    if (!personId) {
      setAbsences([])
      setObservations([])
      setPunishments([])
      setRewards([])
      return
    }
    setLoadingHistory(true)
    try {
      const [absResult, obsResult, discResult] = await Promise.all([
        window.api.getStudentAbsenceHistory(personId, { startDate, endDate }),
        window.api.getStudentObservationHistory(personId, { startDate, endDate }),
        window.api.getStudentRewardsPunishments(user?.id, personId)
      ])
      setAbsences(absResult?.data || [])
      setObservations(obsResult?.data || [])
      setPunishments(discResult?.punishments || [])
      setRewards(discResult?.rewards || [])
    } catch (err) {
      console.error('Failed to load student history', err)
      setAbsences([])
      setObservations([])
      setPunishments([])
      setRewards([])
    } finally {
      setLoadingHistory(false)
    }
  }

  // Reload when the student or the date range changes.
  useEffect(() => {
    if (selectedStudentId) {
      loadHistory(parseInt(selectedStudentId, 10))
    } else {
      setAbsences([])
      setObservations([])
    }
  }, [selectedStudentId, startDate, endDate])

  // Reset the row expansion whenever the history changes.
  useEffect(() => {
    setExpandedRows({})
  }, [absences, observations])

  // Reset dependent filters when a new student's history arrives.
  useEffect(() => {
    setJustificationFilter('all')
    setMotifFilter('all')
    setMajorFilter('all')
    setTeacherFilter('all')
    setSearchTerm('')
    setRecordType('all')
  }, [selectedStudentId])

  // Distinct filter options derived from the loaded history.
  const justificationOptions = useMemo(
    () => [...new Set(absences.map(a => a.ABSENCE_JUSTIFICATION_LABEL).filter(Boolean))].sort(),
    [absences]
  )
  const motifOptions = useMemo(
    () => [...new Set(observations.map(o => o.OBSERVATION_MOTIF_LABEL).filter(Boolean))].sort(),
    [observations]
  )
  const majorOptions = useMemo(
    () => [...new Set([
      ...absences.map(a => a.MAJOR_LABEL),
      ...observations.map(o => o.MAJOR_LABEL)
    ].filter(Boolean))].sort(),
    [absences, observations]
  )
  const teacherOptions = useMemo(
    () => [...new Set([
      ...absences.map(a => a.INSTRUCTOR_NAME),
      ...observations.map(o => o.INSTRUCTOR_NAME)
    ].filter(Boolean))].sort(),
    [absences, observations]
  )

  // Student picker narrowing: the name search plus the section, category, sex
  // and placement filters, all offered in the picker's filter panel.
  const studentSections = useMemo(
    () => [...new Set(students.map(s => s.SECTION_LABEL).filter(Boolean))].sort(),
    [students]
  )
  const studentCategories = useMemo(
    () => [...new Set(students.map(s => s.TEACHING_CATEGORY_LABEL).filter(Boolean))].sort(),
    [students]
  )

  // Structural filters narrow the roster independently of the text query: the
  // selected student is kept while typing, because the query is only how you
  // search, not what the picker is limited to.
  const matchesStructuralFilters = (s) => {
    if (studentSex !== 'all' && (s.PERSON_SEX || '') !== studentSex) return false
    if (studentSection !== 'all' && (s.SECTION_LABEL || '') !== studentSection) return false
    if (studentCategory !== 'all' && (s.TEACHING_CATEGORY_LABEL || '') !== studentCategory) return false
    if (studentPlacement === 'placed' && !s.SECTION_ID) return false
    if (studentPlacement === 'unplaced' && s.SECTION_ID) return false
    return true
  }

  const matchesStudentFilters = (s) => {
    if (!matchesStructuralFilters(s)) return false
    if (!studentSearch) return true
    const name = `${s.PERSON_FIRST_NAME} ${s.PERSON_LAST_NAME}`.toLowerCase()
    return name.includes(studentSearch.toLowerCase())
  }

  const filteredStudentOptions = students.filter(matchesStudentFilters)

  const studentFilterCount = [
    studentSex !== 'all',
    studentSection !== 'all',
    studentCategory !== 'all',
    studentPlacement !== 'all'
  ].filter(Boolean).length

  const clearStudentFilters = () => {
    setStudentSearch('')
    setStudentSex('all')
    setStudentSection('all')
    setStudentCategory('all')
    setStudentPlacement('all')
  }

  const selectStudent = (student) => {
    setSelectedStudentId(String(student.PERSON_ID))
    setStudentSearch('')
    setPickerIndex(0)
    setPickerOpen(false)
  }

  const clearStudentPicker = () => {
    setStudentSearch('')
    setSelectedStudentId('')
    setPickerOpen(false)
  }

  const onPickerKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setPickerOpen(true)
      setPickerIndex((index) => Math.min(index + 1, Math.max(0, filteredStudentOptions.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setPickerIndex((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      if (pickerOpen && filteredStudentOptions[pickerIndex]) {
        event.preventDefault()
        selectStudent(filteredStudentOptions[pickerIndex])
      }
    } else if (event.key === 'Escape') {
      setPickerOpen(false)
    }
  }

  // A student hidden by the picker filters cannot stay selected: the select
  // no longer lists them, and the page would keep showing a record the picker
  // says is out of view.
  useEffect(() => {
    if (!selectedStudentId) return
    const visible = students.some(
      s => String(s.PERSON_ID) === String(selectedStudentId) && matchesStructuralFilters(s)
    )
    if (!visible) setSelectedStudentId('')
  }, [studentSex, studentSection, studentCategory, studentPlacement, students])

  // The result list closes on any click outside the picker.
  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [pickerOpen])

  const matchesContext = (row) => {
    if (majorFilter !== 'all' && (row.MAJOR_LABEL || '') !== majorFilter) return false
    if (teacherFilter !== 'all' && (row.INSTRUCTOR_NAME || '') !== teacherFilter) return false
    if (!searchTerm) return true
    const haystack = [
      row.MAJOR_LABEL, row.TEACHING_GROUP_LABEL, row.CLASSROOM_LABEL,
      row.INSTRUCTOR_NAME, row.STUDY_WEEK_LABEL, row.TEACHER_ABSENCE_NOTE,
      row.TEACHER_OBSERVATION_NOTE, row.STUDY_SESSION_TYPE_LABEL
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(searchTerm.toLowerCase())
  }

  const filteredAbsences = absences.filter(a => {
    if (recordType === 'observations' || recordType === 'rewardsPunishments') return false
    if (justificationFilter !== 'all' && (a.ABSENCE_JUSTIFICATION_LABEL || '') !== justificationFilter) return false
    return matchesContext(a)
  })

  const filteredObservations = observations.filter(o => {
    if (recordType === 'absences' || recordType === 'rewardsPunishments') return false
    if (motifFilter !== 'all' && (o.OBSERVATION_MOTIF_LABEL || '') !== motifFilter) return false
    return matchesContext(o)
  })

  // Discipline records are filtered by the search term on label/note only.
  const matchesRewardsPunishmentsSearch = (note, label) => {
    if (!searchTerm) return true
    return `${label || ''} ${note || ''}`.toLowerCase().includes(searchTerm.toLowerCase())
  }

  const filteredPunishments = punishments.filter(p => {
    if (recordType !== 'all' && recordType !== 'rewardsPunishments') return false
    return matchesRewardsPunishmentsSearch(p.PUNISHMENT_NOTE, `${p.PUNISHMENT_LABEL_EN} ${p.PUNISHMENT_LABEL_AR} ${p.PUNISHMENT_JUSTIFICATION_LABEL_EN} ${p.PUNISHMENT_JUSTIFICATION_LABEL_AR}`)
  })

  const filteredRewards = rewards.filter(r => {
    if (recordType !== 'all' && recordType !== 'rewardsPunishments') return false
    return matchesRewardsPunishmentsSearch(r.REWARD_NOTE, `${r.REWARD_LABEL_EN} ${r.REWARD_LABEL_AR} ${r.REWARD_JUSTIFICATION_LABEL_EN} ${r.REWARD_JUSTIFICATION_LABEL_AR}`)
  })

  // Combined timeline (newest first on the day/time of the record).
  const timeline = useMemo(() => {
    const items = []
    filteredAbsences.forEach(a => {
      const day = a.STUDY_DAY_DATE ? String(a.STUDY_DAY_DATE).substring(0, 10) : ''
      items.push({
        kind: 'absence',
        key: `abs-${a.STUDY_SESSION_ID}-${a.PERSON_ID}`,
        sortDate: `${day} ${a.STUDY_SESSION_START_TIME || ''}`,
        ...a
      })
    })
    filteredObservations.forEach(o => {
      items.push({
        kind: 'observation',
        key: `obs-${o.STUDY_SESSION_ID}-${o.OBSERVATION_MOTIF_ID}-${o.OBSERVATION_DATETIME}`,
        sortDate: o.OBSERVATION_DATETIME ? String(o.OBSERVATION_DATETIME) : '',
        ...o
      })
    })
    filteredPunishments.forEach(p => {
      items.push({
        kind: 'punishment',
        key: `pun-${p.PUNISHMENT_ID}`,
        sortDate: p.PUNISHMENT_SUGGESTED_AT ? String(p.PUNISHMENT_SUGGESTED_AT) : (p.PUNISHMENT_START_DATE ? String(p.PUNISHMENT_START_DATE) : ''),
        ...p
      })
    })
    filteredRewards.forEach(r => {
      items.push({
        kind: 'reward',
        key: `rew-${r.REWARD_ID}`,
        sortDate: r.REWARD_SUGGESTED_AT ? String(r.REWARD_SUGGESTED_AT) : (r.REWARD_START_DATE ? String(r.REWARD_START_DATE) : ''),
        ...r
      })
    })
    return items.sort((x, y) => String(y.sortDate).localeCompare(String(x.sortDate)))
  }, [filteredAbsences, filteredObservations, filteredPunishments, filteredRewards])

  const TIMELINE_PAGE_SIZE = 6
  const timelinePageCount = Math.max(1, Math.ceil(timeline.length / TIMELINE_PAGE_SIZE))
  const currentTimelinePage = Math.min(timelinePage, timelinePageCount - 1)
  const pagedTimeline = timeline.slice(
    currentTimelinePage * TIMELINE_PAGE_SIZE,
    (currentTimelinePage + 1) * TIMELINE_PAGE_SIZE
  )

  // A new student or a different result set starts again at the first page.
  useEffect(() => {
    setTimelinePage(0)
  }, [timeline.length, selectedStudentId])

  // Stats
  const totalAbsences = absences.length
  const unexcusedCount = absences.filter(a => a.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED').length
  const excusedCount = totalAbsences - unexcusedCount
  const totalObservations = observations.length
  const totalRewardsPunishments = punishments.length + rewards.length
  const filteredCount = filteredAbsences.length + filteredObservations.length + filteredPunishments.length + filteredRewards.length

  const toggleRow = (key) => {
    setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const resetFilters = () => {
    setRecordType('all')
    setStartDate('')
    setEndDate('')
    setJustificationFilter('all')
    setMotifFilter('all')
    setMajorFilter('all')
    setTeacherFilter('all')
    setSearchTerm('')
  }

  // Discipline rows ignore context filters (they have no session context).
  const rewardsPunishmentsOnlyActive = recordType === 'rewardsPunishments'

  const hasActiveFilters =
    recordType !== 'all' || startDate || endDate || justificationFilter !== 'all' ||
    motifFilter !== 'all' || majorFilter !== 'all' || teacherFilter !== 'all' || searchTerm

  // Shown on the Filters button so the dialog does not need to be opened to see
  // that the history is currently narrowed.
  const activeFilterCount = [
    recordType !== 'all',
    !!startDate,
    !!endDate,
    justificationFilter !== 'all',
    motifFilter !== 'all',
    majorFilter !== 'all',
    teacherFilter !== 'all',
    !!searchTerm
  ].filter(Boolean).length

  // ---- Analytics (computed from the filtered records) ---------------------
  const analytics = useMemo(() => {
    const toKey = (dateValue) => {
      if (!dateValue) return null
      const d = dateValue instanceof Date ? dateValue : new Date(String(dateValue))
      if (isNaN(d.getTime())) return null
      return d
    }

    // Month buckets covering the loaded history (or the chosen range).
    const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const monthLabel = (d) => d.toLocaleDateString(dateLocale(), { month: 'short', year: '2-digit' })

    const dates = [
      ...filteredAbsences.map(a => toKey(a.STUDY_DAY_DATE)),
      ...filteredObservations.map(o => toKey(o.OBSERVATION_DATETIME))
    ].filter(Boolean)

    let months = []
    if (dates.length > 0) {
      const min = new Date(Math.min(...dates.map(d => d.getTime())))
      const max = new Date(Math.max(...dates.map(d => d.getTime())))
      const cursor = new Date(min.getFullYear(), min.getMonth(), 1)
      const end = new Date(max.getFullYear(), max.getMonth(), 1)
      while (cursor <= end && months.length < 12) {
        months.push(new Date(cursor))
        cursor.setMonth(cursor.getMonth() + 1)
      }
    }

    const absByMonth = new Map(months.map(m => [monthOf(m), 0]))
    const obsByMonth = new Map(months.map(m => [monthOf(m), 0]))
    filteredAbsences.forEach(a => {
      const d = toKey(a.STUDY_DAY_DATE)
      if (d && absByMonth.has(monthOf(d))) absByMonth.set(monthOf(d), absByMonth.get(monthOf(d)) + 1)
    })
    filteredObservations.forEach(o => {
      const d = toKey(o.OBSERVATION_DATETIME)
      if (d && obsByMonth.has(monthOf(d))) obsByMonth.set(monthOf(d), obsByMonth.get(monthOf(d)) + 1)
    })

    // Weekday distribution.
    const weekdayNames = [tr('Sun'), tr('Mon'), tr('Tue'), tr('Wed'), tr('Thu'), tr('Fri'), tr('Sat')]
    const absByWeekday = new Array(7).fill(0)
    filteredAbsences.forEach(a => {
      const d = toKey(a.STUDY_DAY_DATE)
      if (d) absByWeekday[d.getDay()]++
    })

    // Top teachers / majors / motifs / justifications.
    const countBy = (rows, field) => {
      const map = new Map()
      rows.forEach(r => {
        const key = r[field] || tr('Unknown')
        map.set(key, (map.get(key) || 0) + 1)
      })
      return [...map.entries()].sort((a, b) => b[1] - a[1])
    }
    const topTeachers = countBy([
      ...filteredAbsences.map(a => ({ name: a.INSTRUCTOR_NAME })),
      ...filteredObservations.map(o => ({ name: o.INSTRUCTOR_NAME }))
    ].map(r => ({ name: r.name })), 'name').slice(0, 5)

    const topMajors = countBy(filteredAbsences.map(a => ({ MAJOR_LABEL: a.MAJOR_LABEL })), 'MAJOR_LABEL').slice(0, 5)
    const motifCounts = countBy(filteredObservations.map(o => ({ OBSERVATION_MOTIF_LABEL: o.OBSERVATION_MOTIF_LABEL })), 'OBSERVATION_MOTIF_LABEL')
    const justificationCounts = countBy(filteredAbsences.map(a => ({ ABSENCE_JUSTIFICATION_LABEL: a.ABSENCE_JUSTIFICATION_LABEL })), 'ABSENCE_JUSTIFICATION_LABEL')

    // Justification split for the donut.
    const unexcused = filteredAbsences.filter(a => a.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED').length
    const excused = filteredAbsences.length - unexcused

    // Advanced: average absences per month with recorded activity.
    const activeMonths = months.filter(m => absByMonth.get(monthOf(m)) + obsByMonth.get(monthOf(m)) > 0).length
    const avgAbsPerMonth = activeMonths > 0 ? (filteredAbsences.length / activeMonths) : 0

    // Advanced: worst month / best (lowest-absence active) month.
    let worstMonth = null
    months.forEach(m => {
      const v = absByMonth.get(monthOf(m))
      if (v > 0 && (!worstMonth || v > worstMonth.value)) worstMonth = { label: monthLabel(m), value: v }
    })

    // Advanced: trend over the last vs previous half of the history window.
    const half = Math.floor(months.length / 2)
    const sumRange = (from, to) => months.slice(from, to).reduce((s, m) => s + absByMonth.get(monthOf(m)), 0)
    const recentHalf = sumRange(half, months.length)
    const earlierHalf = sumRange(0, half)
    let trendDelta = 0
    if (earlierHalf > 0) trendDelta = Math.round(((recentHalf - earlierHalf) / earlierHalf) * 100)
    else if (recentHalf > 0) trendDelta = 100

    // Advanced: highest-risk weekday.
    let riskWeekday = null
    absByWeekday.forEach((v, i) => {
      if (v > 0 && (!riskWeekday || v > riskWeekday.value)) riskWeekday = { name: weekdayNames[i], value: v }
    })

    // Advanced: note coverage (% of records with a teacher note).
    const notedAbs = filteredAbsences.filter(a => a.TEACHER_ABSENCE_NOTE).length
    const notedObs = filteredObservations.filter(o => o.TEACHER_OBSERVATION_NOTE).length
    const noteCoverage = filteredCount > 0 ? Math.round(((notedAbs + notedObs) / filteredCount) * 100) : 0

    return {
      months, monthOf, monthLabel,
      absSeries: months.map(m => absByMonth.get(monthOf(m))),
      obsSeries: months.map(m => obsByMonth.get(monthOf(m))),
      monthLabels: months.map(m => monthLabel(m)),
      weekdayBars: weekdayNames.map((name, i) => ({ label: name, value: absByWeekday[i] })),
      topTeachers,
      topMajors,
      motifCounts,
      justificationCounts,
      unexcused, excused,
      avgAbsPerMonth: Math.round(avgAbsPerMonth * 10) / 10,
      worstMonth,
      trendDelta,
      riskWeekday,
      noteCoverage
    }
  }, [filteredAbsences, filteredObservations, filteredCount])

  if (loadingStudents) {
    return (
      <div className="flex h-full items-center justify-center">
        <div role="status" aria-live="polite" className="text-[12px] font-medium text-ink-3">
          {tr('Loading students...')}
        </div>
      </div>
    )
  }

  const selectClass = 'field text-[12px]'

  const PANELS = [
    { id: 'overview', label: 'Overview', icon: BookOpen, count: filteredCount },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, count: filteredCount },
    { id: 'timeline', label: 'Timeline', icon: History, count: timeline.length }
  ]
  const goToPanel = (next) => setSlide(((next % PANELS.length) + PANELS.length) % PANELS.length)

  const RECORD_TYPES = [
    { value: 'all', label: 'All' },
    { value: 'absences', label: 'Absences' },
    { value: 'observations', label: 'Observations' },
    { value: 'rewardsPunishments', label: 'Discipline' }
  ]

  const kindOf = (item) => {
    if (item.kind === 'absence') {
      return { label: 'Absence', icon: UserX, chip: 'border-danger/30 bg-danger-bg text-danger-ink' }
    }
    if (item.kind === 'punishment') {
      return { label: 'Punishment', icon: Gavel, chip: 'border-warning/35 bg-warning-bg text-warning-ink' }
    }
    if (item.kind === 'reward') {
      return { label: 'Reward', icon: Award, chip: 'border-success/30 bg-success-bg text-success-ink' }
    }
    return { label: 'Observation', icon: Notebook, chip: 'border-line-strong bg-selection text-ink-2' }
  }

  const itemDay = (item) => {
    if (item.kind === 'absence') {
      return item.STUDY_DAY_DATE ? String(item.STUDY_DAY_DATE).substring(0, 10) : ''
    }
    if (item.kind === 'observation') {
      return item.OBSERVATION_DATETIME ? String(item.OBSERVATION_DATETIME).substring(0, 10) : ''
    }
    const start = item.kind === 'punishment' ? item.PUNISHMENT_START_DATE : item.REWARD_START_DATE
    const applied = item.kind === 'punishment' ? item.PUNISHMENT_SUGGESTED_AT : item.REWARD_SUGGESTED_AT
    return start ? String(start).substring(0, 10) : (applied ? String(applied).substring(0, 10) : '')
  }

  const itemPrimary = (item) => {
    if (item.kind === 'absence') return item.ABSENCE_JUSTIFICATION_LABEL || tr('Absence')
    if (item.kind === 'observation') return item.OBSERVATION_MOTIF_LABEL || tr('Observation')
    if (item.kind === 'punishment') return localizedLabel(item, 'PUNISHMENT_LABEL')
    return localizedLabel(item, 'REWARD_LABEL')
  }

  const itemContext = (item) => {
    if (item.kind === 'punishment' || item.kind === 'reward') {
      const start = item.kind === 'punishment' ? item.PUNISHMENT_START_DATE : item.REWARD_START_DATE
      const end = item.kind === 'punishment' ? item.PUNISHMENT_END_DATE : item.REWARD_END_DATE
      const secretary = [item.SECRETARY_FIRST_NAME, item.SECRETARY_LAST_NAME].filter(Boolean).join(' ')
      const justification = localizedLabel(
        item,
        item.kind === 'punishment' ? 'PUNISHMENT_JUSTIFICATION_LABEL' : 'REWARD_JUSTIFICATION_LABEL'
      )
      return [
        justification,
        start && end
          ? `${formatDate(start, { day: '2-digit', month: 'short' })} → ${formatDate(end, { day: '2-digit', month: 'short' })}`
          : tr('Immediate'),
        secretary
      ].filter(Boolean)
    }
    return [
      item.kind === 'absence'
        ? `${(item.STUDY_SESSION_START_TIME || '').substring(0, 5)}–${(item.STUDY_SESSION_END_TIME || '').substring(0, 5)}`
        : formatTime(item.OBSERVATION_DATETIME),
      item.TEACHING_GROUP_LABEL,
      item.CLASSROOM_LABEL,
      item.INSTRUCTOR_NAME
    ].filter(Boolean)
  }

  const studentFullName = selectedStudent
    ? `${selectedStudent.PERSON_FIRST_NAME || ''} ${selectedStudent.PERSON_LAST_NAME || ''}`.trim()
    : ''
  const initials = selectedStudent
    ? `${selectedStudent.PERSON_FIRST_NAME?.[0] || ''}${selectedStudent.PERSON_LAST_NAME?.[0] || ''}`.toUpperCase()
    : ''
  const unexcusedPercent = totalAbsences > 0 ? Math.round((unexcusedCount / totalAbsences) * 100) : 0
  const recentItems = timeline.slice(0, 5)

  const renderRankList = (title, rows, total, emptyLabel = 'No data in the current selection.') => (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
        <h4 className="kicker text-[9px]">{title}</h4>
        <span className="mono text-[10px] text-ink-3">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3.5 py-4 text-[11px] leading-relaxed text-ink-3">{tr(emptyLabel)}</p>
      ) : (
        <div className="divide-y divide-line">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center gap-2 px-3.5 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{label}</span>
              <span className="hidden h-1 w-16 overflow-hidden rounded-[1px] bg-surface-muted sm:block">
                <span
                  className="block h-full bg-jade-500"
                  style={{ width: `${Math.min(100, Math.round((value / Math.max(1, total)) * 100))}%` }}
                />
              </span>
              <span className="mono w-6 text-end text-[10.5px] text-ink-3">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const renderTimelineDetail = (item) => {
    const isDiscipline = item.kind === 'punishment' || item.kind === 'reward'
    const note = item.kind === 'absence' ? item.TEACHER_ABSENCE_NOTE
      : item.kind === 'punishment' ? item.PUNISHMENT_NOTE
        : item.kind === 'reward' ? item.REWARD_NOTE
          : item.TEACHER_OBSERVATION_NOTE

    if (isDiscipline) {
      const duration = item.kind === 'punishment' ? item.PUNISHMENT_DURATION : item.REWARD_DURATION
      const start = item.kind === 'punishment' ? item.PUNISHMENT_START_DATE : item.REWARD_START_DATE
      const end = item.kind === 'punishment' ? item.PUNISHMENT_END_DATE : item.REWARD_END_DATE
      const labelAr = item.kind === 'punishment' ? item.PUNISHMENT_LABEL_AR : item.REWARD_LABEL_AR
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-5">
            <div>
              <div className="kicker text-[8.5px]">{tr('Type (AR)')}</div>
              <div className="mt-0.5 truncate font-medium text-ink-2" dir="rtl">{labelAr || '—'}</div>
            </div>
            <div>
              <div className="kicker text-[8.5px]">{tr('Justification')}</div>
              <div className="mt-0.5 truncate font-medium text-ink-2">
                {localizedLabel(
                  item,
                  item.kind === 'punishment' ? 'PUNISHMENT_JUSTIFICATION_LABEL' : 'REWARD_JUSTIFICATION_LABEL'
                ) || '—'}
              </div>
            </div>
            <div>
              <div className="kicker text-[8.5px]">{tr('Duration')}</div>
              <div className="mt-0.5 font-medium text-ink-2">
                {Number(duration) > 0
                  ? `${duration} ${Number(duration) === 1 ? tr('day') : tr('days')}`
                  : tr('Immediate')}
              </div>
            </div>
            <div>
              <div className="kicker text-[8.5px]">{tr('Start')}</div>
              <div className="mt-0.5 font-medium text-ink-2">{start ? formatDateLong(start) : '—'}</div>
            </div>
            <div>
              <div className="kicker text-[8.5px]">{tr('End')}</div>
              <div className="mt-0.5 font-medium text-ink-2">{end ? formatDateLong(end) : '—'}</div>
            </div>
          </div>
          <div>
            <div className="kicker text-[8.5px]">{tr('Note')}</div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
              {note || <span className="italic text-ink-3">{tr('No note recorded.')}</span>}
            </p>
          </div>
          <div className="mono text-[9.5px] text-ink-3">
            {item.kind === 'punishment' ? `Punishment #${item.PUNISHMENT_ID}` : `Reward #${item.REWARD_ID}`}
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
          <div>
            <div className="kicker text-[8.5px]">{tr('Week')}</div>
            <div className="mt-0.5 truncate font-medium text-ink-2">{item.STUDY_WEEK_LABEL || '—'}</div>
          </div>
          <div>
            <div className="kicker text-[8.5px]">{tr('Major')}</div>
            <div className="mt-0.5 truncate font-medium text-ink-2">{item.MAJOR_LABEL || '—'}</div>
          </div>
          <div>
            <div className="kicker text-[8.5px]">{tr('Group')}</div>
            <div className="mt-0.5 truncate font-medium text-ink-2">{item.TEACHING_GROUP_LABEL || '—'}</div>
          </div>
          <div>
            <div className="kicker text-[8.5px]">{tr('Classroom')}</div>
            <div className="mt-0.5 truncate font-medium text-ink-2">{item.CLASSROOM_LABEL || '—'}</div>
          </div>
        </div>
        <div>
          <div className="kicker text-[8.5px]">
            {item.kind === 'absence' ? tr("Teacher's Absence Note") : tr("Teacher's Observation Note")}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">
            {note || <span className="italic text-ink-3">{tr('No note recorded.')}</span>}
          </p>
        </div>
        <div className="mono text-[9.5px] text-ink-3">
          {tr('Session #')}{item.STUDY_SESSION_ID}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageIntro
        kicker={tr('Records')}
        title={tr('Student History')}
        meta={selectedStudent ? `${filteredCount} ${tr('records')}` : undefined}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr("Consult a student's complete absences and observations history")}
        </p>
      </PageIntro>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-16 pt-4">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4">

          {/* Student search: type a name, pick the student from the results. */}
          <div className="rounded-md border border-line bg-surface px-3.5 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="w-full max-w-[520px]">
                <label htmlFor="student-picker" className="kicker ms-1 mb-1 block tracking-wider">
                  {tr('Student')}
                </label>
                <div className="relative" ref={pickerRef}>
                  <Search
                    className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3"
                    size={14}
                    aria-hidden="true"
                  />
                  <input
                    id="student-picker"
                    type="text"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    aria-controls="student-picker-results"
                    aria-autocomplete="list"
                    autoComplete="off"
                    placeholder={tr('Search by name...')}
                    value={studentSearch}
                    onChange={(event) => {
                      setStudentSearch(event.target.value)
                      setPickerIndex(0)
                      setPickerOpen(true)
                    }}
                    onFocus={() => setPickerOpen(true)}
                    onClick={() => setPickerOpen(true)}
                    onKeyDown={onPickerKeyDown}
                    className="block h-9 w-full rounded-[4px] border border-line bg-surface ps-9 pe-9 text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong focus:ring-2 focus:ring-jade-500/20"
                  />
                  {(studentSearch || selectedStudentId) && (
                    <button
                      type="button"
                      onClick={clearStudentPicker}
                      aria-label={tr('Clear selection')}
                      className="absolute end-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                    >
                      <X size={12} />
                    </button>
                  )}

                  {pickerOpen && (
                    <ul
                      id="student-picker-results"
                      role="listbox"
                      aria-label={tr('Student')}
                      className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-line-strong bg-raised p-1"
                      style={{ boxShadow: 'var(--shadow-e2)' }}
                    >
                      {filteredStudentOptions.length === 0 ? (
                        <li className="px-2.5 py-3 text-[11.5px] text-ink-3">
                          {students.length === 0 ? tr('No students found') : tr('No students match these filters.')}
                        </li>
                      ) : (
                        filteredStudentOptions.slice(0, 60).map((student, index) => {
                          const name = `${student.PERSON_FIRST_NAME || ''} ${student.PERSON_LAST_NAME || ''}`.trim()
                          return (
                            <li
                              key={student.PERSON_ID}
                              role="option"
                              aria-selected={index === pickerIndex}
                              onMouseEnter={() => setPickerIndex(index)}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => selectStudent(student)}
                              className={`flex cursor-pointer items-center gap-2 rounded-[3px] px-2.5 py-1.5 text-start text-[12px] ${
                                index === pickerIndex ? 'bg-selection text-ink' : 'text-ink-2 hover:bg-surface-muted'
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate">{name}</span>
                              {student.SECTION_LABEL && (
                                <span className="mono shrink-0 text-[10px] text-ink-3">{student.SECTION_LABEL}</span>
                              )}
                            </li>
                          )
                        })
                      )}
                    </ul>
                  )}
                </div>
              </div>

              <FilterBar
                activeCount={studentFilterCount}
                onClear={clearStudentFilters}
                matchCount={filteredStudentOptions.length}
                matchLabel="student"
                title={tr('Filters')}
              >
                <FilterField label={tr('Sex')}>
                  <select value={studentSex} onChange={(e) => setStudentSex(e.target.value)} className={filterInputCls}>
                    <option value="all">{tr('All')}</option>
                    <option value="M">{tr('Male')}</option>
                    <option value="F">{tr('Female')}</option>
                  </select>
                </FilterField>

                <FilterField label={tr('Teaching category')}>
                  <select value={studentCategory} onChange={(e) => setStudentCategory(e.target.value)} className={filterInputCls}>
                    <option value="all">{tr('All categories')}</option>
                    {studentCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label={tr('Section')}>
                  <select value={studentSection} onChange={(e) => setStudentSection(e.target.value)} className={filterInputCls}>
                    <option value="all">{tr('All sections')}</option>
                    {studentSections.map((section) => (
                      <option key={section} value={section}>{section}</option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label={tr('Placement')}>
                  <select value={studentPlacement} onChange={(e) => setStudentPlacement(e.target.value)} className={filterInputCls}>
                    <option value="all">{tr('All')}</option>
                    <option value="placed">{tr('Placed')}</option>
                    <option value="unplaced">{tr('Unplaced')}</option>
                  </select>
                </FilterField>
              </FilterBar>

              {selectedStudent && (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 pb-1 sm:ms-auto">
                  {selectedStudent.SECTION_LABEL && (
                    <span className="mono rounded-[2px] border border-line bg-surface-muted px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.05em] text-ink-2">
                      {selectedStudent.SECTION_LABEL}
                    </span>
                  )}
                  {selectedStudent.TEACHING_CATEGORY_LABEL && (
                    <span className="mono rounded-[2px] border border-line px-1.5 py-0.5 text-[9.5px] text-ink-3">
                      {selectedStudent.TEACHING_CATEGORY_LABEL}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={clearStudentPicker}
                    className="ms-1 text-[10.5px] text-ink-3 hover:text-ink"
                  >
                    {tr('Clear selection')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {!selectedStudent ? (
            <div className="rounded-md border border-line bg-surface px-6 py-12 text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-[3px] border border-line-strong text-ink-3">
                <History size={16} strokeWidth={1.7} aria-hidden="true" />
              </div>
              <h2 className="mt-3 text-[13px] font-semibold text-ink">{tr('Select a Student')}</h2>
              <p className="mx-auto mt-1 max-w-sm text-[11.5px] leading-relaxed text-ink-3">
                {tr('Choose a student above to consult their full absences and observations history.')}
              </p>
            </div>
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">

              {/* Left rail: who the record belongs to, then the three panels. */}
              <aside className="space-y-3 lg:sticky lg:top-0">
                <div className="overflow-hidden rounded-md border border-line bg-surface">
                  <div className="flex items-start gap-3 border-b border-line p-3.5">
                    <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[3px] border border-line-strong bg-surface-muted text-[15px] font-semibold text-ink-2">
                      {studentPhotos[Number(selectedStudent.PERSON_ID)]
                        ? <PhotoZoom src={studentPhotos[Number(selectedStudent.PERSON_ID)]} alt={studentFullName} />
                        : (initials || <UserRound size={14} />)}
                    </span>
                    <div className="min-w-0">
                      <div className="kicker text-[8.5px]">{tr('Student record')}</div>
                      <h2 className="serif mt-0.5 truncate text-[18px] leading-tight text-ink" title={studentFullName}>
                        {studentFullName}
                      </h2>
                      <div className="mono mt-1 text-[10px] text-ink-3">
                        № {String(selectedStudent.PERSON_ID).padStart(4, '0')}
                      </div>
                    </div>
                  </div>

                  <dl className="divide-y divide-line text-[11.5px]">
                    <div className="flex items-baseline justify-between gap-3 px-3.5 py-1.5">
                      <dt className="kicker text-[8.5px]">{tr('Section')}</dt>
                      <dd className="truncate text-ink-2">{selectedStudent.SECTION_LABEL || '—'}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 px-3.5 py-1.5">
                      <dt className="kicker text-[8.5px]">{tr('Teaching category')}</dt>
                      <dd className="truncate text-ink-2">{selectedStudent.TEACHING_CATEGORY_LABEL || '—'}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 px-3.5 py-1.5">
                      <dt className="kicker text-[8.5px]">{tr('Email')}</dt>
                      <dd className="truncate text-ink-2" title={selectedStudent.PERSON_EMAIL || ''}>
                        {selectedStudent.PERSON_EMAIL || '—'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 px-3.5 py-1.5">
                      <dt className="kicker text-[8.5px]">{tr('Period')}</dt>
                      <dd className="mono truncate text-[10.5px] text-ink-2">
                        {startDate || endDate
                          ? `${startDate || '…'} → ${endDate || '…'}`
                          : tr('All history')}
                      </dd>
                    </div>
                  </dl>

                  <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
                    {[
                      { label: 'Absences', value: totalAbsences, tone: 'text-ink' },
                      { label: 'Unexcused', value: unexcusedCount, tone: 'text-warning-ink' },
                      { label: 'Observations', value: totalObservations, tone: 'text-ink' },
                      { label: 'Discipline', value: totalRewardsPunishments, tone: 'text-ink-2' }
                    ].map((figure) => (
                      <div key={figure.label} className="bg-surface px-3 py-2">
                        <div className={`serif text-[19px] leading-none ${figure.tone}`}>{figure.value}</div>
                        <div className="kicker mt-1 text-[8px]">{tr(figure.label)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <nav
                  role="tablist"
                  aria-label={tr('History sections')}
                  className="overflow-hidden rounded-md border border-line bg-surface"
                >
                  {PANELS.map((panel, index) => {
                    const Icon = panel.icon
                    const active = slide === index
                    return (
                      <button
                        key={panel.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => goToPanel(index)}
                        className={`flex w-full items-center gap-2 border-b border-line px-3 py-2 text-start last:border-b-0 ${
                          active ? 'bg-selection' : 'hover:bg-surface-muted'
                        }`}
                      >
                        <Icon size={12} className={active ? 'text-ink' : 'text-ink-3'} aria-hidden="true" />
                        <span className={`flex-1 text-[11.5px] ${active ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                          {tr(panel.label)}
                        </span>
                        <span className="mono text-[10px] text-ink-3">{panel.count}</span>
                      </button>
                    )
                  })}
                </nav>
              </aside>

              {/* Right side: one record panel at a time, with its own toolbar. */}
              <section role="tabpanel" aria-label={tr(PANELS[slide].label)} className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2">
                  <div
                    className="flex flex-wrap items-center gap-1"
                    role="group"
                    aria-label={tr('Record type')}
                  >
                    {RECORD_TYPES.map((type) => (
                      <button
                        key={type.value}
                        type="button"
                        aria-pressed={recordType === type.value}
                        onClick={() => { setRecordType(type.value); setTimelinePage(0) }}
                        className={`h-6 rounded-[3px] border px-2 text-[10.5px] font-medium transition-colors ${
                          recordType === type.value
                            ? 'border-line-strong bg-selection text-ink'
                            : 'border-transparent text-ink-3 hover:bg-surface-muted hover:text-ink'
                        }`}
                      >
                        {tr(type.label)}
                      </button>
                    ))}
                  </div>

                  <span className="mono ms-auto hidden text-[10px] text-ink-3 sm:inline">
                    {filteredCount} / {totalAbsences + totalObservations + totalRewardsPunishments}
                  </span>

                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line px-1.5 text-[10.5px] text-ink-3 hover:border-line-strong hover:text-ink"
                    >
                      <RotateCcw size={10} /> {tr('Reset')}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setFiltersOpen(true)}
                    aria-haspopup="dialog"
                    className={`inline-flex h-6 items-center gap-1.5 rounded-[3px] border px-2 text-[10.5px] font-semibold ${
                      activeFilterCount > 0
                        ? 'border-jade-600 bg-selection text-ink'
                        : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink'
                    }`}
                  >
                    <Filter size={11} strokeWidth={2} />
                    {tr('Filters')}
                    {activeFilterCount > 0 && (
                      <span className="mono rounded-[2px] bg-jade-solid px-1 text-[9px] font-semibold leading-4 text-on-jade">
                        {activeFilterCount}
                      </span>
                    )}
                  </button>
                </div>

                {slide === 0 && (
                  <div className="space-y-3">
                    <div className="rounded-md border border-line bg-surface p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="kicker text-[9px]">{tr('Attendance split')}</h3>
                        <span className="mono text-[10px] text-ink-3">
                          {totalAbsences} {tr('Absences').toLowerCase()}
                        </span>
                      </div>
                      {totalAbsences === 0 ? (
                        <p className="mt-2 text-[11.5px] text-ink-3">
                          {tr('No absences recorded in this selection.')}
                        </p>
                      ) : (
                        <>
                          <div className="mt-2.5 flex h-2 overflow-hidden rounded-[2px] bg-surface-muted">
                            <span
                              className="block h-full"
                              style={{ width: `${unexcusedPercent}%`, background: 'var(--color-warning)' }}
                            />
                            <span
                              className="block h-full"
                              style={{ width: `${100 - unexcusedPercent}%`, background: 'var(--color-jade-500)' }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-ink-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--color-warning)' }} />
                              {tr('Unexcused')} <span className="mono text-ink-3">{unexcusedCount}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--color-jade-500)' }} />
                              {tr('Excused')} <span className="mono text-ink-3">{excusedCount}</span>
                            </span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="overflow-hidden rounded-md border border-line bg-surface">
                      <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
                        <h3 className="kicker text-[9px]">{tr('Recent activity')}</h3>
                        <button
                          type="button"
                          onClick={() => goToPanel(2)}
                          className="text-[10.5px] text-ink-3 hover:text-ink"
                        >
                          {tr('Open timeline')}
                        </button>
                      </div>
                      {recentItems.length === 0 ? (
                        <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-3">
                          {tr('No records in this selection.')}
                        </p>
                      ) : (
                        <div className="divide-y divide-line">
                          {recentItems.map((item) => {
                            const kind = kindOf(item)
                            const Icon = kind.icon
                            const day = itemDay(item)
                            return (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() => {
                                  setExpandedRows((previous) => ({ ...previous, [item.key]: true }))
                                  goToPanel(2)
                                }}
                                className="flex w-full items-center gap-2 px-3.5 py-2 text-start hover:bg-surface-muted"
                              >
                                <Icon size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
                                <span className="mono w-[74px] shrink-0 text-[10px] text-ink-3">
                                  {day ? formatDate(day, { day: '2-digit', month: 'short' }) : '—'}
                                </span>
                                <span className={`mono shrink-0 rounded-[2px] border px-1 py-0.5 text-[8.5px] uppercase tracking-[0.05em] ${kind.chip}`}>
                                  {tr(kind.label)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                                  {itemPrimary(item)}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {renderRankList(tr('Absences by major'), analytics.topMajors, Math.max(1, filteredAbsences.length))}
                      {renderRankList(tr('Observations by motif'), analytics.motifCounts.slice(0, 5), Math.max(1, filteredObservations.length))}
                    </div>
                  </div>
                )}

                {slide === 1 && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3 xl:grid-cols-6">
                      {[
                        { label: tr('Absences'), value: filteredAbsences.length },
                        { label: tr('Observations'), value: filteredObservations.length },
                        { label: tr('Avg / month'), value: analytics.avgAbsPerMonth },
                        { label: tr('Worst month'), value: analytics.worstMonth ? `${analytics.worstMonth.label} (${analytics.worstMonth.value})` : '—' },
                        { label: tr('6-mo trend'), value: analytics.trendDelta === 0 ? '—' : `${analytics.trendDelta > 0 ? '+' : ''}${analytics.trendDelta}%` },
                        { label: tr('Riskiest day'), value: analytics.riskWeekday ? analytics.riskWeekday.name : '—' }
                      ].map((kpi) => (
                        <div key={kpi.label} className="min-w-0 bg-surface px-3 py-2">
                          <div className="serif truncate text-[17px] leading-none text-ink" title={String(kpi.value)}>
                            {kpi.value}
                          </div>
                          <div className="kicker mt-1 truncate text-[8px]">{kpi.label}</div>
                        </div>
                      ))}
                    </div>

                    {filteredCount === 0 ? (
                      <div className="rounded-md border border-line bg-surface px-4 py-10 text-center text-[11.5px] text-ink-3">
                        {tr('No records in the current selection to analyze.')}
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md border border-line bg-surface p-3">
                          <h3 className="kicker mb-2 text-[9px]">{tr('Monthly Trend')}</h3>
                          <TrendChart
                            labels={analytics.monthLabels}
                            series={[
                              { name: tr('Absences'), color: 'var(--color-danger)', values: analytics.absSeries },
                              { name: tr('Observations'), color: 'var(--color-jade-500)', values: analytics.obsSeries }
                            ]}
                          />
                          <div className="mt-2 flex items-center gap-4 text-[10.5px] text-ink-2">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-0.5 w-3" style={{ background: 'var(--color-danger)' }} />
                              {tr('Absences')}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-0.5 w-3" style={{ background: 'var(--color-jade-500)' }} />
                              {tr('Observations')}
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="rounded-md border border-line bg-surface p-3">
                            <h3 className="kicker mb-3 text-[9px]">{tr('Absences by Weekday')}</h3>
                            <VBarChart data={analytics.weekdayBars} height={170} />
                          </div>
                          <div className="rounded-md border border-line bg-surface p-3">
                            <h3 className="kicker mb-3 text-[9px]">{tr('Justification Split')}</h3>
                            <DonutChart
                              data={[
                                { label: tr('Unexcused'), value: analytics.unexcused, color: 'var(--color-warning)' },
                                { label: tr('Excused'), value: analytics.excused, color: 'var(--color-jade-600)' }
                              ]}
                              centerLabel="ABSENCES"
                            />
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          {renderRankList(tr('Most absences by teacher'), analytics.topTeachers, Math.max(1, filteredAbsences.length + filteredObservations.length))}
                          {renderRankList(tr('Justifications'), analytics.justificationCounts.slice(0, 5), Math.max(1, filteredAbsences.length))}
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3.5 py-2 text-[10.5px] text-ink-3">
                          <span>{tr('Records with a note')}</span>
                          <span className="mono text-ink-2">{analytics.noteCoverage}%</span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {slide === 2 && (
                  <div className="overflow-hidden rounded-md border border-line bg-surface">
                    <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
                      <h3 className="kicker text-[9px]">{tr('Timeline')}</h3>
                      <span className="mono text-[10px] text-ink-3">
                        {timeline.length} {tr('records')}
                      </span>
                    </div>

                    {loadingHistory ? (
                      <div className="space-y-1.5 p-3" role="status" aria-live="polite" aria-label={tr('Loading history...')}>
                        {Array.from({ length: 6 }, (_, index) => (
                          <div key={index} className="h-9 rounded-[2px] bg-surface-muted" />
                        ))}
                      </div>
                    ) : timeline.length === 0 ? (
                      <div className="px-5 py-12 text-center">
                        <div className="mx-auto grid h-9 w-9 place-items-center rounded-[3px] border border-line-strong text-ink-3">
                          <History size={15} aria-hidden="true" />
                        </div>
                        <h4 className="mt-2.5 text-[12.5px] font-semibold text-ink">
                          {hasActiveFilters ? tr('No Records Match Your Filters') : tr('No History Yet')}
                        </h4>
                        <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-ink-3">
                          {hasActiveFilters
                            ? tr('Try widening the date range or resetting the filters.')
                            : `No absences or observations have been recorded for ${studentFullName}.`}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="divide-y divide-line">
                          {pagedTimeline.map((item) => {
                            const kind = kindOf(item)
                            const Icon = kind.icon
                            const expanded = !!expandedRows[item.key]
                            const day = itemDay(item)
                            const note = item.kind === 'absence' ? item.TEACHER_ABSENCE_NOTE
                              : item.kind === 'punishment' ? item.PUNISHMENT_NOTE
                                : item.kind === 'reward' ? item.REWARD_NOTE
                                  : item.TEACHER_OBSERVATION_NOTE
                            const context = itemContext(item)

                            return (
                              <div key={item.key}>
                                <button
                                  type="button"
                                  onClick={() => toggleRow(item.key)}
                                  aria-expanded={expanded}
                                  className="grid w-full grid-cols-[78px_minmax(0,1fr)_16px] items-start gap-3 px-3.5 py-2.5 text-start hover:bg-surface-muted"
                                >
                                  <span className="pt-0.5">
                                    <span className="mono block text-[10.5px] leading-tight text-ink-2">
                                      {day ? formatDate(day, { day: '2-digit', month: 'short' }) : '—'}
                                    </span>
                                    <span className="mono mt-0.5 block text-[9px] leading-tight text-ink-3">
                                      {day ? day.substring(0, 4) : ''}
                                    </span>
                                  </span>

                                  <span className="min-w-0">
                                    <span className="flex flex-wrap items-center gap-1.5">
                                      <span className={`mono rounded-[2px] border px-1 py-0.5 text-[8.5px] uppercase tracking-[0.05em] ${kind.chip}`}>
                                        {tr(kind.label)}
                                      </span>
                                      <span className="truncate text-[12px] font-medium text-ink">{itemPrimary(item)}</span>
                                      {item.STUDY_SESSION_TYPE_LABEL && (
                                        <span className="mono rounded-[2px] border border-line px-1 py-0.5 text-[8.5px] text-ink-3">
                                          {tr(item.STUDY_SESSION_TYPE_LABEL)}
                                        </span>
                                      )}
                                    </span>
                                    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-ink-3">
                                      <Icon size={10} aria-hidden="true" />
                                      {context.map((part, index) => (
                                        <span key={`${item.key}-${index}`} className="inline-flex items-center gap-2.5">
                                          {index > 0 && <span aria-hidden="true">·</span>}
                                          <span className="truncate">{part}</span>
                                        </span>
                                      ))}
                                    </span>
                                    {!expanded && note && (
                                      <span className="mt-1 block truncate text-[10.5px] italic text-ink-3" title={note}>
                                        “{note}”
                                      </span>
                                    )}
                                  </span>

                                  <ChevronDown
                                    size={13}
                                    className={`mt-1 text-ink-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                                    aria-hidden="true"
                                  />
                                </button>

                                {expanded && (
                                  <div className="border-t border-line bg-surface-muted px-3.5 py-3">
                                    {renderTimelineDetail(item)}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {timeline.length > TIMELINE_PAGE_SIZE && (
                          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-muted px-3 py-2">
                            <span className="mono text-[10px] text-ink-3">
                              {currentTimelinePage + 1} / {timelinePageCount} · {timeline.length} {tr('records')}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setTimelinePage((page) => Math.max(0, page - 1))}
                                disabled={currentTimelinePage === 0}
                                aria-label={tr('Back')}
                                className="grid h-6 w-6 place-items-center rounded-[3px] border border-line-strong bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-default disabled:opacity-40"
                              >
                                <ChevronLeft size={12} className="rtl:rotate-180" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setTimelinePage((page) => Math.min(timelinePageCount - 1, page + 1))}
                                disabled={currentTimelinePage >= timelinePageCount - 1}
                                aria-label={tr('Forward')}
                                className="grid h-6 w-6 place-items-center rounded-[3px] border border-line-strong bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-default disabled:opacity-40"
                              >
                                <ChevronRight size={12} className="rtl:rotate-180" />
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Record filters: dates, record-specific choices and free text. */}
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={tr('Filters')}
        maxWidth="max-w-[560px]"
        footer={
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasActiveFilters}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={12} /> {tr('Reset')}
            </button>
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Close')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[11px] text-ink-3">
            {filteredCount} {tr('of')} {totalAbsences + totalObservations + totalRewardsPunishments} {tr('records shown')}
          </p>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('From')}</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={selectClass}
              />
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('To')}</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={selectClass}
              />
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Justification')}</label>
              <select
                value={justificationFilter}
                onChange={(e) => setJustificationFilter(e.target.value)}
                className={selectClass}
                disabled={recordType === 'observations' || justificationOptions.length === 0}
              >
                <option value="all">{tr('All justifications')}</option>
                {justificationOptions.map((justification) => (
                  <option key={justification} value={justification}>{justification}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Motif')}</label>
              <select
                value={motifFilter}
                onChange={(e) => setMotifFilter(e.target.value)}
                className={selectClass}
                disabled={recordType === 'absences' || motifOptions.length === 0}
              >
                <option value="all">{tr('All motifs')}</option>
                {motifOptions.map((motif) => (
                  <option key={motif} value={motif}>{motif}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Major')}</label>
              <select
                value={majorFilter}
                onChange={(e) => setMajorFilter(e.target.value)}
                className={selectClass}
                disabled={majorOptions.length === 0}
              >
                <option value="all">{tr('All majors')}</option>
                {majorOptions.map((major) => (
                  <option key={major} value={major}>{major}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Teacher')}</label>
              <select
                value={teacherFilter}
                onChange={(e) => setTeacherFilter(e.target.value)}
                className={selectClass}
                disabled={teacherOptions.length === 0}
              >
                <option value="all">{tr('All teachers')}</option>
                {teacherOptions.map((teacher) => (
                  <option key={teacher} value={teacher}>{teacher}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
            <input
              type="text"
              placeholder={tr('Search in subject, group, classroom, teacher, notes...')}
              className="field ps-7 text-[11.5px]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default StudentHistory
