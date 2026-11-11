import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, Check, Edit2, Plus, Save, Search, Trash2 } from 'lucide-react'
import Modal from '../ui/Modal'
import DataTable from '../ui/DataTable'
import ConfirmDialog from '../ui/ConfirmDialog'
import LocalizedInput, { hasLocalizedValue } from '../ui/LocalizedInput'
import { SortHeader, sortRows, toggleSort } from '../ui/tableSort'
import { UNIFORM_SIZE_KINDS, uniformKindLabel } from '../../../shared/uniformSizes'
import { localizedLabel, tr } from '../../i18n'

// The vocabulary registers that used to be pages of their own, edited from
// Settings where they belong: they are reference data, not a place to work.
//
// One dialog, many registers. Most of them are the same shape — a code, a label
// in three languages, and rows nobody edits often — so they share a single
// editor. Departments add a select for the direction they sit under, and
// Classrooms is the exception: a room also has a category, a capacity and seats,
// which is why it gets its own body further down.

const LANGUAGES = ['EN', 'AR', 'FR']

// The API reads the same columns the table shows; a payload keyed in the case
// that register's handler expects keeps the two renderers untouched.
const recase = (payload, mode) =>
  mode === 'lower'
    ? Object.fromEntries(Object.entries(payload).map(([key, value]) => [key.toLowerCase(), value]))
    : payload

// Postgres hands times back as 'HH:MM:SS'; a time input, and the register's
// table, only ever show the hours and minutes.
const hhmm = (value) => String(value ?? '').slice(0, 5)

const REGISTERS = {
  grades: {
    title: 'Grades',
    description: 'Ranks, their names and types, in the three interface languages.',
    idKey: 'MILITARY_GRADE_ID',
    load: () => window.api.getGrades(),
    create: (payload) => window.api.createGrade(payload),
    update: (id, payload) => window.api.updateGrade(id, payload),
    remove: (id) => window.api.deleteGrade(id),
    payloadCase: 'upper',
    // No code column: a military grade is named, not numbered.
    heading: (row) => localizedLabel(row, 'MILITARY_GRADE_NAME') || localizedLabel(row, 'MILITARY_GRADE_LABEL') || '—',
    subheading: (row) => localizedLabel(row, 'MILITARY_GRADE_TYPE') || '',
    // Labels stay as keys until render, so switching language re-reads them.
    fields: ['LABEL', 'NAME', 'TYPE'].flatMap((part) =>
      LANGUAGES.map((lang) => ({
        key: `MILITARY_GRADE_${part}_${lang}`,
        label: `${part === 'LABEL' ? 'Label' : part === 'NAME' ? 'Name' : 'Type'} (${lang})`,
        dir: lang === 'AR' ? 'rtl' : 'ltr'
      }))
    ),
    columns: [
      { key: 'MILITARY_GRADE_LABEL_EN', label: 'Label (EN)' },
      { key: 'MILITARY_GRADE_NAME_EN', label: 'Name (EN)' },
      { key: 'MILITARY_GRADE_TYPE_EN', label: 'Type (EN)' }
    ]
  },

  academicGrades: {
    title: 'Academic grades',
    description: 'The academic titles a person can hold.',
    idKey: 'ACADEMIC_GRADE_ID',
    codeKey: 'ACADEMIC_GRADE_CODE',
    labelBase: 'ACADEMIC_GRADE_LABEL',
    labelKey: 'ACADEMIC_GRADE_LABEL',
    load: () => window.api.getAcademicGrades(),
    create: (payload) => window.api.createAcademicGrade(payload),
    update: (id, payload) => window.api.updateAcademicGrade(id, payload),
    remove: (id) => window.api.deleteAcademicGrade(id),
    payloadCase: 'lower'
  },

  examTypes: {
    title: 'Exam types',
    description: 'How a sitting is classified: continuous, final, resit.',
    idKey: 'EXAMINATION_TYPE_ID',
    codeKey: 'EXAMINATION_TYPE_CODE',
    labelBase: 'EXAMINATION_TYPE_LABEL',
    labelKey: 'EXAMINATION_TYPE_LABEL',
    load: () => window.api.getExaminationTypes(),
    create: (payload) => window.api.createExaminationType(payload),
    update: (id, payload) => window.api.updateExaminationType(id, payload),
    remove: (id) => window.api.deleteExaminationType(id),
    payloadCase: 'lower'
  },

  sessionTypes: {
    title: 'Session types',
    description: 'The kinds of session a timetable can hold: lecture, tutorial, lab.',
    idKey: 'STUDY_SESSION_TYPE_ID',
    codeKey: 'STUDY_SESSION_TYPE_CODE',
    labelBase: 'STUDY_SESSION_TYPE_LABEL',
    labelKey: 'STUDY_SESSION_TYPE_LABEL',
    load: () => window.api.getStudySessionTypes(),
    create: (payload) => window.api.createStudySessionType(payload),
    update: (id, payload) => window.api.updateStudySessionType(id, payload),
    remove: (id) => window.api.deleteStudySessionType(id),
    payloadCase: 'upper'
  },

  sessionTimeSlots: {
    title: 'Session time slots',
    description: 'The predefined start and end times the schedule offers when a new session is created.',
    idKey: 'STUDY_SESSION_TIME_SLOT_ID',
    load: () => window.api.getStudySessionTimeSlots(),
    create: (payload) => window.api.createStudySessionTimeSlot(payload),
    update: (id, payload) => window.api.updateStudySessionTimeSlot(id, payload),
    remove: (id) => window.api.deleteStudySessionTimeSlot(id),
    payloadCase: 'upper',
    // A slot has no name: the two times are the name.
    fields: [
      { key: 'STUDY_SESSION_TIME_SLOT_START_TIME', label: 'Start time', type: 'time', required: true },
      { key: 'STUDY_SESSION_TIME_SLOT_END_TIME', label: 'End time', type: 'time', required: true }
    ],
    columns: [
      { key: 'STUDY_SESSION_TIME_SLOT_START_TIME', label: 'Start time', format: (row) => hhmm(row.STUDY_SESSION_TIME_SLOT_START_TIME) || '—' },
      { key: 'STUDY_SESSION_TIME_SLOT_END_TIME', label: 'End time', format: (row) => hhmm(row.STUDY_SESSION_TIME_SLOT_END_TIME) || '—' }
    ]
  },

  // The windows a teacher may declare: the administration fixes the list of
  // hard (unavailable) and soft (not recommended) windows, each with its own
  // name, and the teacher's page only offers these. A declared constraint
  // keeps its own copy, so editing this register never rewrites a week that
  // has already been declared.
  teacherConstraintOptions: {
    title: 'Teacher constraint options',
    description: 'The hard and soft windows a teacher may choose from when declaring weekly constraints.',
    idKey: 'TEACHER_CONSTRAINT_OPTION_ID',
    labelBase: 'TEACHER_CONSTRAINT_OPTION_LABEL',
    labelKey: 'TEACHER_CONSTRAINT_OPTION_LABEL',
    load: () => window.api.getTeacherConstraintOptions(),
    // The editor hands the acting account to these three; the service re-checks
    // the Admin role against the database before it writes.
    create: (payload, userId) => window.api.createTeacherConstraintOption(userId, payload),
    update: (id, payload, userId) => window.api.updateTeacherConstraintOption(userId, id, payload),
    remove: (id, userId) => window.api.deleteTeacherConstraintOption(userId, id),
    payloadCase: 'lower',
    fields: [
      {
        key: 'CONSTRAINT_KIND',
        label: 'Kind',
        type: 'choices',
        required: true,
        choices: [
          { value: 'HARD', label: 'Hard — unavailable' },
          { value: 'SOFT', label: 'Soft — not recommended' }
        ]
      },
      { key: 'CONSTRAINT_START_TIME', label: 'Start', type: 'time', required: true },
      { key: 'CONSTRAINT_END_TIME', label: 'End', type: 'time', required: true },
      { key: 'SORT_ORDER', label: 'Order', type: 'number' }
    ],
    columns: [
      {
        key: 'CONSTRAINT_KIND',
        label: 'Kind',
        format: (row) => (String(row.CONSTRAINT_KIND).toUpperCase() === 'HARD'
          ? tr('Hard — unavailable')
          : tr('Soft — not recommended'))
      },
      { key: 'CONSTRAINT_START_TIME', label: 'Start', format: (row) => hhmm(row.CONSTRAINT_START_TIME) || '—' },
      { key: 'CONSTRAINT_END_TIME', label: 'End', format: (row) => hhmm(row.CONSTRAINT_END_TIME) || '—' },
      {
        key: 'TEACHER_CONSTRAINT_OPTION_LABEL_EN',
        label: 'Label',
        format: (row) => localizedLabel(row, 'TEACHER_CONSTRAINT_OPTION_LABEL') || '—'
      }
    ],
    confirmMessage: 'Delete this predefined constraint? Teachers who already declared it keep their saved window.'
  },

  // The sizes a student may be issued, per uniform item. The student forms
  // offer exactly these values, and never a skirt size for a male student.
  uniformSizes: {
    title: 'Uniform sizes',
    description: 'The sizes a student may be issued for each uniform item',
    idKey: 'UNIFORM_SIZE_OPTION_ID',
    load: () => window.api.getUniformSizeOptions(),
    create: (payload, userId) => window.api.createUniformSizeOption(userId, payload),
    update: (id, payload, userId) => window.api.updateUniformSizeOption(userId, id, payload),
    remove: (id, userId) => window.api.deleteUniformSizeOption(userId, id),
    payloadCase: 'lower',
    fields: [
      {
        key: 'UNIFORM_SIZE_KIND',
        label: 'Uniform item',
        type: 'choices',
        required: true,
        choices: UNIFORM_SIZE_KINDS.map((kind) => ({ value: kind.code, label: kind.label }))
      },
      { key: 'UNIFORM_SIZE_VALUE', label: 'Size', required: true },
      { key: 'SORT_ORDER', label: 'Order', type: 'number' }
    ],
    columns: [
      {
        key: 'UNIFORM_SIZE_KIND',
        label: 'Uniform item',
        format: (row) => tr(uniformKindLabel(row.UNIFORM_SIZE_KIND))
      },
      { key: 'UNIFORM_SIZE_VALUE', label: 'Size' },
      { key: 'SORT_ORDER', label: 'Order' }
    ],
    confirmMessage: 'Delete this size? Students already recorded with it keep their saved value.'
  },

  teachingCategories: {
    title: 'Teaching categories',
    description: 'How sections are grouped for teaching and for a secretary’s scope.',
    idKey: 'TEACHING_CATEGORY_ID',
    codeKey: 'TEACHING_CATEGORY_CODE',
    labelBase: 'TEACHING_CATEGORY_LABEL',
    labelKey: 'TEACHING_CATEGORY_LABEL',
    load: () => window.api.getTeachingCategories(),
    create: (payload) => window.api.createTeachingCategory(payload),
    update: (id, payload) => window.api.updateTeachingCategory(id, payload),
    remove: (id) => window.api.deleteTeachingCategory(id),
    payloadCase: 'upper',
    columns: [
      { key: 'TEACHING_CATEGORY_CODE', label: 'Code', mono: true },
      { key: 'TEACHING_CATEGORY_LABEL_AR', label: 'Arabic label', dir: 'rtl' },
      { key: 'TEACHING_CATEGORY_LABEL_FR', label: 'French label' },
      { key: 'TEACHING_CATEGORY_LABEL_EN', label: 'English label' }
    ]
  },

  directions: {
    title: 'Directions',
    description: 'The administrative directions departments are grouped under.',
    idKey: 'DIRECTION_ID',
    codeKey: 'DIRECTION_CODE',
    labelBase: 'DIRECTION_LABEL',
    labelKey: 'DIRECTION_LABEL',
    load: () => window.api.getDirections(),
    create: (payload) => window.api.createDirection(payload),
    update: (id, payload) => window.api.updateDirection(id, payload),
    remove: (id) => window.api.deleteDirection(id),
    payloadCase: 'lower',
    columns: [
      { key: 'DIRECTION_CODE', label: 'Code', mono: true },
      { key: 'DIRECTION_LABEL', label: 'Label' },
      { key: 'DEPARTMENT_COUNT', label: 'Departments', format: (row) => String(row.DEPARTMENT_COUNT ?? 0) }
    ],
    confirmMessage: 'Delete this direction? A direction that still has departments cannot be deleted.'
  },

  departments: {
    title: 'Departments',
    description: 'The administrative departments teachers belong to, each under a direction and responsible for one major category.',
    idKey: 'DEPARTMENT_ID',
    codeKey: 'DEPARTMENT_CODE',
    labelBase: 'DEPARTMENT_LABEL',
    labelKey: 'DEPARTMENT_LABEL',
    load: () => window.api.getDepartments(),
    create: (payload) => window.api.createDepartment(payload),
    update: (id, payload) => window.api.updateDepartment(id, payload),
    remove: (id) => window.api.deleteDepartment(id),
    payloadCase: 'lower',
    // department.direction_id is NOT NULL, so every department names the
    // direction it sits under. department.major_category_id is also required:
    // the department is responsible for that major category, and a scheduler's
    // department scope is resolved through it.
    fields: [
      {
        key: 'DIRECTION_ID',
        label: 'Direction',
        type: 'select',
        required: true,
        emptyHint: 'Nothing to choose from yet. Add a direction first.',
        options: {
          load: () => window.api.getDirections(),
          idKey: 'DIRECTION_ID',
          labelKey: 'DIRECTION_LABEL'
        }
      },
      {
        key: 'MAJOR_CATEGORY_ID',
        label: 'Major category',
        type: 'select',
        required: true,
        emptyHint: 'No major category exists yet. Add one on the Majors page.',
        options: {
          load: () => window.api.getMajorCategories(),
          idKey: 'MAJOR_CATEGORY_ID',
          labelKey: 'MAJOR_CATEGORY_LABEL'
        }
      }
    ],
    columns: [
      { key: 'DEPARTMENT_CODE', label: 'Code', mono: true },
      { key: 'DEPARTMENT_LABEL', label: 'Label' },
      { key: 'DIRECTION_LABEL', label: 'Direction' },
      { key: 'MAJOR_CATEGORY_LABEL', label: 'Major category' },
      { key: 'TEACHER_COUNT', label: 'Teachers', format: (row) => String(row.TEACHER_COUNT ?? 0) }
    ],
    confirmMessage: 'Delete this department? Teachers assigned to it will no longer belong to a department.'
  },

  classrooms: {
    title: 'Classrooms',
    description: 'Rooms, their categories, their capacity and their seats.'
  }
}
// One row of the register, keyed the way the form and the table want it. The
// database hands back upper-case keys; a row typed in either case still reads.
const normalizeRow = (row, config) => {
  const next = {}
  const keys = new Set([
    config.idKey,
    config.codeKey,
    config.labelBase,
    ...(config.fields || []).map((field) => field.key),
    ...(config.columns || []).map((column) => column.key)
  ])
  for (const key of keys) {
    if (!key) continue
    next[key] = row[key] ?? row[key.toLowerCase()] ?? ''
  }
  if (config.labelBase) {
    for (const lang of LANGUAGES) {
      const key = `${config.labelBase}_${lang}`
      next[key] = row[key] ?? row[key.toLowerCase()] ?? next[key] ?? ''
    }
  }
  next.__raw = row
  return next
}

const emptyForm = (config) => {
  const form = {}
  if (config.idKey) form[config.idKey] = null
  if (config.codeKey) form[config.codeKey] = ''
  if (config.labelBase) {
    for (const lang of LANGUAGES) form[`${config.labelBase}_${lang}`] = ''
  }
  for (const field of config.fields || []) form[field.key] = ''
  return form
}

const formFromRow = (config, row) => {
  const form = emptyForm(config)
  for (const key of Object.keys(form)) {
    if (key === config.idKey) form[key] = row[key] ?? null
    else form[key] = row[key] ?? ''
  }
  return form
}

// ---------------------------------------------------------------------------
// The shared editor for the five code/label registers.
function RegisterEditor({ config, onMessage, userId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: config.codeKey || config.columns[0].key, dir: 'asc' })
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [error, setError] = useState('')
  // A register whose row points at another register (a department names its
  // direction) loads those choices once, keyed by the field that shows them.
  const [selectOptions, setSelectOptions] = useState({})

  const load = async () => {
    setLoading(true)
    try {
      const res = await config.load()
      setRows((res?.data || []).map((row) => normalizeRow(row, config)))
      setError('')
    } catch (err) {
      setError(err.message || tr('Could not read this register.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const sources = (config.fields || []).filter((field) => field.type === 'select' && field.options)
    if (sources.length === 0) return undefined
    let cancelled = false
    Promise.all(
      sources.map(async (field) => {
        try {
          const res = await field.options.load()
          return [field.key, res?.data || []]
        } catch {
          return [field.key, []]
        }
      })
    ).then((entries) => {
      if (!cancelled) setSelectOptions(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [config])

  const columns = config.columns || [
    { key: config.codeKey, label: 'Code', mono: true },
    { key: config.labelKey, label: 'Label' }
  ]

  const accessors = useMemo(() => {
    const map = {}
    for (const column of columns) map[column.key] = (row) => String(row[column.key] ?? '')
    return map
  }, [columns])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const matched = needle
      ? rows.filter((row) =>
          columns.some((column) => String(row[column.key] ?? '').toLowerCase().includes(needle))
        )
      : rows
    return sortRows(matched, sort, accessors)
  }, [rows, search, sort, accessors, columns])

  const startCreate = () => {
    setError('')
    setForm(emptyForm(config))
  }

  const startEdit = (row) => {
    setError('')
    setForm(formFromRow(config, row))
  }

  const save = async (event) => {
    event?.preventDefault?.()
    if (!form) return
    if (config.codeKey && !String(form[config.codeKey] || '').trim()) {
      setError(tr('A code is required.'))
      return
    }
    if (config.labelBase && !hasLocalizedValue(form, config.labelBase)) {
      setError(tr('The English label is required.'))
      return
    }
    // A register without a label declares the fields it must have (a time slot
    // needs both of its times); the rest fall back to the first label field.
    const requiredFields = (config.fields || []).filter((field) => field.required)
    const missing = requiredFields.find((field) => !String(form[field.key] ?? '').trim())
    if (missing) {
      setError(`${tr(missing.label)} ${tr('is required.')}`)
      return
    }
    if (!config.labelBase && requiredFields.length === 0 && !String(form[config.fields[0].key] || '').trim()) {
      setError(tr('The English label is required.'))
      return
    }

    const payload = recase(
      Object.fromEntries(Object.entries(form).filter(([key]) => key !== config.idKey)),
      config.payloadCase
    )

    setSaving(true)
    try {
      const id = form[config.idKey]
      if (id) await config.update(id, payload, userId)
      else await config.create(payload, userId)
      setForm(null)
      await load()
      onMessage({ type: 'ok', text: `${tr(config.title)}: ${id ? tr('updated') : tr('added')}.` })
    } catch (err) {
      setError(err.message || tr('That change could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    try {
      await config.remove(id, userId)
      await load()
      onMessage({ type: 'ok', text: `${tr(config.title)}: ${tr('deleted')}.` })
    } catch (err) {
      setError(err.message || tr('That row could not be deleted.'))
    }
  }

  const editingId = form?.[config.idKey] || null
  // Editing opens the form on the row itself; adding opens it in a dialog.
  // Both share the same fields and the same save handler.
  const creating = !!form && !editingId
  const registerFormId = 'register-editor-form'

  const formFields = (
    <div className="space-y-2">
      {config.codeKey && (
        <div>
          <label className="kicker mb-1 block text-[9px]">{tr('Code')}</label>
          <input
            type="text"
            value={form?.[config.codeKey] || ''}
            onChange={(event) => setForm({ ...form, [config.codeKey]: event.target.value })}
            className="field h-8 w-full text-[12px]"
            autoComplete="off"
          />
        </div>
      )}

      {config.labelBase && (
        <LocalizedInput
          base={config.labelBase}
          form={form}
          setForm={setForm}
          label={tr('Label')}
          required
          inputClassName="field h-8 w-full text-[12px]"
        />
      )}

      {config.fields && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {config.fields.map((field) => {
            const options = field.type === 'select' ? selectOptions[field.key] : null
            return (
              <div key={field.key}>
                <label className="kicker mb-1 block text-[9px]">{tr(field.label)}</label>
                {field.type === 'choices' ? (
                  <select
                    value={form?.[field.key] ?? ''}
                    onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                    className="field h-8 w-full text-[12px]"
                  >
                    <option value="">{tr(field.placeholder || 'Select…')}</option>
                    {(field.choices || []).map((choice) => (
                      <option key={choice.value} value={choice.value}>{tr(choice.label)}</option>
                    ))}
                  </select>
                ) : field.type === 'select' ? (
                  <>
                    <select
                      value={form?.[field.key] ?? ''}
                      onChange={(event) => setForm({
                        ...form,
                        [field.key]: event.target.value === '' ? '' : Number(event.target.value)
                      })}
                      className="field h-8 w-full text-[12px]"
                    >
                      <option value="">{tr(field.placeholder || 'Select…')}</option>
                      {(options || []).map((option) => (
                        <option key={option[field.options.idKey]} value={option[field.options.idKey]}>
                          {localizedLabel(option, field.options.labelKey)}
                        </option>
                      ))}
                    </select>
                    {Array.isArray(options) && options.length === 0 && (
                      <p className="mt-1 text-[10px] leading-snug text-ink-3">
                        {tr(field.emptyHint || 'Nothing to choose from yet.')}
                      </p>
                    )}
                  </>
                ) : (
                  <input
                    type={field.type || 'text'}
                    dir={field.dir}
                    value={field.type === 'time' ? hhmm(form?.[field.key]) : (form?.[field.key] || '')}
                    onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                    className="field h-8 w-full text-[12px]"
                    autoComplete="off"
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] font-medium" style={{ color: 'var(--color-danger-ink)' }}>
          <AlertCircle size={12} className="mt-px shrink-0" /> {error}
        </div>
      )}
    </div>
  )

  const formActions = (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setForm(null)}
        className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted"
      >
        {tr('Cancel')}
      </button>
      <button
        type="submit"
        form={registerFormId}
        disabled={saving}
        className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? null : <Save size={11} />} {saving ? tr('Saving…') : tr('Save')}
      </button>
    </div>
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[240px]">
          <Search className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr('Search this register…')}
            aria-label={tr('Search this register')}
            className="field h-7 w-full ps-6 text-[11.5px]"
          />
        </div>
        <span className="mono text-[10px] text-ink-3">
          {visible.length}/{rows.length}
        </span>
        <button
          type="button"
          onClick={startCreate}
          className="ms-auto inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110"
        >
          <Plus size={11} /> {tr('Add')}
        </button>
      </div>

      {error && !form && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] font-medium" style={{ color: 'var(--color-danger-ink)' }}>
          <AlertCircle size={12} className="mt-px shrink-0" /> {error}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setForm(null)}
        title={tr('New row')}
        maxWidth="max-w-[560px]"
        footer={formActions}
      >
        <form id={registerFormId} onSubmit={save}>
          {formFields}
        </form>
      </Modal>

      <div className="mt-2 overflow-x-auto rounded-[4px] border border-line">
        <DataTable
          className="data-table"
          label={tr(config.title)}
          head={<><tr>
              {columns.map((column) => (
                <SortHeader
                  key={column.key}
                  label={tr(column.label)}
                  column={column.key}
                  sort={sort}
                  onSort={(key) => setSort((current) => toggleSort(current, key))}
                />
              ))}
              <th scope="col" style={{ width: 96 }} />
            </tr></>}
        >
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="!h-16 text-center text-[11.5px] text-ink-3">
                  {tr('Loading…')}
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="!h-16 text-center text-[11.5px] text-ink-3">
                  {rows.length === 0 ? tr('No row in this register yet.') : tr('Nothing matches this search.')}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const id = row[config.idKey]

                if (editingId !== null && String(id) === String(editingId)) {
                  return (
                    <tr key={id} className="bg-canvas">
                      <td colSpan={columns.length + 1} className="!p-3">
                        <form
                          id={registerFormId}
                          onSubmit={save}
                          onKeyDown={(event) => { if (event.key === 'Escape') setForm(null) }}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="kicker text-[9px]">{tr('Edit row')}</span>
                            <span className="mono text-[9.5px] text-ink-3">#{id}</span>
                          </div>
                          {formFields}
                          <div className="mt-3">{formActions}</div>
                        </form>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={id}>
                    {columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={column.mono ? 'mono text-[10.5px] text-ink-3' : index === 0 ? 'font-medium text-ink' : 'text-ink-2'}
                        dir={column.dir}
                      >
                        {column.format ? column.format(row) : (row[column.key] || '—')}
                      </td>
                    ))}
                    <td className="!pe-2 text-end">
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          title={tr('Edit')}
                          aria-label={tr('Edit')}
                          className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                        >
                          <Edit2 size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(id)}
                          title={tr('Delete')}
                          aria-label={tr('Delete')}
                          className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                        >
                          <Trash2 size={11} />
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
        </DataTable>
      </div>

      <ConfirmDialog
        open={!!confirmId}
        title={tr('Delete row')}
        message={config.confirmMessage
          ? tr(config.confirmMessage)
          : tr('Delete this row from the register? Records that point at it keep their stored value.')}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          const id = confirmId
          setConfirmId(null)
          remove(id)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Classrooms: the rooms, the categories they belong to, and the seats in them.
const emptyRoom = () => ({
  CLASSROOM_ID: null,
  CLASSROOM_CODE: '',
  CLASSROOM_LABEL_EN: '',
  CLASSROOM_LABEL_AR: '',
  CLASSROOM_LABEL_FR: '',
  CLASSROOM_CAPACITY: '',
  CLASSROOM_CATEGORY_ID: ''
})

const emptyCategory = () => ({
  CLASSROOM_CATEGORY_ID: null,
  CLASSROOM_CATEGORY_CODE: '',
  CLASSROOM_CATEGORY_LABEL_EN: '',
  CLASSROOM_CATEGORY_LABEL_AR: '',
  CLASSROOM_CATEGORY_LABEL_FR: ''
})

function ClassroomsEditor({ onMessage }) {
  const [rooms, setRooms] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('rooms')
  const [search, setSearch] = useState('')
  const [roomForm, setRoomForm] = useState(null)
  const [categoryForm, setCategoryForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)

  // Seats are looked at one room at a time.
  const [seatRoom, setSeatRoom] = useState(null)
  const [seats, setSeats] = useState([])
  const [seatNew, setSeatNew] = useState('')
  const [seatGen, setSeatGen] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [roomRes, categoryRes] = await Promise.all([
        window.api.getClassrooms(),
        window.api.getClassroomCategories()
      ])
      setRooms(roomRes?.data || [])
      setCategories(categoryRes?.data || [])
      setError('')
    } catch (err) {
      setError(err.message || tr('Could not read the classrooms.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const categoryLabel = (id) =>
    categories.find((category) => Number(category.CLASSROOM_CATEGORY_ID) === Number(id))
      ?.CLASSROOM_CATEGORY_LABEL || ''

  const visibleRooms = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return rooms
    return rooms.filter((room) =>
      [room.CLASSROOM_CODE, room.CLASSROOM_LABEL, categoryLabel(room.CLASSROOM_CATEGORY_ID)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    )
  }, [rooms, search, categories])

  const saveRoom = async (event) => {
    event.preventDefault()
    if (!roomForm?.CLASSROOM_CODE?.trim() || !hasLocalizedValue(roomForm, 'CLASSROOM_LABEL')) {
      setError(tr('A code and an English label are required.'))
      return
    }
    const payload = {
      CLASSROOM_CODE: roomForm.CLASSROOM_CODE.trim(),
      CLASSROOM_LABEL_EN: roomForm.CLASSROOM_LABEL_EN,
      CLASSROOM_LABEL_AR: roomForm.CLASSROOM_LABEL_AR,
      CLASSROOM_LABEL_FR: roomForm.CLASSROOM_LABEL_FR,
      CLASSROOM_CAPACITY: parseInt(roomForm.CLASSROOM_CAPACITY, 10) || null,
      CLASSROOM_CATEGORY_ID: roomForm.CLASSROOM_CATEGORY_ID || null
    }
    setSaving(true)
    try {
      if (roomForm.CLASSROOM_ID) await window.api.updateClassroom(roomForm.CLASSROOM_ID, payload)
      else await window.api.createClassroom(payload)
      setRoomForm(null)
      await load()
      onMessage({ type: 'ok', text: `${tr('Classrooms')}: ${roomForm.CLASSROOM_ID ? tr('updated') : tr('added')}.` })
    } catch (err) {
      setError(err.message || tr('That room could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const saveCategory = async (event) => {
    event.preventDefault()
    if (!categoryForm?.CLASSROOM_CATEGORY_CODE?.trim() || !hasLocalizedValue(categoryForm, 'CLASSROOM_CATEGORY_LABEL')) {
      setError(tr('A code and an English label are required.'))
      return
    }
    const payload = {
      CLASSROOM_CATEGORY_CODE: categoryForm.CLASSROOM_CATEGORY_CODE.trim(),
      CLASSROOM_CATEGORY_LABEL_EN: categoryForm.CLASSROOM_CATEGORY_LABEL_EN,
      CLASSROOM_CATEGORY_LABEL_AR: categoryForm.CLASSROOM_CATEGORY_LABEL_AR,
      CLASSROOM_CATEGORY_LABEL_FR: categoryForm.CLASSROOM_CATEGORY_LABEL_FR
    }
    setSaving(true)
    try {
      if (categoryForm.CLASSROOM_CATEGORY_ID) {
        await window.api.updateClassroomCategory(categoryForm.CLASSROOM_CATEGORY_ID, payload)
      } else {
        await window.api.createClassroomCategory(payload)
      }
      setCategoryForm(null)
      await load()
      onMessage({ type: 'ok', text: `${tr('Classroom categories')}: ${categoryForm.CLASSROOM_CATEGORY_ID ? tr('updated') : tr('added')}.` })
    } catch (err) {
      setError(err.message || tr('That category could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const removeRow = async (kind, id) => {
    try {
      if (kind === 'room') await window.api.deleteClassroom(id)
      else await window.api.deleteClassroomCategory(id)
      await load()
      onMessage({ type: 'ok', text: tr('Deleted.') })
    } catch (err) {
      setError(err.message || tr('That row could not be deleted.'))
    }
  }

  const openSeats = async (room) => {
    setSeatRoom(room)
    setSeatNew('')
    setSeatGen('')
    try {
      const res = await window.api.getClassroomSeats(room.CLASSROOM_ID)
      setSeats(res?.data || [])
    } catch (err) {
      setError(err.message || tr('Could not read the seats.'))
      setSeats([])
    }
  }

  const refreshSeats = async () => {
    if (!seatRoom) return
    const res = await window.api.getClassroomSeats(seatRoom.CLASSROOM_ID)
    setSeats(res?.data || [])
  }

  const addSeat = async () => {
    const number = parseInt(seatNew, 10)
    if (!number || number <= 0) return
    try {
      await window.api.addClassroomSeat(seatRoom.CLASSROOM_ID, number)
      setSeatNew('')
      await refreshSeats()
    } catch (err) {
      setError(err.message || tr('The seat could not be added.'))
    }
  }

  const generateSeats = async () => {
    const count = parseInt(seatGen, 10)
    if (!count || count <= 0) return
    try {
      await window.api.generateClassroomSeats(seatRoom.CLASSROOM_ID, count)
      await refreshSeats()
    } catch (err) {
      setError(err.message || tr('The seats could not be generated.'))
    }
  }

  const removeSeat = async (number) => {
    try {
      await window.api.deleteClassroomSeat(seatRoom.CLASSROOM_ID, number)
      await refreshSeats()
    } catch (err) {
      setError(err.message || tr('The seat could not be removed.'))
    }
  }

  // Editing a room or a category opens the form on that row; adding one opens
  // the same form in its own dialog.
  const roomFormId = 'classroom-room-form'
  const categoryFormId = 'classroom-category-form'
  const editingRoomId = roomForm?.CLASSROOM_ID || null
  const editingCategoryId = categoryForm?.CLASSROOM_CATEGORY_ID || null
  const formError = (
    <div className="flex items-start gap-1.5 text-[11px] font-medium" style={{ color: 'var(--color-danger-ink)' }}>
      <AlertCircle size={12} className="mt-px shrink-0" /> {error}
    </div>
  )

  const roomFields = (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="kicker mb-1 block text-[9px]">{tr('Code')}</label>
          <input
            type="text"
            value={roomForm?.CLASSROOM_CODE || ''}
            onChange={(event) => setRoomForm({ ...roomForm, CLASSROOM_CODE: event.target.value })}
            className="field h-8 w-full text-[12px]"
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="kicker mb-1 block text-[9px]">{tr('Capacity')}</label>
            <input
              type="number"
              min="1"
              value={roomForm?.CLASSROOM_CAPACITY || ''}
              onChange={(event) => setRoomForm({ ...roomForm, CLASSROOM_CAPACITY: event.target.value })}
              className="field h-8 w-full text-[12px]"
            />
          </div>
          <div>
            <label className="kicker mb-1 block text-[9px]">{tr('Category')}</label>
            <select
              value={roomForm?.CLASSROOM_CATEGORY_ID || ''}
              onChange={(event) => setRoomForm({ ...roomForm, CLASSROOM_CATEGORY_ID: event.target.value })}
              className="field h-8 w-full text-[12px]"
            >
              <option value="">{tr('None')}</option>
              {categories.map((category) => (
                <option key={category.CLASSROOM_CATEGORY_ID} value={category.CLASSROOM_CATEGORY_ID}>
                  {category.CLASSROOM_CATEGORY_LABEL}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <LocalizedInput
        base="CLASSROOM_LABEL"
        form={roomForm}
        setForm={setRoomForm}
        label={tr('Label')}
        required
        inputClassName="field h-8 w-full text-[12px]"
      />
      {error && formError}
    </div>
  )

  const roomActions = (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setRoomForm(null)}
        className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted"
      >
        {tr('Cancel')}
      </button>
      <button
        type="submit"
        form={roomFormId}
        disabled={saving}
        className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:opacity-40"
      >
        {saving ? null : <Check size={11} />} {saving ? tr('Saving…') : tr('Save')}
      </button>
    </div>
  )

  const categoryFields = (
    <div className="space-y-2">
      <div>
        <label className="kicker mb-1 block text-[9px]">{tr('Code')}</label>
        <input
          type="text"
          value={categoryForm?.CLASSROOM_CATEGORY_CODE || ''}
          onChange={(event) => setCategoryForm({ ...categoryForm, CLASSROOM_CATEGORY_CODE: event.target.value })}
          className="field h-8 w-full text-[12px]"
          autoComplete="off"
        />
      </div>
      <LocalizedInput
        base="CLASSROOM_CATEGORY_LABEL"
        form={categoryForm}
        setForm={setCategoryForm}
        label={tr('Label')}
        required
        inputClassName="field h-8 w-full text-[12px]"
      />
      {error && formError}
    </div>
  )

  const categoryActions = (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setCategoryForm(null)}
        className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted"
      >
        {tr('Cancel')}
      </button>
      <button
        type="submit"
        form={categoryFormId}
        disabled={saving}
        className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:opacity-40"
      >
        {saving ? null : <Check size={11} />} {saving ? tr('Saving…') : tr('Save')}
      </button>
    </div>
  )

  const tabButton = (id, label) => (
    <button
      key={id}
      type="button"
      onClick={() => { setTab(id); setSeatRoom(null); setRoomForm(null); setCategoryForm(null) }}
      className={`inline-flex h-7 items-center rounded-[4px] border px-2.5 text-[11px] ${
        tab === id ? 'border-line-strong bg-selection text-ink' : 'border-line bg-surface text-ink-3 hover:bg-surface-muted'
      }`}
    >
      {label}
    </button>
  )

  if (seatRoom) {
    return (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setSeatRoom(null); setSeats([]) }}
            className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted"
          >
            <ArrowLeft size={11} /> {tr('All rooms')}
          </button>
          <span className="text-[12px] font-medium text-ink">{seatRoom.CLASSROOM_LABEL}</span>
          <span className="mono text-[10px] text-ink-3">{seatRoom.CLASSROOM_CODE}</span>
          <span className="mono ms-auto text-[10px] text-ink-3">
            {seats.length} {seats.length === 1 ? tr('seat') : tr('seats')}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[4px] border border-line bg-canvas p-2.5">
          <div>
            <label className="kicker mb-1 block text-[9px]" htmlFor="seat-new">{tr('Seat number')}</label>
            <input
              id="seat-new"
              type="number"
              min="1"
              value={seatNew}
              onChange={(event) => setSeatNew(event.target.value)}
              className="field h-7 w-24 text-[11.5px]"
            />
          </div>
          <button
            type="button"
            onClick={addSeat}
            disabled={!seatNew}
            className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted disabled:opacity-40"
          >
            <Plus size={11} /> {tr('Add seat')}
          </button>
          <div className="ms-auto flex items-end gap-2">
            <div>
              <label className="kicker mb-1 block text-[9px]" htmlFor="seat-count">{tr('Ensure seats up to')}</label>
              <input
                id="seat-count"
                type="number"
                min="1"
                value={seatGen}
                onChange={(event) => setSeatGen(event.target.value)}
                className="field h-7 w-24 text-[11.5px]"
              />
            </div>
            <button
              type="button"
              onClick={generateSeats}
              disabled={!seatGen}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted disabled:opacity-40"
            >
              {tr('Generate')}
            </button>
          </div>
        </div>

        <ul className="mt-2 max-h-[46vh] divide-y divide-line overflow-y-auto rounded-[4px] border border-line">
          {seats.length === 0 ? (
            <li className="px-3 py-6 text-center text-[11.5px] text-ink-3">{tr('This room has no seats yet.')}</li>
          ) : (
            seats.map((seat) => {
              const number = seat.SEAT_NUMBER ?? seat.seat_number
              return (
                <li key={number} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="mono w-10 text-[11px] text-ink">{number}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">
                    {seat.OCCUPANT_NAME || tr('Free')}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSeat(number)}
                    title={tr('Remove seat')}
                    aria-label={`${tr('Remove seat')} ${number}`}
                    className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {tabButton('rooms', tr('Rooms'))}
        {tabButton('categories', tr('Categories'))}
        {tab === 'rooms' && (
          <div className="relative ms-auto w-full max-w-[220px]">
            <Search className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tr('Search rooms…')}
              aria-label={tr('Search rooms')}
              className="field h-7 w-full ps-6 text-[11.5px]"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => (tab === 'rooms' ? setRoomForm(emptyRoom()) : setCategoryForm(emptyCategory()))}
          className={`inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 ${tab === 'rooms' ? '' : 'ms-auto'}`}
        >
          <Plus size={11} /> {tab === 'rooms' ? tr('Add room') : tr('Add category')}
        </button>
      </div>

      {error && !roomForm && !categoryForm && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] font-medium" style={{ color: 'var(--color-danger-ink)' }}>
          <AlertCircle size={12} className="mt-px shrink-0" /> {error}
        </div>
      )}

      <Modal
        open={!!roomForm && !editingRoomId}
        onClose={() => setRoomForm(null)}
        title={tr('Add room')}
        maxWidth="max-w-[560px]"
        footer={roomActions}
      >
        <form id={roomFormId} onSubmit={saveRoom}>
          {roomFields}
        </form>
      </Modal>

      <Modal
        open={!!categoryForm && !editingCategoryId}
        onClose={() => setCategoryForm(null)}
        title={tr('Add category')}
        maxWidth="max-w-[520px]"
        footer={categoryActions}
      >
        <form id={categoryFormId} onSubmit={saveCategory}>
          {categoryFields}
        </form>
      </Modal>

      <div className="mt-2 overflow-x-auto rounded-[4px] border border-line">
        {tab === 'rooms' ? (
          <DataTable
            className="data-table"
            label={tr('Classrooms')}
            columns={[
              { key: 'c0', width: 90, header: <>{tr('Code')}</> },
              { key: 'c1', header: <>{tr('Label')}</> },
              { key: 'c2', width: 160, header: <>{tr('Category')}</> },
              { key: 'c3', width: 90, className: "num", header: <>{tr('Capacity')}</> },
              { key: 'c4', width: 104 },
            ]}
          >
              {loading && rooms.length === 0 ? (
                <tr><td colSpan={5} className="!h-16 text-center text-[11.5px] text-ink-3">{tr('Loading…')}</td></tr>
              ) : visibleRooms.length === 0 ? (
                <tr><td colSpan={5} className="!h-16 text-center text-[11.5px] text-ink-3">
                  {rooms.length === 0 ? tr('No room has been recorded yet.') : tr('Nothing matches this search.')}
                </td></tr>
              ) : (
                visibleRooms.map((room) => {
                  if (editingRoomId !== null && String(room.CLASSROOM_ID) === String(editingRoomId)) {
                    return (
                      <tr key={room.CLASSROOM_ID} className="bg-canvas">
                        <td colSpan={5} className="!p-3">
                          <form
                            id={roomFormId}
                            onSubmit={saveRoom}
                            onKeyDown={(event) => { if (event.key === 'Escape') setRoomForm(null) }}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="kicker text-[9px]">{tr('Edit room')}</span>
                              <span className="mono text-[9.5px] text-ink-3">#{room.CLASSROOM_ID}</span>
                            </div>
                            {roomFields}
                            <div className="mt-3">{roomActions}</div>
                          </form>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr key={room.CLASSROOM_ID}>
                      <td className="mono text-[10.5px] text-ink-3">{room.CLASSROOM_CODE}</td>
                      <td className="font-medium text-ink">{room.CLASSROOM_LABEL || '—'}</td>
                      <td className="text-ink-3">{categoryLabel(room.CLASSROOM_CATEGORY_ID) || '—'}</td>
                      <td className="num">{room.CLASSROOM_CAPACITY || '—'}</td>
                      <td className="!pe-2 text-end">
                        <span className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setRoomForm({
                              CLASSROOM_ID: room.CLASSROOM_ID,
                              CLASSROOM_CODE: room.CLASSROOM_CODE || '',
                              CLASSROOM_LABEL_EN: room.CLASSROOM_LABEL_EN ?? room.CLASSROOM_LABEL ?? '',
                              CLASSROOM_LABEL_AR: room.CLASSROOM_LABEL_AR || '',
                              CLASSROOM_LABEL_FR: room.CLASSROOM_LABEL_FR || '',
                              CLASSROOM_CAPACITY: room.CLASSROOM_CAPACITY || '',
                              CLASSROOM_CATEGORY_ID: room.CLASSROOM_CATEGORY_ID || ''
                            })}
                            title={tr('Edit')}
                            aria-label={`${tr('Edit')} ${room.CLASSROOM_CODE}`}
                            className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openSeats(room)}
                            title={tr('Seats')}
                            aria-label={`${tr('Seats')} — ${room.CLASSROOM_CODE}`}
                            className="inline-flex h-6 items-center rounded-[3px] px-1.5 text-[10.5px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                          >
                            {tr('Seats')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm({ kind: 'room', id: room.CLASSROOM_ID })}
                            title={tr('Delete')}
                            aria-label={`${tr('Delete')} ${room.CLASSROOM_CODE}`}
                            className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
          </DataTable>
        ) : (
          <DataTable
            className="data-table"
            label={tr('Classroom categories')}
            columns={[
              { key: 'c0', width: 120, header: <>{tr('Code')}</> },
              { key: 'c1', header: <>{tr('Label')}</> },
              { key: 'c2', width: 104 },
            ]}
          >
              {categories.length === 0 ? (
                <tr><td colSpan={3} className="!h-16 text-center text-[11.5px] text-ink-3">{tr('No category has been recorded yet.')}</td></tr>
              ) : (
                categories.map((category) => {
                  if (editingCategoryId !== null && String(category.CLASSROOM_CATEGORY_ID) === String(editingCategoryId)) {
                    return (
                      <tr key={category.CLASSROOM_CATEGORY_ID} className="bg-canvas">
                        <td colSpan={3} className="!p-3">
                          <form
                            id={categoryFormId}
                            onSubmit={saveCategory}
                            onKeyDown={(event) => { if (event.key === 'Escape') setCategoryForm(null) }}
                          >
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="kicker text-[9px]">{tr('Edit category')}</span>
                              <span className="mono text-[9.5px] text-ink-3">#{category.CLASSROOM_CATEGORY_ID}</span>
                            </div>
                            {categoryFields}
                            <div className="mt-3">{categoryActions}</div>
                          </form>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr key={category.CLASSROOM_CATEGORY_ID}>
                      <td className="mono text-[10.5px] text-ink-3">{category.CLASSROOM_CATEGORY_CODE}</td>
                      <td className="font-medium text-ink">{category.CLASSROOM_CATEGORY_LABEL || '—'}</td>
                      <td className="!pe-2 text-end">
                        <span className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => setCategoryForm({
                              CLASSROOM_CATEGORY_ID: category.CLASSROOM_CATEGORY_ID,
                              CLASSROOM_CATEGORY_CODE: category.CLASSROOM_CATEGORY_CODE || '',
                              CLASSROOM_CATEGORY_LABEL_EN: category.CLASSROOM_CATEGORY_LABEL_EN ?? category.CLASSROOM_CATEGORY_LABEL ?? '',
                              CLASSROOM_CATEGORY_LABEL_AR: category.CLASSROOM_CATEGORY_LABEL_AR || '',
                              CLASSROOM_CATEGORY_LABEL_FR: category.CLASSROOM_CATEGORY_LABEL_FR || ''
                            })}
                            title={tr('Edit')}
                            aria-label={`${tr('Edit')} ${category.CLASSROOM_CATEGORY_CODE}`}
                            className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm({ kind: 'category', id: category.CLASSROOM_CATEGORY_ID })}
                            title={tr('Delete')}
                            aria-label={`${tr('Delete')} ${category.CLASSROOM_CATEGORY_CODE}`}
                            className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
          </DataTable>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'room' ? tr('Delete room') : tr('Delete category')}
        message={confirm?.kind === 'room'
          ? tr('Delete this room? Sessions and seats that point at it keep their stored value.')
          : tr('Delete this category? Rooms in it become uncategorised.')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const target = confirm
          setConfirm(null)
          if (target) removeRow(target.kind, target.id)
        }}
      />
    </>
  )
}

// The dialog Settings opens for a register.
const RegistersDialog = ({ register, user, onClose }) => {
  const config = register ? REGISTERS[register] : null
  const [message, setMessage] = useState(null)

  useEffect(() => {
    setMessage(null)
  }, [register])

  if (!config) return null

  return (
    <Modal
      open={!!register}
      onClose={onClose}
      title={tr(config.title)}
      maxWidth="max-w-[900px]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10.5px] text-ink-3">
            {message?.text || tr('Changes are saved immediately and apply to every account.')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted"
          >
            {tr('Close')}
          </button>
        </div>
      }
    >
      <p className="text-[12px] leading-relaxed text-ink-2">{tr(config.description)}</p>
      <div className="mt-3">
        {register === 'classrooms'
          ? <ClassroomsEditor onMessage={setMessage} />
          : <RegisterEditor key={register} config={config} onMessage={setMessage} userId={user?.id} />}
      </div>
    </Modal>
  )
}

export default RegistersDialog
