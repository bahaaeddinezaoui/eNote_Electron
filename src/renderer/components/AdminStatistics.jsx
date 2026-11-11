import React, { useState, useEffect, useMemo } from 'react'
import {
  BarChart3, Users, GraduationCap, DoorOpen, FileText, CalendarDays,
  UserX, Trophy, TrendingUp, Percent, Search, Gavel, Award
} from 'lucide-react'
import { TrendChart, HBarChart, DonutChart, VBarChart } from './historyCharts'
import { pickCurrentYearId, pickCurrentSemesterId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'
import { personNameLastFirst } from '../../shared/personNames'

// Admin Statistics — institution-wide counts plus semester analytics:
// per-person semester averages, mark distribution, students per major,
// absences by justification and the gender split. Charts are the
// dependency-free SVG components from historyCharts.jsx.

const StatCard = ({ icon: Icon, label, value, sub, color = 'blue' }) => {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
    red: 'bg-red-50 text-red-600',
    indigo: 'bg-indigo-50 text-indigo-600'
  }
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-[3px] ${colors[color]}`}>
        <Icon size={14} />
      </div>
      <div className="min-w-0">
        <div className="kicker text-[9px]">{label}</div>
        <div className="figure text-[19px] leading-tight text-ink">{value}</div>
        {sub && <div className="mt-0.5 text-[10.5px] text-ink-3">{sub}</div>}
      </div>
    </div>
  )
}

const ChartCard = ({ icon: Icon, title, children }) => (
  <div className="rounded-md border border-line bg-surface p-3">
    <div className="mb-2 flex items-center gap-1.5 border-b border-line pb-2">
      {Icon && <Icon size={12} className="text-ink-3" />}
      <h4 className="kicker">{title}</h4>
    </div>
    {children}
  </div>
)

const AdminStatistics = ({ user }) => {
  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [stats, setStats] = useState(null)

  // Statistics follow the current period when the page is left open.
  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester }
  ])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await window.api.getStudyYears()
        const y = res?.data || []
        setYears(y)
        if (y.length > 0) setSelectedYear(pickCurrentYearId(y))
      } catch (err) {
        console.error('Failed to load years', err)
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (!selectedYear) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.api.getStudySemesters(selectedYear)
        if (cancelled) return
        const data = res?.data || []
        setSemesters(data)
        setSelectedSemester(data.length > 0 ? pickCurrentSemesterId(data) : '')
      } catch (err) {
        console.error('Failed to load semesters', err)
      }
    })()
    return () => { cancelled = true }
  }, [selectedYear])

  useEffect(() => {
    if (!selectedSemester) {
      setStats(null)
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await window.api.getAdminStatistics(selectedSemester)
        if (cancelled) return
        setStats(res?.data ?? res)
      } catch (err) {
        console.error('Failed to load admin statistics', err)
        if (!cancelled) setStats(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [selectedSemester])

  const filteredAverages = useMemo(() => {
    if (!stats?.personAverages) return []
    const q = search.trim().toLowerCase()
    if (!q) return stats.personAverages
    return stats.personAverages.filter(r =>
      `${r.PERSON_FIRST_NAME} ${r.PERSON_LAST_NAME}`.toLowerCase().includes(q)
    )
  }, [stats, search])

  const semesterMarkValues = (stats?.personAverages || [])
    .filter(r => r.SEMESTER_MARK != null)
    .map(r => r.SEMESTER_MARK)

  // Trend of the top 10 students' semester marks (the closest thing to a
  // ranking curve; sorted best-first, so it reads like a class leaderboard).
  const topSeries = useMemo(() => {
    const ranked = (stats?.personAverages || [])
      .filter(r => r.SEMESTER_MARK != null)
      .slice(0, 10)
    if (ranked.length === 0) return []
    return [{
      name: tr('Semester mark'),
      color: 'var(--color-jade-500)',
      values: ranked.map(r => Number(r.SEMESTER_MARK.toFixed(2)))
    }]
  }, [stats])

  const topLabels = useMemo(() => {
    return (stats?.personAverages || [])
      .filter(r => r.SEMESTER_MARK != null)
      .slice(0, 10)
      .map(r => `${r.PERSON_LAST_NAME.slice(0, 8)}`)
  }, [stats])

  // Two of the four are the palette's own signal colours, so they follow the
  // accent; the other two are categorical hues that must stay apart.
  const distributionColors = ['var(--color-ember-solid)', '#dfa45c', '#6fa8a0', 'var(--color-jade-600)']

  if (loading && !stats) {
    return (
      <div className="space-y-6">
      <PageIntro kicker={tr('Analytics')} title={tr('Statistics & Analytics')} />
      <div className="rounded-md border border-line bg-surface p-12 text-center text-[12px] text-ink-3">{tr('Loading statistics…')}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageIntro
        kicker={tr('Analytics')}
        title={tr('Statistics & Analytics')}
        actions={
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-col">
            <label className="kicker ml-1 mb-1">{tr("Year")}</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-surface-muted border border-line text-ink-2 text-[12.5px] rounded-md focus:ring-blue-500 focus:border-blue-500 p-2"
            >
              {years.map(y => (
                <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>{y.STUDY_YEAR_LABEL}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col">
            <label className="kicker ml-1 mb-1">{tr("Semester")}</label>
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="bg-surface-muted border border-line text-ink-2 text-[12.5px] rounded-md focus:ring-blue-500 focus:border-blue-500 p-2"
              disabled={!selectedYear}
            >
              {semesters.map(s => (
                <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>{s.STUDY_SEMESTER_LABEL}</option>
              ))}
            </select>
          </div>
        </div>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{tr('Institution-wide statistics and per-semester analytics')}</p>
      </PageIntro>

      {!stats ? (
        <div className="bg-white rounded-md border border-line p-12 text-center text-ink-3">
          <BarChart3 size={28} className="mx-auto mb-2 text-ink-3" />{' '}{tr("Select a year and a semester to see the analytics.")}</div>
      ) : (
        <>
          {/* Count cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
            <StatCard icon={Users} label={tr("Students")} value={stats.counts.totalStudents} color="blue" />
            <StatCard icon={GraduationCap} label={tr("Teachers")} value={stats.counts.totalTeachers} color="purple" />
            <StatCard icon={FileText} label={tr("Majors")} value={stats.counts.totalMajors} color="indigo" />
            <StatCard icon={DoorOpen} label={tr("Classrooms")} value={stats.counts.totalClassrooms} color="orange" />
            <StatCard icon={CalendarDays} label={tr("Exams")} value={stats.counts.totalExams} color="green" />
            <StatCard icon={TrendingUp} label={tr("Sessions")} value={stats.counts.totalSessions} color="blue" />
            <StatCard icon={UserX} label={tr("Absences")} value={stats.counts.totalAbsences} color="red" />
          </div>

          {stats.semesterScoped ? (
            <>
              {/* Semester headline stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-jade-solid text-on-jade rounded-md p-4 text-white">
                  <div className="kicker text-blue-100">{tr("Overall Semester Average")}</div>
                  <div className="text-3xl font-semibold mt-1">
                    {stats.overallAverage != null ? `${stats.overallAverage.toFixed(2)} / 20` : '—'}
                  </div>
                  <div className="text-[11px] text-blue-100 mt-1">{stats.gradedStudents}{' '}{tr("graded student(s)")}</div>
                </div>
                <div className="bg-white rounded-md border border-line p-4">
                  <div className="kicker flex items-center gap-1">
                    <Percent size={11} />{' '}{tr("Pass rate (semester mark ≥ 10)")}</div>
                  <div className="text-3xl font-semibold text-ink mt-1">
                    {stats.passRate != null ? `${stats.passRate.toFixed(0)}%` : '—'}
                  </div>
                  <div className="w-full h-2 bg-surface-muted rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-jade-solid text-on-jade rounded-full transition-all duration-500"
                      style={{ width: `${stats.passRate ?? 0}%` }}
                    />
                  </div>
                </div>
                <ChartCard icon={Trophy} title={tr("Top 5 students")}>
                  {stats.topStudents.length === 0 ? (
                    <div className="text-[12.5px] text-ink-3 py-4 text-center">{tr("No graded students yet.")}</div>
                  ) : (
                    <ol className="space-y-1.5">
                      {stats.topStudents.map((s, i) => (
                        <li key={s.PERSON_ID} className="flex items-center gap-2 text-[12.5px]">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                            i === 0 ? 'bg-yellow-100 text-yellow-700'
                              : i === 1 ? 'bg-surface-muted text-ink-2'
                              : i === 2 ? 'bg-orange-100 text-orange-700'
                              : 'bg-blue-50 text-blue-500'
                          }`}>{i + 1}</span>
                          <span className="font-semibold text-ink-2 truncate">{personNameLastFirst(s.PERSON_LAST_NAME, s.PERSON_FIRST_NAME)}</span>
                          <span className={`ml-auto font-semibold ${s.SEMESTER_MARK >= 10 ? 'text-green-600' : 'text-red-600'}`}>
                            {s.SEMESTER_MARK.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </ChartCard>
              </div>

              {/* Charts row 1 */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <ChartCard icon={BarChart3} title={tr("Top 10 students — semester marks")}>
                  {topSeries.length === 0 ? (
                    <div className="text-[12.5px] text-ink-3 py-8 text-center">{tr("No marks entered yet.")}</div>
                  ) : (
                    <TrendChart series={topSeries} labels={topLabels} />
                  )}
                </ChartCard>
                <ChartCard icon={BarChart3} title={tr("Exam mark distribution (all exams of the semester)")}>
                  {stats.markDistribution.every(d => d.value === 0) ? (
                    <div className="text-[12.5px] text-ink-3 py-8 text-center">{tr("No marks entered yet.")}</div>
                  ) : (
                    <VBarChart
                      data={stats.markDistribution.map((d, i) => ({ ...d, color: distributionColors[i] }))}
                    />
                  )}
                </ChartCard>
              </div>

              {/* Charts row 2 */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <ChartCard icon={Users} title={tr("Students per major")}>
                  {stats.studentsPerMajor.length === 0 ? (
                    <div className="text-[12.5px] text-ink-3 py-8 text-center">{tr("No enrollments this semester.")}</div>
                  ) : (
                    <HBarChart data={stats.studentsPerMajor} />
                  )}
                </ChartCard>
                <ChartCard icon={UserX} title={tr("Absences by justification (all time)")}>
                  {stats.absencesByJustification.length === 0 ? (
                    <div className="text-[12.5px] text-ink-3 py-8 text-center">{tr("No absences recorded.")}</div>
                  ) : (
                    <DonutChart
                      data={stats.absencesByJustification.map((d, i) => ({
                        ...d,
                        color: ['var(--color-ember-solid)', '#dfa45c', '#6fa8a0', 'var(--color-jade-600)', '#c98d70', '#8a938c'][i % 6]
                      }))}
                    />
                  )}
                </ChartCard>
              </div>

              {/* Conduct by justification: the reason recorded with each entry */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <ChartCard icon={Gavel} title={tr("Punishments by justification (all time)")}>
                  {(stats.punishmentsByJustification || []).length === 0 ? (
                    <div className="text-[12.5px] text-ink-3 py-8 text-center">{tr("No punishments recorded.")}</div>
                  ) : (
                    <HBarChart
                      data={stats.punishmentsByJustification.map((d, i) => ({
                        ...d,
                        color: ['var(--color-ember-solid)', '#dfa45c', '#c98d70', '#8a938c', '#6fa8a0', '#a98b6a'][i % 6]
                      }))}
                    />
                  )}
                </ChartCard>
                <ChartCard icon={Award} title={tr("Rewards by justification (all time)")}>
                  {(stats.rewardsByJustification || []).length === 0 ? (
                    <div className="text-[12.5px] text-ink-3 py-8 text-center">{tr("No rewards recorded.")}</div>
                  ) : (
                    <HBarChart
                      data={stats.rewardsByJustification.map((d, i) => ({
                        ...d,
                        color: ['var(--color-jade-600)', '#6fa8a0', 'var(--color-jade-500)', '#dfa45c', '#c98d70', '#8a938c'][i % 6]
                      }))}
                    />
                  )}
                </ChartCard>
              </div>

              {/* Gender split */}
              <ChartCard icon={Users} title={tr("Students by gender")}>
                {stats.genderSplit.length === 0 ? (
                  <div className="text-[12.5px] text-ink-3 py-8 text-center">{tr("No students registered.")}</div>
                ) : (
                  <DonutChart
                    data={stats.genderSplit.map((d, i) => ({
                      ...d,
                      color: { M: '#6fa8a0', F: 'var(--color-ember-solid)' }[d.label] || '#8a938c'
                    }))}
                  />
                )}
              </ChartCard>

              {/* Per-person semester averages */}
              <div className="bg-white rounded-md border border-line overflow-hidden">
                <div className="p-4 border-b border-line bg-surface-muted flex items-center justify-between gap-4">
                  <h4 className="text-[12.5px] font-semibold text-ink-2 flex items-center gap-2">
                    <GraduationCap size={16} className="text-ink-3" />{' '}{tr("Per-person semester averages (")}{stats.personAverages.length})
                  </h4>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={tr("Search student…")}
                      className="pl-8 pr-3 py-1.5 text-[12.5px] border border-line rounded-md focus:ring-blue-500 focus:border-blue-500 w-56"
                    />
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-line">
                    <thead className="bg-surface-muted sticky top-0">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 text-left kicker">{tr("Rank")}</th>
                        <th scope="col" className="px-4 py-2.5 text-left kicker">{tr("Student")}</th>
                        <th scope="col" className="px-4 py-2.5 text-left kicker">{tr("Majors graded")}</th>
                        <th scope="col" className="px-4 py-2.5 text-left kicker">{tr("Semester average")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {filteredAverages.map((r, i) => {
                        const rank = stats.personAverages.indexOf(r) + 1
                        return (
                          <tr key={r.PERSON_ID} className="hover:bg-surface-muted/70">
                            <td className="px-4 py-2 text-[12.5px] text-ink-3 font-semibold">#{rank}</td>
                            <td className="px-4 py-2 text-[12.5px] font-semibold text-ink">
                              {personNameLastFirst(r.PERSON_LAST_NAME, r.PERSON_FIRST_NAME)}
                            </td>
                            <td className="px-4 py-2 text-[12.5px] text-ink-2">{r.GRADED_MAJORS}</td>
                            <td className="px-4 py-2">
                              <span className={`text-[12.5px] font-semibold px-2 py-0.5 rounded ${
                                r.SEMESTER_MARK == null
                                  ? 'text-ink-3'
                                  : r.SEMESTER_MARK >= 10
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-red-100 text-red-700'
                              }`}>
                                {r.SEMESTER_MARK != null ? r.SEMESTER_MARK.toFixed(2) : '—'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                      {filteredAverages.length === 0 && (
                        <tr>
                          <td colSpan="4" className="px-4 py-6 text-center text-[12.5px] text-ink-3">{tr("No student matches the search.")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-md border border-line p-8 text-center text-ink-3">
              <BarChart3 size={28} className="mx-auto mb-2 text-ink-3" />{' '}{tr("No marks are entered yet for this semester — analytics appear once exam marks are saved.")}</div>
          )}

          {semesterMarkValues.length === 0 && stats.semesterScoped && (
            <div className="flex items-center gap-2 text-[11px] text-ink-3">
              <BarChart3 size={12} />{' '}{tr("Tip: the per-person averages use the same weighting as the Exam Marks page — exam factor within a major, then major semester factor.")}</div>
          )}
        </>
      )}
    </div>
  )
}

export default AdminStatistics
