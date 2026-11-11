import React, { useState, useEffect } from 'react'
import { pickCurrentYearId, pickCurrentSemesterId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { Award, BarChart3, Calendar, Clock, FileText, Hash } from 'lucide-react'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'

// My Marks — the student's view of their results. For the selected semester:
//   - every exam they were seated in, with the mark obtained, the exam's
//     factor, its major and type;
//   - the weighted average per major (exam factors count);
//   - the semester mark (major factors — defined by the admin on the Majors
//     page — count). Unmarked exams don't drag the average down: a major is
//     averaged over the exams marked so far.

const StudentMarks = ({ user }) => {
  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')

  // Follow the current year/semester while the page stays open.
  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester }
  ])

  const [marks, setMarks] = useState(null) // { data, majorMarks, semesterMark, gradedMajors }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const res = await window.api.getStudyYears()
        const data = res?.data || []
        setYears(data)
        if (data.length > 0) setSelectedYear(pickCurrentYearId(data))
      } catch (err) {
        console.error('Failed to load years', err)
      }
    })()
  }, [])

  useEffect(() => {
    if (!selectedYear) {
      setSemesters([])
      setSelectedSemester('')
      return
    }
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
    if (!user?.personId || !selectedSemester) {
      setMarks(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const res = await window.api.getStudentMarks(user.personId, selectedSemester)
        if (cancelled) return
        setMarks(res)
      } catch (err) {
        console.error('Failed to load marks', err)
        if (!cancelled) {
          setMarks(null)
          setError(err.message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [user?.personId, selectedSemester])

  const examRows = marks?.data || []
  const majorMarks = marks?.majorMarks || []
  const semesterMark = marks?.semesterMark != null ? Number(marks.semesterMark) : null
  const markedExams = examRows.filter(r => r.FINAL_MARK != null)

  const MarkBadge = ({ value, size = 'text-sm' }) => {
    if (value == null) return <span className="text-ink-3">—</span>
    const n = Number(value)
    return (
      <span className={`${size} font-bold px-2 py-0.5 rounded ${n >= 10 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
        {n.toFixed(2)}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      <PageIntro
        kicker={tr('Marks')}
        title={tr("My Marks")}
        actions={
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-xl border border-line">
          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-ink-3 uppercase ml-1 mb-1">{tr("Year")}</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-surface-muted border border-line text-ink-2 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 p-2"
            >
              {years.map(y => (
                <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>{y.STUDY_YEAR_LABEL}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] font-bold text-ink-3 uppercase ml-1 mb-1">{tr("Semester")}</label>
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="bg-surface-muted border border-line text-ink-2 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 p-2"
              disabled={!selectedYear}
            >
              {semesters.length === 0 && <option value="">{tr("No semesters")}</option>}
              {semesters.map(s => (
                <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>{s.STUDY_SEMESTER_LABEL}</option>
              ))}
            </select>
          </div>
        </div>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{tr("Your exam marks, major averages and semester mark")}</p>
      </PageIntro>

      {error && (
        <div className="rounded-xl border p-3 text-sm flex items-center gap-2 bg-red-50 border-red-200 text-red-800">
          <Award size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-line p-8 text-center text-ink-3">{tr("Loading your marks…")}</div>
      ) : !selectedSemester ? (
        <div className="bg-white rounded-xl border border-line p-8 text-center text-ink-3">{tr("Select a semester to see your marks.")}</div>
      ) : examRows.length === 0 ? (
        <div className="bg-white rounded-xl border border-line p-8 text-center text-ink-3">
          <Award size={28} className="mx-auto mb-2 text-ink-3" />{' '}{tr("No exam marks are available for this semester yet — they appear as soon as your teachers enter them.")}</div>
      ) : (
        <>
          {/* Semester summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-5 text-white">
              <div className="text-[11px] font-bold uppercase tracking-wider text-blue-100">{tr("Semester Mark")}</div>
              <div className="text-4xl font-bold mt-1">
                {semesterMark != null ? semesterMark.toFixed(2) : '—'}
                <span className="text-lg font-medium text-blue-200"> / 20</span>
              </div>
              <div className="text-xs text-blue-100 mt-1">{tr("Weighted average of your major marks")}</div>
            </div>
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-3">{tr("Exams Marked")}</div>
              <div className="text-4xl font-bold mt-1 text-ink">
                {markedExams.length}
                <span className="text-lg font-medium text-ink-3"> / {examRows.length}</span>
              </div>
              <div className="text-xs text-ink-3 mt-1">{tr("Exams you sat this semester")}</div>
            </div>
            <div className="bg-white rounded-xl border border-line p-5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-3">{tr("Passed (≥ 10)")}</div>
              <div className="text-4xl font-bold mt-1 text-ink">
                {markedExams.filter(r => Number(r.FINAL_MARK) >= 10).length}
                <span className="text-lg font-medium text-ink-3"> / {markedExams.length || 0}</span>
              </div>
              <div className="text-xs text-ink-3 mt-1">{tr("Exams with a passing mark")}</div>
            </div>
          </div>

          {/* Major averages */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-ink-2">
              <BarChart3 size={16} className="text-blue-600" />{' '}{tr("My major averages")}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {majorMarks.map(mm => {
                const mark = mm.MAJOR_MARK != null ? Number(mm.MAJOR_MARK) : null
                return (
                  <div key={mm.MAJOR_ID} className="bg-white rounded-xl border border-line p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink truncate">{mm.MAJOR_LABEL}</span>
                      <MarkBadge value={mark} size="text-lg" />
                    </div>
                    <div className="text-xs text-ink-3 mt-1.5">{tr("Weight ×")}{Number(mm.MAJOR_FACTOR)}{' '}{tr("in the semester ·")}{' '}{mm.MARKED_EXAMS}/{mm.TOTAL_EXAMS}{' '}{tr("exams marked")}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Exam detail */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-ink-2">
              <FileText size={16} className="text-blue-600" />{' '}{tr("My exam marks")}</div>
            <div className="bg-white rounded-xl border border-line overflow-hidden">
              <table className="min-w-full divide-y divide-line">
                <thead className="bg-surface-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-bold text-ink-3 uppercase">{tr("Exam")}</th>
                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-bold text-ink-3 uppercase">{tr("Major")}</th>
                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-bold text-ink-3 uppercase">{tr("Type")}</th>
                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-bold text-ink-3 uppercase">
                      <span className="inline-flex items-center gap-1"><Calendar size={11} />{' '}{tr("Date")}</span>
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-bold text-ink-3 uppercase">
                      <span className="inline-flex items-center gap-1"><Hash size={11} />{' '}{tr("Factor")}</span>
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-[10px] font-bold text-ink-3 uppercase">{tr("Mark")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {examRows.map(row => {
                    const mark = row.FINAL_MARK != null ? Number(row.FINAL_MARK) : null
                    return (
                      <tr key={row.EXAMINATION_ID} className="hover:bg-surface-muted/70">
                        <td className="px-4 py-2.5 text-sm font-semibold text-ink">
                          {row.EXAMINATION_CODE ? `${row.EXAMINATION_CODE} — ` : ''}{row.EXAMINATION_LABEL}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-ink-2">{row.MAJOR_LABEL || '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-ink-2">{row.EXAMINATION_TYPE_LABEL || '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-ink-2">
                          {row.EXAMINATION_START_DATETIME
                            ? <span className="inline-flex items-center gap-1"><Clock size={11} className="text-ink-3" />{String(row.EXAMINATION_START_DATETIME).replace('T', ' ')}</span>
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-ink-2">×{Number(row.EXAMINATION_FACTOR)}</td>
                        <td className="px-4 py-2.5"><MarkBadge value={mark} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default StudentMarks
