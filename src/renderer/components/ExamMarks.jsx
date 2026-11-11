import React, { useState, useEffect, useMemo } from 'react'
import { pickCurrentYearId, pickCurrentSemesterId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { Award, Search, Check, X, Save, Users, DoorOpen, Hash, FileKey, AlertCircle, CheckCircle2, BarChart3, ClipboardList, Lock } from 'lucide-react'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'
import { personNameLastFirst } from '../../shared/personNames'
import { usePersistentState } from '../usePersistentState'
import { useBeforeUnload } from '../useUnsavedChanges'
import { useDraft } from '../useDraft'
import { activatableRowProps } from './ui/tableA11y'

// Exam Marks — the teacher's page for entering examination marks. The teacher
// sees the exams of the majors they teach (major_teacher), picks one, and
// enters a mark (0–20) for every seated student. Marks save progressively:
// only the rows currently typed are sent, so partial saves never wipe others.
// Emptying a field clears that student's mark.
//
// A second view computes the SEMESTER MARK per student: the mark in each
// major is the exam-factor-weighted average of the student's exam marks of
// that major, and the semester mark is the major-factor-weighted average of
// the major marks (major factors are defined by the admin on the Majors page).

const ExamMarks = ({ user }) => {
  const isAdmin = user?.roles?.includes('ADMIN')
  const [exams, setExams] = useState([])
  const [semesters, setSemesters] = useState([])
  const [years, setYears] = useState([])
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  const [selectedExamId, setSelectedExamId] = useState('')

  // Follow the current year/semester while the page stays open.
  useCurrentPeriodSync([
    { rows: years, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester }
  ])
  const [rows, setRows] = useState([])
  const [exam, setExam] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'ok'|'error', text }
  const [search, setSearch] = usePersistentState('marks:search', '')
  // Draft marks: PERSON_ID -> the string currently typed. Diverges from the
  // saved values until "Save" is pressed (which also clears the drafts).
  const [drafts, setDrafts] = useState({})
  const [dirty, setDirty] = useState(false)
  // Entered-but-unsaved marks warn before the window closes, so a whole grid of
  // typed marks is not lost to a stray close.
  useBeforeUnload(dirty)

  // A grid of typed marks is also kept on this computer, so an outage, a crash
  // or a window closed by mistake never costs the work. Nothing is applied on
  // its own: the page offers what it found and the teacher chooses.
  const {
    draft: marksDraft,
    restore: restoreMarksDraft,
    discard: discardMarksDraft,
    clear: clearMarksDraft
  } = useDraft({
    key: `exam-marks:${selectedExamId || 'none'}`,
    userId: user?.id,
    value: { examId: selectedExamId || null, marks: drafts },
    enabled: dirty && !saving && !!selectedExamId,
    onRestore: (value) => {
      if (!value?.marks) return
      setDrafts(value.marks)
      setDirty(true)
    }
  })

  // 'marks' = per-exam entering grid; 'averages' = per-student semester marks.
  const [view, setView] = useState('marks')
  const [semesterMarks, setSemesterMarks] = useState([])
  const [averagesLoading, setAveragesLoading] = useState(false)
  const [expandedStudent, setExpandedStudent] = useState(null)
  // The admin can lock marks editing globally (Settings page). The server
  // rejects saves while locked — this flag only grays the UI out.
  const [marksLocked, setMarksLocked] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const settingsRes = await window.api.getSettings(user?.id)
        setMarksLocked(settingsRes?.data?.find(o => o.OPTION_KEY === 'exam_marks_locked')?.OPTION_VALUE === '1')
      } catch {
        // Settings are a courtesy hint only; the server enforces the lock.
      }
      try {
        const yearsRes = await window.api.getStudyYears()
        const y = yearsRes?.data || []
        setYears(y)
        if (y.length > 0 && !selectedYear) setSelectedYear(pickCurrentYearId(y))
      } catch (err) {
        console.error('Failed to load years', err)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // The exams of the teacher's majors — or, for admins, every exam of the
  // semester (the service returns all exams when personId is null).
  useEffect(() => {
    if (!selectedSemester || (isAdmin ? false : !user?.personId)) {
      setExams([])
      setSelectedExamId('')
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await window.api.getTeacherExaminations(user?.id, isAdmin ? null : user.personId, selectedSemester)
        if (cancelled) return
        const data = res?.data || []
        setExams(data)
        setSelectedExamId(data.length > 0 ? String(data[0].EXAMINATION_ID) : '')
      } catch (err) {
        console.error('Failed to load teacher examinations', err)
        if (!cancelled) {
          setExams([])
          setSelectedExamId('')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isAdmin, user?.personId, selectedSemester])

  // The selected exam's roster with current marks.
  const loadMarks = async (examinationId) => {
    setDrafts({})
    setDirty(false)
    setMessage(null)
    if (!examinationId) {
      setRows([])
      setExam(null)
      return
    }
    setLoading(true)
    try {
      const res = await window.api.getExaminationMarks(user?.id, examinationId)
      setRows(res?.data || [])
      setExam(res?.exam || null)
    } catch (err) {
      console.error('Failed to load examination marks', err)
      setRows([])
      setExam(null)
      setMessage({ type: 'error', text: tr('Failed to load the marks roster: ') + err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMarks(selectedExamId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExamId])

  // Semester averages recompute after every marks save (and when the semester
  // or view changes), so the two views never disagree.
  const loadSemesterMarks = async () => {
    if (!selectedSemester || view !== 'averages') return
    setAveragesLoading(true)
    try {
      const res = await window.api.getSemesterMarks(user?.id, selectedSemester)
      setSemesterMarks(res?.data || [])
    } catch (err) {
      console.error('Failed to load semester marks', err)
      setSemesterMarks([])
      setMessage({ type: 'error', text: tr('Failed to compute semester marks: ') + err.message })
    } finally {
      setAveragesLoading(false)
    }
  }

  useEffect(() => {
    loadSemesterMarks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSemester, view])

  const setDraft = (personId, value) => {
    setDrafts(prev => ({ ...prev, [personId]: value }))
    setDirty(true)
  }

  const validateDrafts = () => {
    for (const row of rows) {
      const raw = drafts[row.PERSON_ID]
      if (raw === undefined || String(raw).trim() === '') continue
      const n = Number(String(raw).trim().replace(',', '.'))
      if (!Number.isFinite(n) || n < 0 || n > 20) {
        return `"${raw}" is not a valid mark for ${row.PERSON_FIRST_NAME} ${row.PERSON_LAST_NAME}: enter a number between 0 and 20.`
      }
    }
    return null
  }

  const handleSave = async () => {
    if (!selectedExamId) return
    const invalid = validateDrafts()
    if (invalid) {
      setMessage({ type: 'error', text: invalid })
      return
    }
    // Only rows the teacher typed are sent — progressive, conflict-free saves.
    const marks = rows
      .filter(r => drafts[r.PERSON_ID] !== undefined)
      .map(r => ({ PERSON_ID: r.PERSON_ID, FINAL_MARK: String(drafts[r.PERSON_ID]).trim() }))
    if (marks.length === 0) {
      setMessage({ type: 'error', text: tr('Nothing to save: type at least one mark first.') })
      return
    }
    setSaving(true)
    try {
      const res = await window.api.saveExaminationMarks(user?.id, Number(selectedExamId), marks, isAdmin ? null : user.personId)
      setMessage({
        type: 'ok',
        text: `Saved ${res?.saved ?? 0} mark(s)` + (res?.cleared ? ` and cleared ${res.cleared}` : '') + '.'
      })
      await loadMarks(selectedExamId)
      loadSemesterMarks()
      // The grid reached the server: there is nothing left to restore here.
      clearMarksDraft()
    } catch (err) {
      console.error('Failed to save marks', err)
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      `${r.PERSON_FIRST_NAME} ${r.PERSON_LAST_NAME}`.toLowerCase().includes(q) ||
      String(r.SEAT_NUMBER ?? '').includes(q) ||
      String(r.PAPER_CODE ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  const markedCount = rows.filter(r => r.FINAL_MARK !== null && r.FINAL_MARK !== undefined).length
  const passCount = rows.filter(r => Number(r.FINAL_MARK) >= 10).length
  const avg = markedCount > 0
    ? (rows.reduce((acc, r) => acc + (r.FINAL_MARK != null ? Number(r.FINAL_MARK) : 0), 0) / markedCount)
    : null

  const selectedExam = exams.find(e => String(e.EXAMINATION_ID) === String(selectedExamId))

  const formatWhen = (value) => {
    if (!value) return tr('Not scheduled')
    const [d, t] = String(value).split('T')
    return `${d} at ${t}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      {/* This masthead's toolbar is wide enough to fill the row, so the Guide is
          pushed to the outer edge: right in English and French, left in Arabic. */}
      <PageIntro
        kicker={tr('Examinations')}
        title={tr('Exam Marks')}
        guideEdge="outer"
        actions={
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-2">
          <div className="flex rounded-[4px] overflow-hidden border border-line self-end">
            <button
              onClick={() => setView('marks')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium transition-colors ${
                view === 'marks' ? 'bg-jade-solid text-on-jade' : 'bg-surface-muted text-ink-2 hover:bg-surface'
              }`}
            >
              <ClipboardList size={14} />{' '}{tr("Marks")}</button>
            <button
              onClick={() => setView('averages')}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium transition-colors ${
                view === 'averages' ? 'bg-jade-solid text-on-jade' : 'bg-surface-muted text-ink-2 hover:bg-surface'
              }`}
            >
              <BarChart3 size={14} />{' '}{tr("Semester Averages")}</button>
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] font-semibold text-ink-3 uppercase ml-1 mb-1">{tr("Year")}</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="bg-surface-muted border border-line text-ink-2 text-[12.5px] rounded-[4px] focus:ring-blue-500 focus:border-blue-500 p-2"
            >
              {years.map(y => (
                <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>{y.STUDY_YEAR_LABEL}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] font-semibold text-ink-3 uppercase ml-1 mb-1">{tr("Semester")}</label>
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="bg-surface-muted border border-line text-ink-2 text-[12.5px] rounded-[4px] focus:ring-blue-500 focus:border-blue-500 p-2"
              disabled={!selectedYear}
            >
              {semesters.map(s => (
                <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>{s.STUDY_SEMESTER_LABEL}</option>
              ))}
            </select>
          </div>

          {view === 'marks' && (
            <div className="flex flex-col">
              <label className="text-[10px] font-semibold text-ink-3 uppercase ml-1 mb-1">{tr("Exam")}</label>
              <select
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
                className="bg-surface-muted border border-line text-ink-2 text-[12.5px] rounded-[4px] focus:ring-blue-500 focus:border-blue-500 p-2 min-w-[16rem]"
                disabled={exams.length === 0}
              >
                {exams.length === 0 && <option value="">{tr("No exams")}{isAdmin ? '' : tr(' for your majors')}{' '}{tr("this semester")}</option>}
                {exams.map(e => (
                  <option key={e.EXAMINATION_ID} value={e.EXAMINATION_ID}>
                    {e.EXAMINATION_CODE ? `${e.EXAMINATION_CODE} — ` : ''}{e.EXAMINATION_LABEL} ({e.MAJOR_LABEL})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{isAdmin
          ? tr('Review and correct the exam marks of every major for the selected semester')
          : tr('Enter the marks your students obtained in their exams')}</p>
      </PageIntro>

      {view === 'averages' && (
        <SemesterAveragesView
          loading={averagesLoading}
          rows={semesterMarks}
          semesterId={selectedSemester}
          expandedStudent={expandedStudent}
          onToggleStudent={(id) => setExpandedStudent(prev => (prev === id ? null : id))}
        />
      )}

      {/* Exam summary + save bar */}
      {view === 'marks' && selectedExam && (
        <div className="bg-white rounded-md border border-line p-4 flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[12.5px]">
            <div>
              <div className="text-[10px] font-semibold text-ink-3 uppercase">{tr("Scheduled")}</div>
              <div className="text-ink-2 font-medium">{formatWhen(selectedExam.EXAMINATION_START_DATETIME)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-ink-3 uppercase">{tr("Type / Coefficient")}</div>
              <div className="text-ink-2 font-medium">
                {selectedExam.EXAMINATION_TYPE_LABEL || '—'}
                {selectedExam.EXAMINATION_FACTOR ? ` · ×${Number(selectedExam.EXAMINATION_FACTOR)}` : ''}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-ink-3 uppercase">{tr("Marked")}</div>
              <div className="text-ink-2 font-medium">{markedCount} / {rows.length}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-ink-3 uppercase">{tr("Average")}{markedCount > 0 ? tr(' / Passed') : ''}</div>
              <div className="text-ink-2 font-medium">
                {avg != null ? avg.toFixed(2) : '—'}{markedCount > 0 ? ` · ${passCount} ≥ 10` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr("Search student, seat, paper…")}
                className="pl-8 pr-3 py-2 text-[12.5px] border border-line rounded-[4px] focus:ring-blue-500 focus:border-blue-500 w-56"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !dirty || marksLocked}
              className={`flex items-center gap-2 px-4 py-2 rounded-[4px] text-[12.5px] font-semibold text-white transition-all ${
                saving || !dirty || marksLocked
                  ? 'bg-blue-300 cursor-not-allowed'
                  : 'bg-jade-solid text-on-jade hover:shadow-[0_4px_12px_color-mix(in_srgb,var(--color-jade-500)_35%,transparent)]'
              }`}
            >
              {marksLocked ? <Lock size={15} /> : <Save size={15} />}
              {marksLocked ? tr('Marks Locked') : saving ? tr('Saving…') : tr('Save Marks')}
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {view === 'marks' && message && (
        <div
          className={`rounded-md border p-3 text-[12.5px] flex items-center gap-2 ${
            message.type === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {message.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{message.text}</span>
          <button className="ml-auto text-ink-3 hover:text-ink-2" onClick={() => setMessage(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Work kept from an earlier session on this computer. */}
      {view === 'marks' && marksDraft && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <span>
            {tr('Unsaved marks from {when} are saved on this computer.', {
              when: new Date(marksDraft.savedAt).toLocaleString()
            })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={restoreMarksDraft}
              className="rounded-[4px] border border-amber-400 bg-white px-2 py-1 text-[11.5px] font-semibold hover:bg-amber-100"
            >
              {tr('Restore')}
            </button>
            <button
              type="button"
              onClick={discardMarksDraft}
              className="rounded-[4px] px-2 py-1 text-[11.5px] underline-offset-2 hover:underline"
            >
              {tr('Discard')}
            </button>
          </div>
        </div>
      )}

      {/* Roster */}
      {view === 'marks' && loading ? (
        <div className="bg-white rounded-md border border-line p-8 text-center text-ink-3">{tr("Loading marks…")}</div>
      ) : view === 'marks' && !selectedExamId ? (
        <div className="bg-white rounded-md border border-line p-8 text-center text-ink-3">
          <Award size={28} className="mx-auto mb-2 text-ink-3" />
          {isAdmin
            ? tr('No exams are scheduled for this semester yet.')
            : tr('No exams are available for the majors you teach in this semester.')}
        </div>
      ) : view === 'marks' && rows.length === 0 ? (
        <div className="bg-white rounded-md border border-line p-8 text-center text-ink-3">
          <Users size={28} className="mx-auto mb-2 text-ink-3" />{' '}{tr("No students are seated for this exam yet. Marks can be entered once the seating is done (Manage seating on the Exams page).")}</div>
      ) : view === 'marks' && (
        <div className="bg-white rounded-md border border-line overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line">
              <thead className="bg-surface-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Student")}</th>
                  <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">
                    <span className="inline-flex items-center gap-1"><DoorOpen size={11} />{' '}{tr("Room / Group")}</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">
                    <span className="inline-flex items-center gap-1"><Hash size={11} />{' '}{tr("Seat")}</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">
                    <span className="inline-flex items-center gap-1"><FileKey size={11} />{' '}{tr("Paper")}</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Mark (0–20)")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredRows.map(row => {
                  const current = drafts[row.PERSON_ID] !== undefined ? drafts[row.PERSON_ID] : (row.FINAL_MARK ?? '')
                  const raw = String(current).trim()
                  const invalid = raw !== '' && !Number.isFinite(Number(raw.replace(',', '.')))
                  const savedVal = row.FINAL_MARK != null ? Number(row.FINAL_MARK) : null
                  return (
                    <tr key={row.PERSON_ID} className="hover:bg-surface-muted/70">
                      <td className="px-4 py-2.5">
                        <div className="text-[12.5px] font-semibold text-ink">
                          {personNameLastFirst(row.PERSON_LAST_NAME, row.PERSON_FIRST_NAME)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-ink-2">
                        {row.CLASSROOM_LABEL || row.CLASSROOM_CODE || '—'}
                        <span className="text-ink-3"> · {row.EXAMINATION_GROUP_LABEL || tr('No group')}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-ink-2">{row.SEAT_NUMBER ?? '—'}</td>
                      <td className="px-4 py-2.5 text-[12.5px] text-ink-2 mono text-[11px]">{row.PAPER_CODE || '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            value={current}
                            onChange={e => setDraft(row.PERSON_ID, e.target.value)}
                            inputMode="decimal"
                            placeholder="—"
                            className={`w-20 px-2 py-1.5 text-[12.5px] rounded-[4px] border text-center focus:ring-2 focus:border-blue-500 ${
                              invalid ? 'border-red-300 bg-red-50 focus:ring-red-300'
                              : savedVal != null && savedVal >= 10 ? 'border-green-200 bg-green-50 focus:ring-blue-300'
                              : savedVal != null ? 'border-red-200 bg-red-50 focus:ring-blue-300'
                              : 'border-line bg-surface-muted focus:ring-blue-300'
                            }`}
                          />
                          {savedVal != null && (
                            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${savedVal >= 10 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {savedVal.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {filteredRows.length === 0 && (
            <div className="p-6 text-center text-[12.5px] text-ink-3">{tr("No student matches the search.")}</div>
          )}
        </div>
      )}

      {/* Footer hint */}
      {view === 'marks' && rows.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-ink-3">
          <Check size={12} />{' '}{tr("Marks are saved only for the fields you typed — you can fill the roster a few students at a time. Leave a field empty to clear that student's mark.")}</div>
      )}
    </div>
  )
}

// Per-student semester averages: the semester mark (factor-weighted) and the
// overall semester average (plain average of every exam mark) plus the
// per-major marks behind them, expandable per row. Expanding a row shows the
// student's full bulletin: every exam mark of the semester, the per-major
// weighted averages and how each figure is computed.
const SemesterAveragesView = ({ loading, rows, semesterId, expandedStudent, onToggleStudent }) => {
  const [search, setSearch] = usePersistentState('marks:averages-search', '')
  const [showHow, setShowHow] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      `${r.PERSON_FIRST_NAME} ${r.PERSON_LAST_NAME}`.toLowerCase().includes(q)
    )
  }, [rows, search])

  if (!semesterId) {
    return (
      <div className="bg-white rounded-md border border-line p-8 text-center text-ink-3">{tr("Select a year and a semester to compute the semester averages.")}</div>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-md border border-line p-8 text-center text-ink-3">{tr("Computing semester averages…")}</div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-md border border-line p-8 text-center text-ink-3">
        <BarChart3 size={28} className="mx-auto mb-2 text-ink-3" />{' '}{tr("No marks are entered yet for this semester — averages appear once exam marks are saved.")}</div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: search + the figure-explainer button (opens a modal) */}
      <div className="bg-white rounded-md border border-line p-3 flex items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("Search student…")}
            className="pl-8 pr-3 py-2 text-[12.5px] border border-line rounded-[4px] focus:ring-blue-500 focus:border-blue-500 w-full"
          />
        </div>
        <button
          onClick={() => setShowHow(true)}
          className="flex items-center gap-2 px-3 py-2 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-[4px] transition-colors"
        >
          <BarChart3 size={13} />{' '}{tr("How each figure is calculated")}</button>
      </div>

      {/* How-each-figure-is-calculated modal */}
      {showHow && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setShowHow(false)}
        >
          <div
            className="bg-white rounded-md w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-blue-600 px-6 py-4 flex justify-between items-center text-white">
              <h4 className="font-semibold text-lg">{tr("How each figure is calculated")}</h4>
              <button onClick={() => setShowHow(false)} className="hover:bg-on-jade/20 p-1 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            <div className="overflow-x-auto max-h-[70vh]">
              <table className="min-w-full divide-y divide-line text-[12.5px]">
                <thead className="bg-surface-muted sticky top-0">
                  <tr>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Figure")}</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Formula")}</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Weight used")}</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Unmarked exams")}</th>
                    <th scope="col" className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Example")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr className="hover:bg-surface-muted/70">
                    <td className="px-4 py-2.5 font-semibold text-ink">{tr("Major average")}</td>
                    <td className="px-4 py-2.5 mono text-[11px] text-ink-2">{tr("Σ(mark × exam factor) ÷ Σ(exam factors)")}</td>
                    <td className="px-4 py-2.5 text-ink-2">{tr("Exam factor (per exam, within the major)")}</td>
                    <td className="px-4 py-2.5 text-ink-2">{tr("Excluded — the average is over marked exams only")}</td>
                    <td className="px-4 py-2.5 mono text-[11px] text-ink-3">(15 × 2 + 12 × 1) / 3 = 14.00</td>
                  </tr>
                  <tr className="hover:bg-surface-muted/70">
                    <td className="px-4 py-2.5 font-semibold text-ink">{tr("Semester mark")}</td>
                    <td className="px-4 py-2.5 mono text-[11px] text-ink-2">{tr("Σ(major mark × major weight) ÷ Σ(major weights)")}</td>
                    <td className="px-4 py-2.5 text-ink-2">{tr("Major semester factor (set on the Majors page)")}</td>
                    <td className="px-4 py-2.5 text-ink-2">{tr("A major with no marked exams doesn't count")}</td>
                    <td className="px-4 py-2.5 mono text-[11px] text-ink-3">(14.00 × 2 + 11 × 1) / 3 = 13.00</td>
                  </tr>
                </tbody>
              </table>
              <div className="px-4 py-2 text-[11px] text-ink-3 border-t border-line">{tr("Click a student to see their full bulletin with the exact arithmetic of their marks.")}</div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-md border border-line overflow-hidden">
        <table className="min-w-full divide-y divide-line">
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Student")}</th>
              <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">{tr("Majors graded")}</th>
              <th scope="col" className="px-4 py-3 text-left text-[10px] font-semibold text-ink-3 uppercase">
                <span title={tr("Factor-weighted: exam factor within a major, then major semester factor")}>{tr("Semester Mark (0–20)")}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filtered.map(row => {
              const mark = row.SEMESTER_MARK != null ? Number(row.SEMESTER_MARK) : null
              const expanded = expandedStudent === row.PERSON_ID
              return (
                <React.Fragment key={row.PERSON_ID}>
                  <tr
                    className={`cursor-pointer hover:bg-surface-muted/70 ${expanded ? 'bg-blue-50/40' : ''}`}
                    {...activatableRowProps(() => onToggleStudent(row.PERSON_ID))}
                    onClick={() => onToggleStudent(row.PERSON_ID)}
                  >
                    <td className="px-4 py-2.5 text-[12.5px] font-semibold text-ink">
                      {personNameLastFirst(row.PERSON_LAST_NAME, row.PERSON_FIRST_NAME)}
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-2">{row.GRADED_MAJORS}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {mark != null ? (
                          <span
                            className={`text-[12.5px] font-semibold px-2 py-0.5 rounded ${
                              mark >= 10 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {mark.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-[12.5px] text-ink-3">—</span>
                        )}
                        <span className="text-[10px] text-ink-3">{expanded ? tr('hide detail ▲') : tr('show detail ▼')}</span>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan="3" className="px-8 py-4 bg-surface-muted">
                        <StudentBulletin row={row} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="p-6 text-center text-[12.5px] text-ink-3">{tr("No student matches the search.")}</div>
        )}
      </div>
    </div>
  )
}

// The student's bulletin, shown when a row of the Semester Averages table is
// expanded. A single detailed calculation table walks through EVERY exam of
// the semester (mark, factor, weighted contribution), rolls the exams up per
// major, then the majors up into the semester mark — every intermediate sum
// is shown.
const StudentBulletin = ({ row }) => {
  const examMarks = row.EXAM_MARKS || []
  const majorMarks = row.MAJOR_MARKS || []
  const semesterMark = row.SEMESTER_MARK != null ? Number(row.SEMESTER_MARK) : null

  // Column order: group the exams by exam type first, then the exams within
  // each type (by start datetime, then label). Each group gets a spanning
  // header cell above its exams.
  const examTypeGroups = []
  for (const e of examMarks) {
    const label = e.EXAMINATION_TYPE_LABEL || tr('Other')
    let group = examTypeGroups.find(g => g.label === label)
    if (!group) {
      group = { label, exams: [] }
      examTypeGroups.push(group)
    }
    group.exams.push(e)
  }
  examTypeGroups.forEach(g =>
    g.exams.sort((a, b) =>
      String(a.EXAMINATION_START_DATETIME || '').localeCompare(String(b.EXAMINATION_START_DATETIME || '')) ||
      String(a.EXAMINATION_LABEL || '').localeCompare(String(b.EXAMINATION_LABEL || ''))
    )
  )
  examTypeGroups.sort((a, b) => a.label.localeCompare(b.label))
  const orderedExamMarks = examTypeGroups.flatMap(g => g.exams)

  // Pre-compute per-major rollups so each block can show every intermediate
  // value: weighted sum, factor sum, major mark, semester weight and the
  // major's weighted contribution to the semester mark.
  const majorRollups = majorMarks.map(mm => {
    const majorExams = examMarks.filter(e => e.MAJOR_ID === mm.MAJOR_ID)
    const marked = majorExams.filter(e => e.FINAL_MARK != null)
    const weightedSum = marked.reduce((acc, e) => acc + (Number(e.EXAMINATION_FACTOR) || 1) * Number(e.FINAL_MARK), 0)
    const factorSum = marked.reduce((acc, e) => acc + (Number(e.EXAMINATION_FACTOR) || 1), 0)
    const majorMark = mm.MAJOR_MARK != null ? Number(mm.MAJOR_MARK) : null
    const majorWeight = Number(mm.MAJOR_FACTOR) || 1
    const contribution = majorMark != null ? majorWeight * majorMark : null
    return { mm, majorExams, marked, weightedSum, factorSum, majorMark, majorWeight, contribution }
  })

  const gradedMajors = majorRollups.filter(r => r.majorMark != null)
  const semesterWeightSum = gradedMajors.reduce((acc, r) => acc + r.majorWeight, 0)
  const semesterWeightedSum = gradedMajors.reduce((acc, r) => acc + (r.contribution ?? 0), 0)

  const fmt = (n, d = 2) => n.toFixed(d)

  const Badge = ({ value, big }) =>
    value == null ? (
      <span className="text-ink-3">—</span>
    ) : (
      <span className={`${big ? 'text-2xl' : 'text-[12.5px]'} font-semibold px-2 py-0.5 rounded ${
        Number(value) >= 10 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}>
        {Number(value).toFixed(2)}
      </span>
    )

  return (
    <div className="space-y-4">
      {/* Per-major blocks: each major shows ONLY its own exams (grouped by
          exam type first, then date/label) with the rollups inline, then a
          final semester-mark summary card. */}
      <div className="bg-white rounded-[4px] border border-line overflow-x-auto">
        {/* Per-major blocks instead of a majors × exams grid: a major row
            only ever has marks in its own exams, so a shared grid is mostly
            hollow. Each block lists ONLY that major's exams — grouped by exam
            type first, then by date/label — with the rollups inline. */}
        <div className="divide-y divide-line">
          {majorRollups.map(r => {
            // This major's exams, exam-type first, then date/label.
            const majorExamsOrdered = examTypeGroups
              .map(g => g.exams.filter(e => e.MAJOR_ID === r.mm.MAJOR_ID))
              .flat()
            return (
              <div key={`major-${r.mm.MAJOR_ID}`} className="p-3 hover:bg-blue-50/40">
                <div className="flex flex-col lg:flex-row lg:items-start gap-3 justify-between">
                  <div className="min-w-[10rem]">
                    <div className="text-[12.5px] font-semibold text-blue-900">{r.mm.MAJOR_LABEL}</div>
                    <div className="text-[10px] text-ink-3">{r.marked.length}/{r.majorExams.length}{' '}{tr("exams marked")}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 flex-1 lg:justify-end max-w-[44rem]">
                    {majorExamsOrdered.length === 0 && (
                      <span className="text-[11px] text-ink-3 italic">{tr("no exams in this major")}</span>
                    )}
                    {majorExamsOrdered.map(e => {
                      const mark = e.FINAL_MARK != null ? Number(e.FINAL_MARK) : null
                      const factor = Number(e.EXAMINATION_FACTOR) || 1
                      return (
                        <div
                          key={e.EXAMINATION_ID}
                          className={`rounded-[4px] border px-2.5 py-1.5 min-w-[7.5rem] ${mark != null ? (mark >= 10 ? 'border-green-200 bg-green-50/60' : 'border-red-200 bg-red-50/60') : 'border-line bg-surface-muted/60'}`}
                          title={`${tr(e.EXAMINATION_TYPE_LABEL || 'Exam')} · ${e.EXAMINATION_LABEL}`}
                        >
                          <div className="text-[9px] font-semibold uppercase text-blue-700 truncate">{tr(e.EXAMINATION_TYPE_LABEL || 'Exam')}</div>
                          <div className="text-[10px] text-ink-2 truncate max-w-[9rem]" title={`${e.EXAMINATION_CODE ? e.EXAMINATION_CODE + ' — ' : ''}${e.EXAMINATION_LABEL}`}>
                            {e.EXAMINATION_CODE || e.EXAMINATION_LABEL}
                          </div>
                          <div className="flex items-baseline justify-between gap-2 mono text-[11px]">
                            <span className={`font-semibold ${mark != null ? (mark >= 10 ? 'text-green-700' : 'text-red-700') : 'text-ink-3'}`}>
                              {mark != null ? fmt(mark) : '—'}
                            </span>
                            <span className="text-ink-3">×{factor}</span>
                            <span className="text-ink font-semibold">{mark != null ? fmt(mark * factor) : '—'}</span>
                          </div>
                          <div className="text-[8px] text-ink-3 text-right">{tr("mark · ×factor · M×F")}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex items-center gap-3 lg:gap-4 flex-wrap">
                    <div className="text-center min-w-[3.5rem]">
                      <div className="text-[9px] text-ink-3 uppercase font-semibold">{tr("Σ weighted")}</div>
                      <div className="text-[12.5px] mono text-blue-800">{fmt(r.weightedSum)}</div>
                    </div>
                    <div className="text-center min-w-[3.5rem]">
                      <div className="text-[9px] text-ink-3 uppercase font-semibold">{tr("Σ factors")}</div>
                      <div className="text-[12.5px] mono text-blue-800">{fmt(r.factorSum)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-ink-3 uppercase font-semibold">{tr("Major mark")}</div>
                      <Badge value={r.majorMark} />
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-ink-3 uppercase font-semibold">{tr("Sem. weight")}</div>
                      <div className="text-[12.5px] mono text-ink-2">×{r.majorWeight}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-ink-3 uppercase font-semibold">{tr("Contribution")}</div>
                      <div className="text-[12.5px] mono text-ink">{r.contribution != null ? fmt(r.contribution) : '—'}</div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-ink-3 mono">
                  {r.marked.length > 0
                    ? `(${r.marked.map(e => `${fmt(Number(e.FINAL_MARK))} × ${Number(e.EXAMINATION_FACTOR) || 1}`).join(' + ')}) / ${fmt(r.factorSum)} = major mark · ×${r.majorWeight} = contribution to the semester mark`
                    : tr('no marks yet — excluded from the semester mark')}
                </div>
              </div>
            )
          })}

          {/* Semester mark summary: the major-factor-weighted average of the
              major marks, computed from the rollups above. */}
          <div className="p-3 bg-indigo-50/60">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
              <div className="text-[12.5px] font-semibold text-indigo-900">{tr("Semester mark (weighted)")}</div>
              <div className="flex items-center gap-3 lg:gap-4 flex-wrap">
                <div className="text-center min-w-[3.5rem]">
                  <div className="text-[9px] text-indigo-400 uppercase font-semibold">{tr("Σ weighted")}</div>
                  <div className="text-[12.5px] mono text-indigo-800">{fmt(semesterWeightedSum)}</div>
                </div>
                <div className="text-center min-w-[3.5rem]">
                  <div className="text-[9px] text-indigo-400 uppercase font-semibold">{tr("Σ factors")}</div>
                  <div className="text-[12.5px] mono text-indigo-800">{fmt(semesterWeightSum)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[9px] text-indigo-400 uppercase font-semibold">{tr("Semester mark")}</div>
                  <Badge value={semesterMark} big />
                </div>
              </div>
            </div>
            <div className="mt-2 text-[11px] text-indigo-700 mono">
              {gradedMajors.length > 0
                ? `(${gradedMajors.map(r => `${fmt(r.majorMark)} × ${r.majorWeight}`).join(' + ')}) / ${fmt(semesterWeightSum)} — Σ weighted = Σ(major mark × weight), Σ factors = Σ(weights)`
                : tr('no graded majors yet')}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ExamMarks
