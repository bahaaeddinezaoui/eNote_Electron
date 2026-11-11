import React, { useState, useEffect, useMemo } from 'react'
import { formatDateTime as formatDateTimeValue } from '../dateFormat'
import DataTable from './ui/DataTable'
import { dateLocale } from '../scheduleUtils'
import {
  Calendar,
  Search,
  UserX,
  Notebook,
  Users,
  History,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity
} from 'lucide-react'
import { formatDateLong } from '../scheduleUtils'
import { TrendChart, HBarChart, DonutChart, VBarChart } from './historyCharts'
import { PageIntro } from './ui/PageHeader'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import { tr } from '../i18n'

const formatDateTime = (value) => {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (isNaN(d.getTime())) return String(value)
  return formatDateTimeValue(d, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

const GlobalHistory = () => {
  // Data
  const [absences, setAbsences] = useState([])
  const [observations, setObservations] = useState([])
  const [majors, setMajors] = useState([])
  const [teachingGroups, setTeachingGroups] = useState([])
  const [teachers, setTeachers] = useState([])
  const [justifications, setJustifications] = useState([])
  const [motifs, setMotifs] = useState([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters (drive both the SQL query and the analytics)
  const [recordType, setRecordType] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [majorId, setMajorId] = useState('')
  const [teachingGroupId, setTeachingGroupId] = useState('')
  const [instructorId, setInstructorId] = useState('')
  const [justificationId, setJustificationId] = useState('')
  const [motifId, setMotifId] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    loadReferenceData()
  }, [])

  const loadReferenceData = async () => {
    setLoading(true)
    try {
      const [majorsRes, groupsRes, teachersRes, justRes, motifRes] = await Promise.all([
        window.api.getMajors(),
        window.api.getTeachingGroups(),
        window.api.getTeachers(),
        window.api.getAbsenceJustifications(),
        window.api.getObservationMotifs()
      ])
      setMajors(majorsRes?.data || [])
      setTeachingGroups(groupsRes?.data || [])
      setTeachers(teachersRes?.data || [])
      setJustifications(justRes?.data || [])
      setMotifs(motifRes?.data || [])
      await loadHistory()
    } catch (err) {
      console.error('Failed to load reference data', err)
      setError(err.message)
      setLoading(false)
    }
  }

  const loadHistory = async () => {
    setLoading(true)
    setError('')
    try {
      const [absRes, obsRes] = await Promise.all([
        window.api.getGlobalAbsenceHistory({ startDate, endDate, majorId, teachingGroupId, instructorId, justificationId }),
        window.api.getGlobalObservationHistory({ startDate, endDate, majorId, teachingGroupId, instructorId, motifId })
      ])
      setAbsences(absRes?.data || [])
      setObservations(obsRes?.data || [])
    } catch (err) {
      console.error('Failed to load global history', err)
      setError(err.message)
      setAbsences([])
      setObservations([])
    } finally {
      setLoading(false)
    }
  }

  // Reload from the database whenever a server-side filter changes.
  useEffect(() => {
    if (!loading) loadHistory()
  }, [startDate, endDate, majorId, teachingGroupId, instructorId, justificationId, motifId])

  // ---- Client-side search over the loaded records -------------------------
  const matchesSearch = (row) => {
    if (!searchTerm) return true
    const haystack = [
      row.STUDENT_NAME, row.MAJOR_LABEL, row.TEACHING_GROUP_LABEL,
      row.CLASSROOM_LABEL, row.INSTRUCTOR_NAME, row.STUDY_WEEK_LABEL,
      row.TEACHER_ABSENCE_NOTE, row.TEACHER_OBSERVATION_NOTE,
      row.STUDY_SESSION_TYPE_LABEL, row.ABSENCE_JUSTIFICATION_LABEL,
      row.OBSERVATION_MOTIF_LABEL
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(searchTerm.toLowerCase())
  }

  const filteredAbsences = useMemo(
    () => (recordType === 'observations' ? [] : absences.filter(matchesSearch)),
    [absences, recordType, searchTerm]
  )
  const filteredObservations = useMemo(
    () => (recordType === 'absences' ? [] : observations.filter(matchesSearch)),
    [observations, recordType, searchTerm]
  )
  const filteredCount = filteredAbsences.length + filteredObservations.length

  // ---- Analytics ----------------------------------------------------------
  const analytics = useMemo(() => {
    const toKey = (dateValue) => {
      if (!dateValue) return null
      const d = dateValue instanceof Date ? dateValue : new Date(String(dateValue))
      return isNaN(d.getTime()) ? null : d
    }

    const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const monthLabel = (d) => d.toLocaleDateString(dateLocale(), { month: 'short', year: '2-digit' })

    const dates = [
      ...filteredAbsences.map(a => toKey(a.STUDY_DAY_DATE)),
      ...filteredObservations.map(o => toKey(o.OBSERVATION_DATETIME))
    ].filter(Boolean)

    // Month buckets spanning the data (capped at 12 for readability).
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

    // Weekday distribution of absences.
    const weekdayNames = [tr('Sun'), tr('Mon'), tr('Tue'), tr('Wed'), tr('Thu'), tr('Fri'), tr('Sat')]
    const absByWeekday = new Array(7).fill(0)
    filteredAbsences.forEach(a => {
      const d = toKey(a.STUDY_DAY_DATE)
      if (d) absByWeekday[d.getDay()]++
    })

    const countBy = (rows, field) => {
      const map = new Map()
      rows.forEach(r => {
        const key = r[field] || tr('Unknown')
        map.set(key, (map.get(key) || 0) + 1)
      })
      return [...map.entries()].sort((a, b) => b[1] - a[1])
    }

    // Per-student ranking (most absent / most observed).
    const absByStudent = countBy(filteredAbsences.map(a => ({ STUDENT_NAME: a.STUDENT_NAME })), 'STUDENT_NAME')
    const obsByStudent = countBy(filteredObservations.map(o => ({ STUDENT_NAME: o.STUDENT_NAME })), 'STUDENT_NAME')

    const topMajors = countBy(filteredAbsences.map(a => ({ MAJOR_LABEL: a.MAJOR_LABEL })), 'MAJOR_LABEL').slice(0, 6)
    const topGroups = countBy(filteredAbsences.map(a => ({ TEACHING_GROUP_LABEL: a.TEACHING_GROUP_LABEL })), 'TEACHING_GROUP_LABEL').slice(0, 6)
    const topTeachers = countBy([
      ...filteredAbsences.map(a => ({ name: a.INSTRUCTOR_NAME })),
      ...filteredObservations.map(o => ({ name: o.INSTRUCTOR_NAME }))
    ], 'name').slice(0, 6)
    const motifCounts = countBy(filteredObservations.map(o => ({ OBSERVATION_MOTIF_LABEL: o.OBSERVATION_MOTIF_LABEL })), 'OBSERVATION_MOTIF_LABEL')
    const justificationCounts = countBy(filteredAbsences.map(a => ({ ABSENCE_JUSTIFICATION_LABEL: a.ABSENCE_JUSTIFICATION_LABEL })), 'ABSENCE_JUSTIFICATION_LABEL')

    const unexcused = filteredAbsences.filter(a => a.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED').length
    const excused = filteredAbsences.length - unexcused

    // Distinct students affected in the selection.
    const affectedStudents = new Set([
      ...filteredAbsences.map(a => a.STUDENT_NAME),
      ...filteredObservations.map(o => o.STUDENT_NAME)
    ]).size

    // Trend: recent half vs earlier half of the month window.
    const half = Math.floor(months.length / 2)
    const sumRange = (from, to) => months.slice(from, to).reduce((s, m) => s + absByMonth.get(monthOf(m)), 0)
    const recentHalf = sumRange(half, months.length)
    const earlierHalf = sumRange(0, half)
    let trendDelta = 0
    if (earlierHalf > 0) trendDelta = Math.round(((recentHalf - earlierHalf) / earlierHalf) * 100)
    else if (recentHalf > 0) trendDelta = 100

    // Worst month & riskiest weekday.
    let worstMonth = null
    months.forEach(m => {
      const v = absByMonth.get(monthOf(m))
      if (v > 0 && (!worstMonth || v > worstMonth.value)) worstMonth = { label: monthLabel(m), value: v }
    })
    let riskWeekday = null
    absByWeekday.forEach((v, i) => {
      if (v > 0 && (!riskWeekday || v > riskWeekday.value)) riskWeekday = { name: weekdayNames[i], value: v }
    })

    const activeMonths = months.filter(m => absByMonth.get(monthOf(m)) + obsByMonth.get(monthOf(m)) > 0).length
    const avgAbsPerMonth = activeMonths > 0 ? Math.round((filteredAbsences.length / activeMonths) * 10) / 10 : 0

    // Teacher note coverage.
    const noted = [
      ...filteredAbsences.filter(a => a.TEACHER_ABSENCE_NOTE),
      ...filteredObservations.filter(o => o.TEACHER_OBSERVATION_NOTE)
    ].length
    const noteCoverage = filteredCount > 0 ? Math.round((noted / filteredCount) * 100) : 0

    return {
      months, monthLabel,
      absSeries: months.map(m => absByMonth.get(monthOf(m))),
      obsSeries: months.map(m => obsByMonth.get(monthOf(m))),
      monthLabels: months.map(m => monthLabel(m)),
      weekdayBars: weekdayNames.map((name, i) => ({ label: name, value: absByWeekday[i] })),
      absByStudent, obsByStudent, topMajors, topGroups, topTeachers,
      motifCounts, justificationCounts,
      unexcused, excused, affectedStudents,
      trendDelta, worstMonth, riskWeekday, avgAbsPerMonth, noteCoverage
    }
  }, [filteredAbsences, filteredObservations, filteredCount])

  const resetFilters = () => {
    setRecordType('all')
    setStartDate('')
    setEndDate('')
    setMajorId('')
    setTeachingGroupId('')
    setInstructorId('')
    setJustificationId('')
    setMotifId('')
    setSearchTerm('')
  }

  const hasActiveFilters =
    recordType !== 'all' || startDate || endDate || majorId || teachingGroupId ||
    instructorId || justificationId || motifId || searchTerm

  const TrendIcon = analytics.trendDelta > 0 ? TrendingUp : analytics.trendDelta < 0 ? TrendingDown : Minus

  const filterCount = (recordType !== 'all' ? 1 : 0) +
    [startDate, endDate, majorId, teachingGroupId, instructorId, justificationId, motifId].filter(Boolean).length

  return (
    <div className="space-y-6">
      {/* Page header */}
      <PageIntro
        kicker={tr('Records')}
        title={tr('Global Records History')}
        meta={`${filteredCount} ${tr('records')}`}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{tr("All students' absences and observations with cross-cutting analytics")}</p>
      </PageIntro>

      {/* The filters open from the toolbar; only the search is always
          visible. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={13} />
          <input
            type="text"
            placeholder={tr("Search by student, subject, group, classroom, notes...")}
            aria-label={tr('Search records')}
            className="field h-7 w-full ps-8 text-[11.5px]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      <FilterBar
        activeCount={filterCount}
        onClear={resetFilters}
        matchCount={filteredCount}
        matchLabel="record"
        title={tr('Filter records')}
      >
        <FilterField label={tr('Records')}>
          <select
            className={filterInputCls}
            value={recordType}
            onChange={(e) => setRecordType(e.target.value)}
            aria-label={tr('Filter by record type')}
          >
            <option value="all">{tr('All')}</option>
            <option value="absences">{tr('Absences')}</option>
            <option value="observations">{tr('Observations')}</option>
          </select>
        </FilterField>
        <FilterField label={tr('From')}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={filterInputCls} aria-label={tr('From date')} />
        </FilterField>
        <FilterField label={tr('To')}>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={filterInputCls} aria-label={tr('To date')} />
        </FilterField>
        <FilterField label={tr('Major')}>
          <select className={filterInputCls} value={majorId} onChange={(e) => setMajorId(e.target.value)} aria-label={tr('Filter by major')}>
            <option value="">{tr('All majors')}</option>
            {majors.map(m => (
              <option key={m.MAJOR_ID} value={m.MAJOR_ID}>{m.MAJOR_LABEL}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tr('Group')}>
          <select className={filterInputCls} value={teachingGroupId} onChange={(e) => setTeachingGroupId(e.target.value)} aria-label={tr('Filter by group')}>
            <option value="">{tr('All groups')}</option>
            {teachingGroups.map(g => (
              <option key={g.TEACHING_GROUP_ID} value={g.TEACHING_GROUP_ID}>{g.TEACHING_GROUP_LABEL}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tr('Teacher')}>
          <select className={filterInputCls} value={instructorId} onChange={(e) => setInstructorId(e.target.value)} aria-label={tr('Filter by teacher')}>
            <option value="">{tr('All teachers')}</option>
            {teachers.map(t => (
              <option key={t.PERSON_ID} value={t.PERSON_ID}>
                {t.PERSON_FIRST_NAME} {t.PERSON_LAST_NAME}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tr('Justification')}>
          <select
            className={filterInputCls}
            value={justificationId}
            onChange={(e) => setJustificationId(e.target.value)}
            aria-label={tr('Filter by justification')}
            disabled={recordType === 'observations' || justifications.length === 0}
          >
            <option value="">{tr('All justifications')}</option>
            {justifications.map(j => (
              <option key={j.ABSENCE_JUSTIFICATION_ID} value={j.ABSENCE_JUSTIFICATION_ID}>
                {j.ABSENCE_JUSTIFICATION_LABEL}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label={tr('Motif')}>
          <select
            className={filterInputCls}
            value={motifId}
            onChange={(e) => setMotifId(e.target.value)}
            aria-label={tr('Filter by motif')}
            disabled={recordType === 'absences' || motifs.length === 0}
          >
            <option value="">{tr('All motifs')}</option>
            {motifs.map(m => (
              <option key={m.OBSERVATION_MOTIF_ID} value={m.OBSERVATION_MOTIF_ID}>
                {m.OBSERVATION_MOTIF_LABEL}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>
        <span className="mono ms-auto text-[10.5px] text-ink-3">{filteredCount} {tr('records')}</span>
      </div>

      {error && (
        <div className="bg-danger-bg border border-danger/20 text-danger-ink rounded-md p-4 text-[12.5px] font-semibold">{tr("Failed to load history:")}{' '}{error}
        </div>
      )}

      {/* Stats banner */}
      <div className="bg-raised text-ink rounded-[4px] p-6 relative overflow-hidden">
        <div className="absolute right-0 bottom-0 opacity-10 translate-x-12 translate-y-12">
          <Activity size={220} className="text-ink" />
        </div>

        <div className="relative z-10">
          <div className="inline-flex items-center space-x-2 bg-surface text-ink-2 border border-line px-3 py-1 rounded-full kicker mb-4">
            {hasActiveFilters ? tr('Filtered View') : tr('All Records')}
            <span className="text-ink-3">·</span>
            <span>{filteredCount}{' '}{tr("records")}</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-surface-muted border border-line rounded-md px-4 py-3 text-center">
              <div className="text-2xl font-black text-danger-ink">{filteredAbsences.length}</div>
              <div className="text-[10px] text-ink-3 font-semibold uppercase tracking-wider mt-0.5">{tr("Absences")}</div>
            </div>
            <div className="bg-surface-muted border border-line rounded-md px-4 py-3 text-center">
              <div className="text-2xl font-black text-ink-2">{filteredObservations.length}</div>
              <div className="text-[10px] text-ink-3 font-semibold uppercase tracking-wider mt-0.5">{tr("Observations")}</div>
            </div>
            <div className="bg-surface-muted border border-line rounded-md px-4 py-3 text-center">
              <div className="text-2xl font-black text-ink-2">{analytics.affectedStudents}</div>
              <div className="text-[10px] text-ink-3 font-semibold uppercase tracking-wider mt-0.5">{tr("Students")}</div>
            </div>
            <div className="bg-surface-muted border border-line rounded-md px-4 py-3 text-center">
              <div className="text-2xl font-black text-warning-ink">{analytics.unexcused}</div>
              <div className="text-[10px] text-ink-3 font-semibold uppercase tracking-wider mt-0.5">{tr("Unexcused")}</div>
            </div>
            <div className="bg-surface-muted border border-line rounded-md px-4 py-3 text-center">
              <div className="text-2xl font-black text-jade-600">{analytics.avgAbsPerMonth}</div>
              <div className="text-[10px] text-ink-3 font-semibold uppercase tracking-wider mt-0.5">{tr("Avg abs / month")}</div>
            </div>
            <div className="bg-surface-muted border border-line rounded-md px-4 py-3 text-center">
              <div className={`text-2xl font-black inline-flex items-center gap-1 ${analytics.trendDelta > 0 ? 'text-danger-ink' : analytics.trendDelta < 0 ? 'text-success-ink' : 'text-ink-3'}`}>
                <TrendIcon size={18} />
                {analytics.trendDelta === 0 ? '—' : `${Math.abs(analytics.trendDelta)}%`}
              </div>
              <div className="text-[10px] text-ink-3 font-semibold uppercase tracking-wider mt-0.5">{tr("Trend")}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics dashboard */}
      <div className="bg-surface rounded-[4px] border border-line overflow-hidden">
        <div className="p-5 border-b border-line bg-surface-muted">
          <h5 className="kicker">{tr("Analytics")}</h5>
          <p className="text-[11px] text-ink-3 font-medium mt-0.5">{tr("Charts and stats computed from the")}{' '}{filteredCount}{' '}{tr("record")}{filteredCount === 1 ? '' : 's'}{' '}{tr("matching the active filters")}</p>
        </div>

        {filteredCount === 0 ? (
          <div className="p-10 text-center">
            <div className="mx-auto w-14 h-14 bg-surface-muted rounded-md flex items-center justify-center mb-4">
              <History size={24} className="text-ink-3" />
            </div>
            <h4 className="text-[12.5px] font-semibold text-ink-3">
              {loading ? tr('Loading records...') : tr('No Records Match Your Filters')}
            </h4>
            {!loading && (
              <p className="text-[12.5px] text-ink-3 font-medium mt-2 max-w-md mx-auto leading-relaxed">{tr("Try widening the date range or resetting the filters.")}</p>
            )}
          </div>
        ) : (
          <div className="p-5 space-y-6">
            {/* Monthly trend */}
            <div className="border border-line rounded-md p-4">
              <h6 className="kicker mb-2">{tr("Monthly Trend (all students)")}</h6>
              <TrendChart
                labels={analytics.monthLabels}
                series={[
                  { name: tr('Absences'), color: 'var(--color-danger)', values: analytics.absSeries },
                  { name: tr('Observations'), color: 'var(--color-jade-500)', values: analytics.obsSeries }
                ]}
              />
              <div className="flex items-center gap-4 mt-2 text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1.5 text-danger-ink"><span className="w-3 h-0.5 bg-danger rounded" />{tr("Absences")}</span>
                <span className="inline-flex items-center gap-1.5 text-ink-2"><span className="w-3 h-0.5 bg-jade-500 rounded" />{tr("Observations")}</span>
              </div>
            </div>

            {/* Weekday + justification donut */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Absences by Weekday")}</h6>
                <VBarChart data={analytics.weekdayBars} height={180} />
              </div>
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Justification Split")}</h6>
                <DonutChart
                  data={[
                    { label: tr('Unexcused'), value: analytics.unexcused, color: 'var(--color-warning)' },
                    { label: tr('Excused'), value: analytics.excused, color: 'var(--color-jade-600)' }
                  ]}
                  centerLabel="ABSENCES"
                />
              </div>
            </div>

            {/* Student rankings */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Most Absent Students")}</h6>
                <HBarChart data={analytics.absByStudent.slice(0, 8).map(([label, value]) => ({ label, value, color: 'var(--color-danger)' }))} />
              </div>
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Most Observed Students")}</h6>
                <HBarChart data={analytics.obsByStudent.slice(0, 8).map(([label, value]) => ({ label, value, color: 'var(--color-jade-500)' }))} />
              </div>
            </div>

            {/* Majors / groups / teachers */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Most Affected Majors")}</h6>
                <HBarChart data={analytics.topMajors.map(([label, value]) => ({ label, value, color: 'var(--color-danger)' }))} />
              </div>
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Most Affected Groups")}</h6>
                <HBarChart data={analytics.topGroups.map(([label, value]) => ({ label, value, color: 'var(--color-warning)' }))} />
              </div>
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Teachers Involved")}</h6>
                <HBarChart data={analytics.topTeachers.map(([label, value]) => ({ label, value, color: 'var(--color-jade-500)' }))} />
              </div>
            </div>

            {filteredObservations.length > 0 && (
              <div className="border border-line rounded-md p-4">
                <h6 className="kicker mb-3">{tr("Observation Motifs")}</h6>
                <HBarChart data={analytics.motifCounts.map(([label, value]) => ({ label, value, color: 'var(--color-jade-500)' }))} />
              </div>
            )}

            {/* Advanced stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-surface-muted border border-line rounded-md px-4 py-3">
                <div className="kicker text-ink-3">{tr("Worst month")}</div>
                <div className="text-[12.5px] font-semibold text-ink-3 mt-1">
                  {analytics.worstMonth ? `${tr(analytics.worstMonth.label)} (${analytics.worstMonth.value} absences)` : '—'}
                </div>
              </div>
              <div className="bg-surface-muted border border-line rounded-md px-4 py-3">
                <div className="kicker text-ink-3">{tr("Riskiest weekday")}</div>
                <div className="text-[12.5px] font-semibold text-ink-3 mt-1">
                  {analytics.riskWeekday ? `${analytics.riskWeekday.name} (${analytics.riskWeekday.value})` : '—'}
                </div>
              </div>
              <div className="bg-surface-muted border border-line rounded-md px-4 py-3">
                <div className="kicker text-ink-3">{tr("Unexcused rate")}</div>
                <div className="text-[12.5px] font-semibold text-ink-3 mt-1">
                  {filteredAbsences.length > 0 ? `${Math.round((analytics.unexcused / filteredAbsences.length) * 100)}%` : '—'}
                </div>
              </div>
              <div className="bg-surface-muted border border-line rounded-md px-4 py-3">
                <div className="kicker text-ink-3">{tr("Teacher note coverage")}</div>
                <div className="text-[12.5px] font-semibold text-ink-3 mt-1">{analytics.noteCoverage}%</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Detailed records timeline */}
      <div className="bg-surface rounded-[4px] border border-line overflow-hidden">
        <div className="p-5 border-b border-line bg-surface-muted">
          <h5 className="kicker">{tr("Records")}</h5>
          <p className="text-[11px] text-ink-3 font-medium mt-0.5">{tr("Detailed list of the matching absences and observations")}</p>
        </div>

        {loading ? (
          <div className="p-12 text-center text-ink-3 font-semibold">{tr("Loading records...")}</div>
        ) : filteredCount === 0 ? (
          <div className="p-10 text-center text-ink-3 font-medium text-[12.5px]">{tr("No records match the active filters.")}</div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              bodyClassName="divide-y divide-line text-[12.5px]"
              className="w-full text-left border-collapse"
              headClassName="bg-surface-muted border-b border-line text-ink-3 uppercase text-[10px] font-semibold tracking-wider"
              columns={[
                { key: 'c0', className: "px-5 py-3", header: <>{tr("Type")}</> },
                { key: 'c1', className: "px-5 py-3", header: <>{tr("Student")}</> },
                { key: 'c2', className: "px-5 py-3", header: <>{tr("Date")}</> },
                { key: 'c3', className: "px-5 py-3", header: <>{tr("Major / Group")}</> },
                { key: 'c4', className: "px-5 py-3", header: <>{tr("Teacher")}</> },
                { key: 'c5', className: "px-5 py-3", header: <>{tr("Detail")}</> },
              ]}
            >
                {[
                  ...filteredAbsences.map(a => ({
                    kind: 'absence',
                    key: `abs-${a.PERSON_ID}-${a.STUDY_SESSION_ID}`,
                    sortDate: `${String(a.STUDY_DAY_DATE || '').substring(0, 10)} ${a.STUDY_SESSION_START_TIME || ''}`,
                    row: a
                  })),
                  ...filteredObservations.map(o => ({
                    kind: 'observation',
                    key: `obs-${o.PERSON_ID}-${o.STUDY_SESSION_ID}-${o.OBSERVATION_MOTIF_ID}-${o.OBSERVATION_DATETIME}`,
                    sortDate: String(o.OBSERVATION_DATETIME || ''),
                    row: o
                  }))
                ].sort((x, y) => String(y.sortDate).localeCompare(String(x.sortDate)))
                  .map(({ kind, key, row }) => {
                    const isAbsence = kind === 'absence'
                    const dayStr = row.STUDY_DAY_DATE ? String(row.STUDY_DAY_DATE).substring(0, 10) : ''
                    return (
                      <tr key={key} className="transition-colors hover:bg-surface-muted">
                        <td className="px-5 py-3">
                          <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-semibold uppercase border inline-flex items-center gap-1 ${
                            isAbsence
                              ? 'bg-danger-bg border-danger/20 text-danger-ink'
                              : 'bg-selection border-line-strong text-ink-2'
                          }`}>
                            {isAbsence ? <UserX size={11} /> : <Notebook size={11} />}
                            {isAbsence ? 'ABSENCE' : 'OBSERVATION'}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-semibold text-ink-3">{row.STUDENT_NAME}</td>
                        <td className="px-5 py-3 text-ink-3 text-[11px] font-medium">
                          <div className="inline-flex items-center gap-1.5">
                            <Calendar size={12} className="text-ink-3" />
                            {isAbsence
                              ? <>
                                  {formatDateLong(dayStr)} · {(row.STUDY_SESSION_START_TIME || '').substring(0, 5)}
                                </>
                              : formatDateTime(row.OBSERVATION_DATETIME)}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-[11px] font-semibold text-ink-3">
                          {row.MAJOR_LABEL || '—'}
                          {row.TEACHING_GROUP_LABEL && (
                            <span className="inline-flex items-center gap-1 ml-2 text-ink-3">
                              <Users size={11} />{row.TEACHING_GROUP_LABEL}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-[11px] font-medium text-ink-3">{row.INSTRUCTOR_NAME || '—'}</td>
                        <td className="px-5 py-3">
                          {isAbsence ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-semibold border ${
                                row.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED'
                                  ? 'bg-warning-bg border-warning/30 text-warning-ink'
                                  : 'bg-selection border-line-strong text-ink-2'
                              }`}>
                                {row.ABSENCE_JUSTIFICATION_LABEL}
                              </span>
                              {row.TEACHER_ABSENCE_NOTE && (
                                <span className="text-[11px] text-ink-3 italic truncate max-w-[220px]" title={row.TEACHER_ABSENCE_NOTE}>
                                  “{row.TEACHER_ABSENCE_NOTE}”
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="px-2 py-0.5 rounded-[4px] text-[10px] font-semibold border bg-surface-muted border-line text-ink-3">
                                {row.OBSERVATION_MOTIF_LABEL}
                              </span>
                              {row.TEACHER_OBSERVATION_NOTE && (
                                <span className="text-[11px] text-ink-3 italic truncate max-w-[220px]" title={row.TEACHER_OBSERVATION_NOTE}>
                                  “{row.TEACHER_OBSERVATION_NOTE}”
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
            </DataTable>
          </div>
        )}
      </div>
    </div>
  )
}

export default GlobalHistory
