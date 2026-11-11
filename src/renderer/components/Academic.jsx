import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Calendar, Layers, Clock, X, Trash2, ChevronRight,
  CalendarPlus, Layers3, CalendarRange, Edit2, Save, AlertCircle
} from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Notice from './ui/Notice'
import LocalizedInput, { hasLocalizedValue } from './ui/LocalizedInput'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'
import { startOfWeekSunday, endOfWeekSaturday } from '../../shared/week'

const formatDate = (date) => {
  if (!date) return ''
  if (typeof date === 'string') return date.slice(0, 10)
  if (date instanceof Date) {
    // pg returns `date` columns as Date objects at LOCAL midnight. Formatting
    // with local components keeps the calendar date intact; toISOString()
    // would shift it a day off in UTC+ timezones (e.g. 2026-01-01 -> 2025-12-31).
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
  return String(date)
}

const idOf = (entity, kind) =>
  entity?.[`${kind}_ID`] ?? entity?.[`${kind.toLowerCase()}_id`]

const codeOf = (entity, kind) =>
  entity?.[`${kind}_CODE`] ?? entity?.[`${kind.toLowerCase()}_code`] ?? ''

const labelOf = (entity, kind) =>
  entity?.[`${kind}_LABEL`] ?? entity?.[`${kind.toLowerCase()}_label`] ?? ''

// Input style shared by every field on the page.
const inputCls =
  'w-full p-2.5 border border-line rounded-md text-[12.5px] bg-white ' +
  'focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all'

// One selectable row in a list. `active` highlights the current selection.
const ItemRow = ({ active, onClick, onEdit, onDelete, deleteDisabled, deleteTitle, children }) => (
  <div
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    className={`group p-3 rounded-md border cursor-pointer transition-all ${
      active
        ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-400/40'
        : 'border-line hover:bg-surface-muted hover:border-line-strong'
    }`}
  >
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">{children}</div>
      {onEdit && (
        <button
          type="button"
          aria-label={tr("Edit")}
          title={tr("Edit")}
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="p-1.5 rounded-[4px] text-ink-3 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0 cursor-pointer"
        >
          <Edit2 size={14} />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          aria-label={deleteTitle || tr('Delete')}
          title={deleteDisabled ? undefined : (deleteTitle || tr('Delete'))}
          disabled={deleteDisabled}
          onClick={(e) => { e.stopPropagation(); if (!deleteDisabled) onDelete() }}
          className={`p-1.5 rounded-[4px] transition-colors shrink-0 ${
            deleteDisabled
              ? 'text-ink-3 cursor-not-allowed'
              : 'text-ink-3 hover:text-red-600 hover:bg-red-50 cursor-pointer'
          }`}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  </div>
)

// Code/label/dates fields shared by the year, semester and week edit dialog.
// Fields stack full width, matching the teaching-group dialog, so the code
// input lines up with the localized label row instead of sitting beside it.
const EditFields = ({ form, setForm, snapWeek = false }) => (
  <div className="space-y-3.5">
    <div>
      <label htmlFor="academic-edit-code" className="kicker mb-1 block text-[9px]">
        {tr('Code')} *
      </label>
      <input
        id="academic-edit-code"
        type="text"
        autoComplete="off"
        className="field mono text-[12px]"
        value={form.CODE}
        onChange={(e) => setForm({ ...form, CODE: e.target.value })}
        required
      />
    </div>

    <LocalizedInput
      base="LABEL"
      form={form}
      setForm={setForm}
      label={tr('Label')}
      required
      inputClassName="field text-[12px]"
    />

    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="academic-edit-start" className="kicker mb-1 block text-[9px]">
          {tr('Start date')}
        </label>
        <input
          id="academic-edit-start"
          type="date"
          className="field text-[12px]"
          value={form.START_DATE}
          onChange={(e) => {
            if (!snapWeek) {
              setForm({ ...form, START_DATE: e.target.value })
              return
            }
            // A study week is Sunday→Saturday: snap the edited range to the
            // week that contains the chosen day.
            const start = startOfWeekSunday(e.target.value)
            setForm({ ...form, START_DATE: start, END_DATE: start ? endOfWeekSaturday(start) : '' })
          }}
        />
      </div>
      <div>
        <label htmlFor="academic-edit-end" className="kicker mb-1 block text-[9px]">
          {tr('End date')}
        </label>
        <input
          id="academic-edit-end"
          type="date"
          className="field text-[12px]"
          value={form.END_DATE}
          onChange={(e) => setForm({ ...form, END_DATE: e.target.value })}
          min={form.START_DATE || undefined}
        />
      </div>
    </div>
  </div>
)

// Inline error shown at the top of the edit dialog, so a rejected save never
// points at a notice hidden behind the modal.
const FieldError = ({ children }) => (
  <div className="flex items-start gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-2.5 py-2 text-[11.5px] text-danger-ink">
    <AlertCircle size={13} className="mt-px shrink-0" /> {children}
  </div>
)

// Collapsible "Add ..." form revealed by a button, so lists stay the focus.
const AddForm = ({ open, onClose, title, onSubmit, submitLabel, busy, children }) => {
  const firstInputRef = useRef(null)
  useEffect(() => {
    if (open) firstInputRef.current?.focus()
  }, [open])
  if (!open) return null
  return (
    <form
      onSubmit={onSubmit}
      className="mb-4 p-3 rounded-md bg-surface-muted border border-line space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="kicker text-ink-3">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tr("Close form")}
          className="p-1 rounded-[4px] text-ink-3 hover:text-ink-2 hover:bg-surface-muted/60 cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
      {children}
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-jade-solid text-on-jade hover:brightness-110 disabled:opacity-50 text-white p-2.5 rounded-md text-[12.5px] font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
      >
        <Plus size={15} /> {busy ? tr('Saving…') : submitLabel}
      </button>
    </form>
  )
}

// Empty state with an optional call-to-action that opens the parent's add form.
const EmptyState = ({ icon: Icon, message, hint, ctaLabel, onCta }) => (
  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
    <div className="p-2.5 rounded-full bg-surface-muted text-ink-3 mb-3">
      <Icon size={20} />
    </div>
    <p className="text-[12.5px] font-medium text-ink-2">{message}</p>
    {hint && <p className="text-[11px] text-ink-3 mt-1">{hint}</p>}
    {ctaLabel && onCta && (
      <button
        type="button"
        onClick={onCta}
        className="mt-3 px-3 py-1.5 rounded-md text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer flex items-center gap-1.5"
      >
        <Plus size={13} /> {ctaLabel}
      </button>
    )}
  </div>
)

// Breadcrumb chips showing where in the year → semester hierarchy the user is.
const Breadcrumbs = ({ items }) => (
  <div className="flex items-center flex-wrap gap-1 mb-3">
    {items.map((item, i) => (
      <React.Fragment key={i}>
        {i > 0 && <ChevronRight size={12} className="text-ink-3 shrink-0" />}
        <span
          className={`px-2 py-0.5 rounded-[4px] text-[11px] font-semibold truncate max-w-[140px] ${
            i === items.length - 1
              ? 'bg-blue-100 text-blue-700'
              : 'bg-surface-muted text-ink-3'
          }`}
          title={item}
        >
          {item}
        </span>
      </React.Fragment>
    ))}
  </div>
)

// Validates a 'YYYY-MM-DD' string from a date input: rejects empty strings
// and impossible calendar dates (e.g. 09/31) that the browser's date picker
// silently keeps out of the field, so the user gets a clear message instead
// of a silent no-op save.
const isValidDateString = (value) => {
  if (!value) return true // optional
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

// Card shell shared by the three columns.
const Panel = ({ icon: Icon, iconColor, title, count, action, children }) => (
  <div className="bg-white p-5 rounded-md border border-line flex flex-col">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <div className={`p-1.5 rounded-[4px] ${iconColor}`}>
          <Icon size={16} />
        </div>
        <h2 className="text-[12.5px] font-semibold text-ink">{title}</h2>
        {count !== undefined && (
          <span className="px-2 py-0.5 rounded-full bg-surface-muted text-ink-3 text-[11px] font-semibold">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
    {children}
  </div>
)

const Academic = () => {
  const [years, setYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [weeks, setWeeks] = useState([])

  const [selectedYear, setSelectedYear] = useState(null)
  const [selectedSemester, setSelectedSemester] = useState(null)

  const [newYear, setNewYear] = useState({ STUDY_YEAR_CODE: '', STUDY_YEAR_LABEL_EN: '', STUDY_YEAR_LABEL_AR: '', STUDY_YEAR_LABEL_FR: '', STUDY_YEAR_START_DATE: '', STUDY_YEAR_END_DATE: '' })
  const [newSemester, setNewSemester] = useState({ STUDY_SEMESTER_CODE: '', STUDY_SEMESTER_LABEL_EN: '', STUDY_SEMESTER_LABEL_AR: '', STUDY_SEMESTER_LABEL_FR: '', STUDY_SEMESTER_START_DATE: '', STUDY_SEMESTER_END_DATE: '' })
  const [newWeek, setNewWeek] = useState({ STUDY_WEEK_CODE: '', STUDY_WEEK_LABEL_EN: '', STUDY_WEEK_LABEL_AR: '', STUDY_WEEK_LABEL_FR: '', STUDY_WEEK_START_DATE: '', STUDY_WEEK_END_DATE: '' })

  // Edit dialog state: which row is being edited (by kind + id), its form
  // values, and the validation/save error shown inside the dialog.
  const [editing, setEditing] = useState(null) // { kind: 'year' | 'semester' | 'week', id }
  const [editForm, setEditForm] = useState({ CODE: '', LABEL_EN: '', LABEL_AR: '', LABEL_FR: '', START_DATE: '', END_DATE: '' })
  const [editError, setEditError] = useState('')

  // Auto-generate weeks form (opened from the Weeks panel header).
  const [showGenerateForm, setShowGenerateForm] = useState(false)
  const [generateForm, setGenerateForm] = useState({ START_DATE: '', END_DATE: '', WEEKEND_DAYS: [0, 6], REPLACE_EXISTING: false })
  const WEEKDAY_NAMES = [tr('Sunday'), tr('Monday'), tr('Tuesday'), tr('Wednesday'), tr('Thursday'), tr('Friday'), tr('Saturday')]

  const [showYearForm, setShowYearForm] = useState(false)
  const [showSemesterForm, setShowSemesterForm] = useState(false)
  const [showWeekForm, setShowWeekForm] = useState(false)

  const [confirmTarget, setConfirmTarget] = useState(null) // { kind, id, title, message }
  const [notice, setNotice] = useState(null)

  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  const fetchYears = useCallback(async () => {
    const result = await window.api.getStudyYears()
    setYears(result.data || [])
  }, [])

  const fetchSemesters = useCallback(async (yearId) => {
    if (!yearId) { setSemesters([]); return }
    const result = await window.api.getStudySemesters(yearId)
    setSemesters(result.data || [])
  }, [])

  const fetchWeeks = useCallback(async (semesterId) => {
    if (!semesterId) { setWeeks([]); return }
    const result = await window.api.getStudyWeeks(semesterId)
    setWeeks(result.data || [])
  }, [])

  useEffect(() => {
    let mounted = true
    const loadData = async () => {
      try {
        await fetchYears()
      } catch (error) {
        console.error('Error loading academic data:', error)
        if (mounted) setNotice({ type: 'error', text: tr('Failed to load academic data: ') + (error.message || '') })
      } finally {
        if (mounted) setInitialLoading(false)
      }
    }
    loadData()
    return () => { mounted = false }
  }, [fetchYears])

  useEffect(() => {
    let mounted = true
    if (selectedYear) {
      const yearId = idOf(selectedYear, 'STUDY_YEAR')
      if (yearId) {
        fetchSemesters(yearId).catch(err => {
          if (mounted) setNotice({ type: 'error', text: tr('Failed to load semesters: ') + (err.message || '') })
        })
      }
      setSelectedSemester(null)
      setWeeks([])
    }
    return () => { mounted = false }
  }, [selectedYear, fetchSemesters])

  useEffect(() => {
    let mounted = true
    if (selectedSemester) {
      const semesterId = idOf(selectedSemester, 'STUDY_SEMESTER')
      if (semesterId) {
        fetchWeeks(semesterId).catch(err => {
          if (mounted) setNotice({ type: 'error', text: tr('Failed to load weeks: ') + (err.message || '') })
        })
      }
    }
    return () => { mounted = false }
  }, [selectedSemester, fetchWeeks])

  // `onError` lets a dialog show the failure inline; page-level flows keep
  // using the notice banner.
  const runSave = async (fn, successText, onError) => {
    setLoading(true)
    try {
      await fn()
      setNotice({ type: 'ok', text: successText })
      return true
    } catch (error) {
      console.error('Academic save failed:', error)
      // IPC rejections arrive as "Error invoking remote method 'x': Error: <real message>"
      const raw = error.message || tr('The change could not be saved.')
      const text = raw.includes('Error invoking remote method')
        ? (raw.split('Error:').pop() || raw).trim()
        : raw
      if (onError) onError(text)
      else setNotice({ type: 'error', text })
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleAddYear = async (e) => {
    e.preventDefault()
    const ok = await runSave(async () => {
      const created = await window.api.createStudyYear(newYear)
      setNewYear({ STUDY_YEAR_CODE: '', STUDY_YEAR_LABEL_EN: '', STUDY_YEAR_LABEL_AR: '', STUDY_YEAR_LABEL_FR: '', STUDY_YEAR_START_DATE: '', STUDY_YEAR_END_DATE: '' })
      setShowYearForm(false)
      await fetchYears()
      // Select the new year right away so the flow can continue.
      const saved = years.find(y => idOf(y, 'STUDY_YEAR') === created?.STUDY_YEAR_ID)
      setSelectedYear(saved || created)
    }, `Study year “${newYear.STUDY_YEAR_CODE}” created.`)
    if (!ok) return
  }

  const handleAddSemester = async (e) => {
    e.preventDefault()
    if (!selectedYear) return
    if (!isValidDateString(newSemester.STUDY_SEMESTER_START_DATE) || !isValidDateString(newSemester.STUDY_SEMESTER_END_DATE)) {
      setNotice({ type: 'error', text: tr('One of the dates is not a valid calendar date (e.g. September 31st does not exist).') })
      return
    }
    if (newSemester.STUDY_SEMESTER_START_DATE && newSemester.STUDY_SEMESTER_END_DATE && newSemester.STUDY_SEMESTER_END_DATE < newSemester.STUDY_SEMESTER_START_DATE) {
      setNotice({ type: 'error', text: tr('End date must be on or after the start date.') })
      return
    }
    await runSave(async () => {
      const created = await window.api.createStudySemester({
        ...newSemester, STUDY_YEAR_ID: idOf(selectedYear, 'STUDY_YEAR')
      })
      setNewSemester({ STUDY_SEMESTER_CODE: '', STUDY_SEMESTER_LABEL_EN: '', STUDY_SEMESTER_LABEL_AR: '', STUDY_SEMESTER_LABEL_FR: '', STUDY_SEMESTER_START_DATE: '', STUDY_SEMESTER_END_DATE: '' })
      setShowSemesterForm(false)
      await fetchSemesters(idOf(selectedYear, 'STUDY_YEAR'))
      const saved = semesters.find(s => idOf(s, 'STUDY_SEMESTER') === created?.STUDY_SEMESTER_ID)
      setSelectedSemester(saved || created)
    }, `Semester “${newSemester.STUDY_SEMESTER_CODE}” created.`)
  }

  const handleAddWeek = async (e) => {
    e.preventDefault()
    if (!selectedSemester) return
    if (!isValidDateString(newWeek.STUDY_WEEK_START_DATE) || !isValidDateString(newWeek.STUDY_WEEK_END_DATE)) {
      setNotice({ type: 'error', text: tr('One of the dates is not a valid calendar date (e.g. September 31st does not exist).') })
      return
    }
    if (newWeek.STUDY_WEEK_START_DATE && newWeek.STUDY_WEEK_END_DATE && newWeek.STUDY_WEEK_END_DATE < newWeek.STUDY_WEEK_START_DATE) {
      setNotice({ type: 'error', text: tr('End date must be on or after the start date.') })
      return
    }
    await runSave(async () => {
      await window.api.createStudyWeek({
        ...newWeek, STUDY_SEMESTER_ID: idOf(selectedSemester, 'STUDY_SEMESTER')
      })
      setNewWeek({ STUDY_WEEK_CODE: '', STUDY_WEEK_LABEL_EN: '', STUDY_WEEK_LABEL_AR: '', STUDY_WEEK_LABEL_FR: '', STUDY_WEEK_START_DATE: '', STUDY_WEEK_END_DATE: '' })
      setShowWeekForm(false)
      await fetchWeeks(idOf(selectedSemester, 'STUDY_SEMESTER'))
    }, `Week “${newWeek.STUDY_WEEK_CODE}” created.`)
  }

  const startEdit = (kind, entity) => {
    setEditError('')
    setEditing({ kind, id: idOf(entity, kind === 'year' ? 'STUDY_YEAR' : kind === 'semester' ? 'STUDY_SEMESTER' : 'STUDY_WEEK') })
    const prefix = kind === 'year' ? 'STUDY_YEAR' : kind === 'semester' ? 'STUDY_SEMESTER' : 'STUDY_WEEK'
    setEditForm({
      CODE: codeOf(entity, prefix),
      LABEL_EN: entity[`${prefix}_LABEL_EN`] ?? labelOf(entity, prefix),
      LABEL_AR: entity[`${prefix}_LABEL_AR`] ?? '',
      LABEL_FR: entity[`${prefix}_LABEL_FR`] ?? '',
      START_DATE: formatDate(entity[`${prefix}_START_DATE`] || entity[`${kind}_start_date`]),
      END_DATE: formatDate(entity[`${prefix}_END_DATE`] || entity[`${kind}_end_date`])
    })
  }

  const cancelEdit = () => {
    setEditing(null)
    setEditError('')
    setEditForm({ CODE: '', LABEL_EN: '', LABEL_AR: '', LABEL_FR: '', START_DATE: '', END_DATE: '' })
  }

  const handleSaveEdit = async () => {
    const target = editing
    if (!target) return
    setEditError('')
    if (!editForm.CODE || !hasLocalizedValue(editForm, 'LABEL')) {
      setEditError(tr('Code and English label are required.'))
      return
    }
    if (editForm.START_DATE && editForm.END_DATE && editForm.END_DATE < editForm.START_DATE) {
      setEditError(tr('End date must be on or after the start date.'))
      return
    }
    if (!isValidDateString(editForm.START_DATE) || !isValidDateString(editForm.END_DATE)) {
      setEditError(tr('One of the dates is not a valid calendar date (e.g. September 31st does not exist).'))
      return
    }
    await runSave(async () => {
      const prefix = target.kind === 'year' ? 'STUDY_YEAR' : target.kind === 'semester' ? 'STUDY_SEMESTER' : 'STUDY_WEEK'
      const payload = {
        [`${prefix}_CODE`]: editForm.CODE,
        [`${prefix}_LABEL_EN`]: editForm.LABEL_EN,
        [`${prefix}_LABEL_AR`]: editForm.LABEL_AR,
        [`${prefix}_LABEL_FR`]: editForm.LABEL_FR,
        [`${prefix}_START_DATE`]: editForm.START_DATE || null,
        [`${prefix}_END_DATE`]: editForm.END_DATE || null
      }
      if (target.kind === 'year') {
        await window.api.updateStudyYear(target.id, payload)
        await fetchYears()
      } else if (target.kind === 'semester') {
        await window.api.updateStudySemester(target.id, payload)
        await fetchSemesters(idOf(selectedYear, 'STUDY_YEAR'))
      } else {
        await window.api.updateStudyWeek(target.id, payload)
        await fetchWeeks(idOf(selectedSemester, 'STUDY_SEMESTER'))
      }
      cancelEdit()
    }, `${target.kind[0].toUpperCase() + target.kind.slice(1)} “${editForm.CODE}” updated.`, setEditError)
  }

  const toggleWeekendDay = (day) => {
    setGenerateForm((f) => ({
      ...f,
      WEEKEND_DAYS: f.WEEKEND_DAYS.includes(day) ? f.WEEKEND_DAYS.filter(d => d !== day) : [...f.WEEKEND_DAYS, day].sort()
    }))
  }

  const openGenerateForm = () => {
    // Pre-fill from the selected semester's own dates when available.
    const semester = semesters.find(s => idOf(s, 'STUDY_SEMESTER') === idOf(selectedSemester, 'STUDY_SEMESTER')) || selectedSemester
    setGenerateForm({
      START_DATE: formatDate(semester?.STUDY_SEMESTER_START_DATE || semester?.study_semester_start_date) || '',
      END_DATE: formatDate(semester?.STUDY_SEMESTER_END_DATE || semester?.study_semester_end_date) || '',
      WEEKEND_DAYS: [0, 6],
      REPLACE_EXISTING: false
    })
    setShowGenerateForm(true)
  }

  const handleGenerateWeeks = async (e) => {
    e.preventDefault()
    if (!generateForm.START_DATE || !generateForm.END_DATE) {
      setNotice({ type: 'error', text: tr('Start and end dates are required.') })
      return
    }
    if (generateForm.END_DATE < generateForm.START_DATE) {
      setNotice({ type: 'error', text: tr('End date must be on or after the start date.') })
      return
    }
    if (generateForm.WEEKEND_DAYS.length >= 7) {
      setNotice({ type: 'error', text: tr('At least one working day must remain.') })
      return
    }
    let createdCount = 0
    await runSave(async () => {
      const result = await window.api.generateStudyWeeks({
        STUDY_SEMESTER_ID: idOf(selectedSemester, 'STUDY_SEMESTER'),
        START_DATE: generateForm.START_DATE,
        END_DATE: generateForm.END_DATE,
        WEEKEND_DAYS: generateForm.WEEKEND_DAYS,
        REPLACE_EXISTING: generateForm.REPLACE_EXISTING
      })
      createdCount = result?.createdCount || 0
      await fetchWeeks(idOf(selectedSemester, 'STUDY_SEMESTER'))
      setShowGenerateForm(false)
    }, `Generated ${createdCount} week${createdCount === 1 ? '' : 's'} with their study days.`)
  }

  const handleConfirmDelete = async () => {
    const target = confirmTarget
    setConfirmTarget(null)
    if (!target) return
    await runSave(async () => {
      if (target.kind === 'year') {
        await window.api.deleteStudyYear(target.id)
        if (selectedYear && idOf(selectedYear, 'STUDY_YEAR') === target.id) setSelectedYear(null)
        await fetchYears()
      } else if (target.kind === 'semester') {
        await window.api.deleteStudySemester(target.id)
        if (selectedSemester && idOf(selectedSemester, 'STUDY_SEMESTER') === target.id) setSelectedSemester(null)
        await fetchSemesters(idOf(selectedYear, 'STUDY_YEAR'))
      } else if (target.kind === 'week') {
        await window.api.deleteStudyWeek(target.id)
        await fetchWeeks(idOf(selectedSemester, 'STUDY_SEMESTER'))
      }
    }, target.successMessage)
  }

  if (initialLoading) {
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <div>
          <div className="kicker mb-1">{tr('Reference data')}</div>
          <div className="text-[12.5px] text-ink-3">{tr('Loading the academic calendar…')}</div>
          <div className="mt-3 h-7 w-72 rounded-[4px] border border-line bg-surface-muted" aria-hidden="true" />
          <div className="mt-2 h-3 w-96 rounded-[2px] border border-line bg-surface-muted" aria-hidden="true" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" aria-hidden="true">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-surface p-5 rounded-md border border-line h-72">
              <div className="h-5 w-32 rounded-[4px] bg-surface-muted" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageIntro kicker={tr('Reference data')} title={tr('Academic Management')}>
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{tr('Build the academic calendar from the top down: a year contains semesters, a semester contains weeks.')}</p>
      </PageIntro>

      {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* ---------------- Years ---------------- */}
        <Panel
          icon={Calendar}
          iconColor="bg-blue-50 text-blue-600"
          title={tr("Study Years")}
          count={years.length}
          action={
            <button
              type="button"
              onClick={() => { setShowYearForm(o => !o); setShowSemesterForm(false); setShowWeekForm(false) }}
              className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer flex items-center gap-1"
            >
              <Plus size={13} />{' '}{tr("Add Year")}</button>
          }
        >
          <AddForm
            open={showYearForm}
            onClose={() => setShowYearForm(false)}
            title={tr("New Study Year")}
            onSubmit={handleAddYear}
            submitLabel="Create Year"
            busy={loading}
          >
            <input
              type="text"
              placeholder={tr("Year code (e.g. 2025-2026)")}
              className={inputCls}
              value={newYear.STUDY_YEAR_CODE}
              onChange={(e) => setNewYear({ ...newYear, STUDY_YEAR_CODE: e.target.value })}
              required
              autoFocus
            />
            <LocalizedInput
              base="STUDY_YEAR_LABEL"
              form={newYear}
              setForm={setNewYear}
              required
              inputClassName={inputCls}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="kicker text-ink-3 ml-1">{tr("Start date")}</span>
                <input
                  type="date"
                  className={inputCls}
                  value={newYear.STUDY_YEAR_START_DATE}
                  onChange={(e) => setNewYear({ ...newYear, STUDY_YEAR_START_DATE: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="kicker text-ink-3 ml-1">{tr("End date")}</span>
                <input
                  type="date"
                  className={inputCls}
                  value={newYear.STUDY_YEAR_END_DATE}
                  onChange={(e) => setNewYear({ ...newYear, STUDY_YEAR_END_DATE: e.target.value })}
                  min={newYear.STUDY_YEAR_START_DATE || undefined}
                />
              </label>
            </div>
          </AddForm>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {years.length > 0 ? years.map((year) => {
              const yId = idOf(year, 'STUDY_YEAR')
              const active = selectedYear && idOf(selectedYear, 'STUDY_YEAR') === yId
              return (
                <ItemRow
                  key={yId || Math.random()}
                  active={active}
                  onClick={() => setSelectedYear(year)}
                  onEdit={() => startEdit('year', year)}
                  onDelete={() => setConfirmTarget({
                    kind: 'year',
                    id: yId,
                    title: tr('Delete Study Year'),
                    message: `Delete study year “${codeOf(year, 'STUDY_YEAR')}”? This is only possible once it has no semesters left.`,
                    successMessage: `Study year “${codeOf(year, 'STUDY_YEAR')}” deleted.`
                  })}
                >
                  <p className="font-semibold text-[12.5px] text-ink truncate">{codeOf(year, 'STUDY_YEAR') || tr('Unknown')}</p>
                  <p className="text-[11px] text-ink-3 truncate">{labelOf(year, 'STUDY_YEAR')}</p>
                  {(year.STUDY_YEAR_START_DATE || year.study_year_start_date) && (
                    <p className="text-[10px] text-ink-3">
                      {formatDate(year.STUDY_YEAR_START_DATE || year.study_year_start_date)} → {formatDate(year.STUDY_YEAR_END_DATE || year.study_year_end_date)}
                    </p>
                  )}
                </ItemRow>
              )
            }) : (
              <EmptyState
                icon={CalendarPlus}
                message={tr("No study years yet")}
                hint={tr("Create the first year to start building the calendar.")}
                ctaLabel={tr("Add the first year")}
                onCta={() => setShowYearForm(true)}
              />
            )}
          </div>
        </Panel>

        {/* ---------------- Semesters ---------------- */}
        <Panel
          icon={Layers}
          iconColor="bg-green-50 text-green-600"
          title={tr("Semesters")}
          count={selectedYear ? semesters.length : undefined}
          action={selectedYear ? (
            <button
              type="button"
              onClick={() => { setShowSemesterForm(o => !o); setShowYearForm(false); setShowWeekForm(false) }}
              className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 transition-colors cursor-pointer flex items-center gap-1"
            >
              <Plus size={13} />{' '}{tr("Add Semester")}</button>
          ) : null}
        >
          {selectedYear ? (
            <>
              <Breadcrumbs items={[codeOf(selectedYear, 'STUDY_YEAR') || labelOf(selectedYear, 'STUDY_YEAR')]} />

              <AddForm
                open={showSemesterForm}
                onClose={() => setShowSemesterForm(false)}
                title={tr("New Semester")}
                onSubmit={handleAddSemester}
                submitLabel="Create Semester"
                busy={loading}
              >
                <input
                  type="text"
                  placeholder={tr("Semester code (e.g. S1)")}
                  className={inputCls}
                  value={newSemester.STUDY_SEMESTER_CODE}
                  onChange={(e) => setNewSemester({ ...newSemester, STUDY_SEMESTER_CODE: e.target.value })}
                  required
                  autoFocus
                />
                <LocalizedInput
                  base="STUDY_SEMESTER_LABEL"
                  form={newSemester}
                  setForm={setNewSemester}
                  required
                  inputClassName={inputCls}
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="kicker text-ink-3 ml-1">{tr("Start date")}</span>
                    <input
                      type="date"
                      className={inputCls}
                      value={newSemester.STUDY_SEMESTER_START_DATE}
                      onChange={(e) => setNewSemester({ ...newSemester, STUDY_SEMESTER_START_DATE: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="kicker text-ink-3 ml-1">{tr("End date")}</span>
                    <input
                      type="date"
                      className={inputCls}
                      value={newSemester.STUDY_SEMESTER_END_DATE}
                      onChange={(e) => setNewSemester({ ...newSemester, STUDY_SEMESTER_END_DATE: e.target.value })}
                      min={newSemester.STUDY_SEMESTER_START_DATE || undefined}
                    />
                  </label>
                </div>
              </AddForm>

              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {semesters.length > 0 ? semesters.map((semester) => {
                  const sId = idOf(semester, 'STUDY_SEMESTER')
                  const active = selectedSemester && idOf(selectedSemester, 'STUDY_SEMESTER') === sId
                  return (
                    <ItemRow
                      key={sId || Math.random()}
                      active={active}
                      onClick={() => setSelectedSemester(semester)}
                      onEdit={() => startEdit('semester', semester)}
                      onDelete={() => setConfirmTarget({
                        kind: 'semester',
                        id: sId,
                        title: tr('Delete Semester'),
                        message: `Delete semester “${codeOf(semester, 'STUDY_SEMESTER')}”? This is only possible once it has no weeks left.`,
                        successMessage: `Semester “${codeOf(semester, 'STUDY_SEMESTER')}” deleted.`
                      })}
                    >
                      <p className="font-semibold text-[12.5px] text-ink truncate">{codeOf(semester, 'STUDY_SEMESTER') || tr('Unknown')}</p>
                      <p className="text-[11px] text-ink-3 truncate">{labelOf(semester, 'STUDY_SEMESTER')}</p>
                      {(semester.STUDY_SEMESTER_START_DATE || semester.study_semester_start_date) && (
                        <p className="text-[10px] text-ink-3">
                          {formatDate(semester.STUDY_SEMESTER_START_DATE || semester.study_semester_start_date)} → {formatDate(semester.STUDY_SEMESTER_END_DATE || semester.study_semester_end_date)}
                        </p>
                      )}
                    </ItemRow>
                  )
                }) : (
                  <EmptyState
                    icon={Layers3}
                    message={tr("No semesters in this year")}
                    hint={tr("Add a semester to start scheduling weeks.")}
                    ctaLabel={tr("Add a semester")}
                    onCta={() => setShowSemesterForm(true)}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={Calendar}
              message={tr("Select a study year")}
              hint={tr("Its semesters will be listed here.")}
            />
          )}
        </Panel>

        {/* ---------------- Weeks ---------------- */}
        <Panel
          icon={Clock}
          iconColor="bg-purple-50 text-purple-600"
          title={tr("Weeks")}
          count={selectedSemester ? weeks.length : undefined}
          action={selectedSemester ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { openGenerateForm(); setShowWeekForm(false); setShowYearForm(false); setShowSemesterForm(false) }}
                className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors cursor-pointer flex items-center gap-1"
              >
                <CalendarRange size={13} />{' '}{tr("Generate")}</button>
              <button
                type="button"
                onClick={() => { setShowWeekForm(o => !o); setShowGenerateForm(false); setShowYearForm(false); setShowSemesterForm(false) }}
                className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 transition-colors cursor-pointer flex items-center gap-1"
              >
                <Plus size={13} />{' '}{tr("Add Week")}</button>
            </div>
          ) : null}
        >
          {selectedSemester ? (
            <>
              <Breadcrumbs items={[
                codeOf(selectedYear, 'STUDY_YEAR') || labelOf(selectedYear, 'STUDY_YEAR'),
                codeOf(selectedSemester, 'STUDY_SEMESTER') || labelOf(selectedSemester, 'STUDY_SEMESTER')
              ]} />

              <AddForm
                open={showWeekForm}
                onClose={() => setShowWeekForm(false)}
                title={tr("New Week")}
                onSubmit={handleAddWeek}
                submitLabel="Create Week"
                busy={loading}
              >
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder={tr("Code (e.g. W1)")}
                    className={inputCls}
                    value={newWeek.STUDY_WEEK_CODE}
                    onChange={(e) => setNewWeek({ ...newWeek, STUDY_WEEK_CODE: e.target.value })}
                    required
                    autoFocus
                  />
                  <LocalizedInput
                    base="STUDY_WEEK_LABEL"
                    form={newWeek}
                    setForm={setNewWeek}
                    required
                    inputClassName={inputCls}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="kicker text-ink-3 ml-1">{tr("Start date")}</span>
                    <input
                      type="date"
                      className={inputCls}
                      value={newWeek.STUDY_WEEK_START_DATE}
                      onChange={(e) => {
                        // Weeks run Sunday→Saturday: picking any day snaps the
                        // range to the week that contains it.
                        const start = startOfWeekSunday(e.target.value)
                        setNewWeek({
                          ...newWeek,
                          STUDY_WEEK_START_DATE: start,
                          STUDY_WEEK_END_DATE: start ? endOfWeekSaturday(start) : ''
                        })
                      }}
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="kicker text-ink-3 ml-1">{tr("End date")}</span>
                    <input
                      type="date"
                      className={inputCls}
                      value={newWeek.STUDY_WEEK_END_DATE}
                      onChange={(e) => setNewWeek({ ...newWeek, STUDY_WEEK_END_DATE: e.target.value })}
                      required
                    />
                  </label>
                </div>
              </AddForm>

              {/* Auto-generate weeks: split the semester range into weeks, skipping weekend days. */}
              {showGenerateForm && (
                <form
                  onSubmit={handleGenerateWeeks}
                  className="mb-4 p-3 rounded-md bg-surface-muted border border-line space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="kicker text-ink-3">{tr("Generate Weeks Automatically")}</span>
                    <button
                      type="button"
                      onClick={() => setShowGenerateForm(false)}
                      aria-label={tr("Close form")}
                      className="p-1 rounded-[4px] text-ink-3 hover:text-ink-2 hover:bg-surface-muted/60 cursor-pointer"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="kicker text-ink-3 ml-1">{tr("Semester start")}</span>
                      <input
                        type="date"
                        className={inputCls}
                        value={generateForm.START_DATE}
                        onChange={(e) => setGenerateForm({ ...generateForm, START_DATE: e.target.value })}
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="kicker text-ink-3 ml-1">{tr("Semester end")}</span>
                      <input
                        type="date"
                        className={inputCls}
                        value={generateForm.END_DATE}
                        onChange={(e) => setGenerateForm({ ...generateForm, END_DATE: e.target.value })}
                        min={generateForm.START_DATE || undefined}
                        required
                      />
                    </label>
                  </div>
                  <div>
                    <span className="kicker text-ink-3 ml-1">{tr("Weekend days (no study days created)")}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {WEEKDAY_NAMES.map((name, day) => {
                        const active = generateForm.WEEKEND_DAYS.includes(day)
                        return (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleWeekendDay(day)}
                            className={`px-2 py-1 rounded-[4px] text-[11px] font-semibold transition-colors cursor-pointer ${
                              active
                                ? 'bg-purple-600 text-white'
                                : 'bg-white border border-line text-ink-3 hover:border-line-strong'
                            }`}
                          >
                            {name.slice(0, 3)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {weeks.length > 0 && (
                    <label className="flex items-start gap-2 text-[11px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={generateForm.REPLACE_EXISTING}
                        onChange={(e) => setGenerateForm({ ...generateForm, REPLACE_EXISTING: e.target.checked })}
                        className="mt-0.5 cursor-pointer"
                      />
                      <span>{tr("Replace the")}{' '}{weeks.length}{' '}{tr("existing week")}{weeks.length === 1 ? '' : 's'}{' '}{tr("of this semester (their study days are removed too; weeks with scheduled sessions block regeneration).")}</span>
                    </label>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-1.5 rounded-[4px] bg-jade-solid p-2 text-[11.5px] font-semibold text-on-jade hover:brightness-110 disabled:opacity-50"
                  >
                    <CalendarRange size={15} /> {loading ? tr('Generating…') : tr('Generate Weeks')}
                  </button>
                </form>
              )}

              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {weeks.length > 0 ? weeks.map((week) => {
                  const wId = idOf(week, 'STUDY_WEEK')
                  return (
                    <ItemRow
                      key={wId || Math.random()}
                      onClick={() => {}}
                      onEdit={() => startEdit('week', week)}
                      onDelete={() => setConfirmTarget({
                        kind: 'week',
                        id: wId,
                        title: tr('Delete Week'),
                        message: `Delete week “${codeOf(week, 'STUDY_WEEK')}” (${formatDate(week.STUDY_WEEK_START_DATE || week.study_week_start_date)} → ${formatDate(week.STUDY_WEEK_END_DATE || week.study_week_end_date)})? Its study days are removed with it; weeks with scheduled sessions cannot be deleted.`,
                        successMessage: `Week “${codeOf(week, 'STUDY_WEEK')}” deleted.`
                      })}
                    >
                      <p className="font-semibold text-[12.5px] text-ink truncate">{codeOf(week, 'STUDY_WEEK') || tr('Unknown')}</p>
                      <p className="text-[11px] text-ink-3 truncate">{labelOf(week, 'STUDY_WEEK')}</p>
                      <p className="text-[10px] text-ink-3">
                        {formatDate(week.STUDY_WEEK_START_DATE || week.study_week_start_date)} → {formatDate(week.STUDY_WEEK_END_DATE || week.study_week_end_date)}
                      </p>
                    </ItemRow>
                  )
                }) : (
                  <EmptyState
                    icon={CalendarRange}
                    message={tr("No weeks in this semester")}
                    hint={tr("Add a week with its start and end dates; study days are generated automatically.")}
                    ctaLabel={tr("Add a week")}
                    onCta={() => setShowWeekForm(true)}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={Clock}
              message={tr("Select a semester")}
              hint={tr("Its weeks will be listed here.")}
            />
          )}
        </Panel>
      </div>

      {/* Edit dialog: the code/label/dates form is shared by years, semesters
          and weeks, so the same dialog serves every edit button. */}
      <Modal
        open={!!editing}
        onClose={cancelEdit}
        maxWidth="max-w-[520px]"
        title={
          editing?.kind === 'year' ? tr('Edit Study Year')
            : editing?.kind === 'semester' ? tr('Edit Semester')
              : tr('Edit Week')
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[10px] text-ink-3">
              {editing?.id ? `#${editing.id}` : tr('New record')}
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={loading}>
                {tr('Cancel')}
              </Button>
              <Button type="submit" form="academic-edit-form" size="sm" loading={loading}>
                <Save size={12} /> {loading ? tr('Saving…') : tr('Save')}
              </Button>
            </div>
          </div>
        }
      >
        <form
          id="academic-edit-form"
          onSubmit={(e) => { e.preventDefault(); handleSaveEdit() }}
          className="space-y-3.5"
        >
          {editError && <FieldError>{editError}</FieldError>}

          {editing && editing.kind !== 'year' && (
            <div className="flex items-center gap-2 rounded-[4px] border border-line bg-surface-muted px-2.5 py-1.5">
              <span className="kicker text-[9px]">{tr('Scope')}</span>
              <span className="text-[11.5px] text-ink-2">
                {[
                  codeOf(selectedYear, 'STUDY_YEAR') || labelOf(selectedYear, 'STUDY_YEAR'),
                  editing.kind === 'week'
                    ? (codeOf(selectedSemester, 'STUDY_SEMESTER') || labelOf(selectedSemester, 'STUDY_SEMESTER'))
                    : null
                ].filter(Boolean).join(' → ')}
              </span>
            </div>
          )}

          <EditFields form={editForm} setForm={setEditForm} snapWeek={editing?.kind === 'week'} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.title}
        message={confirmTarget?.message}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}

export default Academic
