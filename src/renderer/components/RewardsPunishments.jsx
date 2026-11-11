import React, { useState, useEffect, useMemo, useRef } from 'react'
import { formatDate } from '../dateFormat'
import DataTable from './ui/DataTable'
import { Gavel, Award, Trash2, Pencil, Search, AlertCircle, Check, Plus, Users, X } from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import PhotoZoom from './ui/PhotoZoom'
import Notice from './ui/Notice'
import SplitPane from './ui/SplitPane'
import Modal from './ui/Modal'
import { PageHeader, PanelHeader } from './ui/PageHeader'
import { localizedLabel, tr } from '../i18n'
import { personNameLastFirst } from '../../shared/personNames'

const fmtDate = (v) => {
  if (!v) return '—'
  const m = typeof v === 'string' ? v.match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v)
  return isNaN(d.getTime())
    ? '—'
    : formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

const plural = (count, singular, pluralForm) =>
  `${count} ${count === 1 ? singular : pluralForm}`

// The date column comes back as a Date, but an edit form needs the plain
// YYYY-MM-DD an <input type="date"> speaks. The Date is read through its local
// parts — it is midnight in the machine's own time zone, so converting it to
// UTC first would move the entry to the previous day east of Greenwich.
const isoDate = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value.slice(0, 10)
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Inclusive end date: a 3-day duration starting on 2026-10-10 ends on
// 2026-10-12 (start + duration - 1 day), never on the 13th.
const endDate = (start, duration) => {
  const days = Number(duration)
  if (!start || !Number.isInteger(days) || days < 1) return ''
  const [y, m, d] = start.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(Date.UTC(y, m - 1, d + days - 1)).toISOString().slice(0, 10)
}

const scheduleText = (start, end, duration) => {
  if (!start) return tr('Immediate · no dates')
  const days = Number(duration)
  const suffix = Number.isInteger(days) && days > 0 ? ` · ${days}d` : ''
  return `${fmtDate(start)} → ${fmtDate(end)}${suffix}`
}

const initial = (student) =>
  `${student.PERSON_FIRST_NAME?.[0] || ''}${student.PERSON_LAST_NAME?.[0] || ''}`.toUpperCase()

const studentName = (student) => `${student.PERSON_LAST_NAME} ${student.PERSON_FIRST_NAME}`

// Student photos are stored as paths, so the register reads them in one batch
// and keeps the data URLs by person id. A student without a file keeps their
// initials at every size; the sizes are deliberately generous enough to
// recognise a face, not just to mark the row.
const StudentPhoto = ({ student, photo, size = 'row' }) => {
  const box = size === 'hero'
    ? 'h-32 w-32 text-[30px]'
    : size === 'list'
      ? 'h-20 w-20 text-[20px]'
      : 'h-14 w-14 text-[13px]'
  return (
    <span className={`serif grid shrink-0 place-items-center overflow-hidden rounded-[3px] border border-line-strong bg-surface-muted text-ink-3 ${box}`}>
      {photo
        ? <PhotoZoom src={photo} alt={studentName(student)} />
        : initial(student) || '?'}
    </span>
  )
}

// The entry form, shared by the single-student ledger, the bulk dialog and the
// edit dialog so all three apply exactly the same rules: a type, and either an
// immediate entry or a start date with a duration. The parent owns the write;
// the fields clear themselves only once it resolves, so a refused entry keeps
// what was typed. In the edit dialog `initial` seeds the fields from the entry
// being changed and the values stay put, because the dialog closes on success.
const EntryForm = ({ kind, types, canRecord, saving, onSubmit, submitLabel, savingLabel, compact = false, initial = null, onCancel = null }) => {
  const [typeId, setTypeId] = useState(initial ? String(initial.typeId ?? '') : '')
  const [justificationId, setJustificationId] = useState(initial ? String(initial.justificationId ?? '') : '')
  const [mode, setMode] = useState(initial?.mode || 'scheduled')
  const [start, setStart] = useState(initial?.start || '')
  const [duration, setDuration] = useState(initial?.duration ? String(initial.duration) : '')
  const [note, setNote] = useState(initial?.note || '')

  const typeList = kind === 'punishment' ? types.punishmentTypes : types.rewardTypes
  // The reason is part of the entry, exactly like an absence justification: it
  // is seeded reference data, so the form offers it as a list.
  const justificationList = kind === 'punishment'
    ? types.punishmentJustifications || []
    : types.rewardJustifications || []
  const end = mode === 'scheduled' ? endDate(start, duration) : ''
  const ready = !!typeId && !!justificationId && (mode === 'immediate' || (!!start && Number(duration) >= 1))

  const submit = async (event) => {
    event.preventDefault()
    if (!ready || saving || !canRecord) return
    try {
      await onSubmit({
        typeId,
        justificationId,
        startDate: mode === 'scheduled' ? start : null,
        duration: mode === 'scheduled' ? Number(duration) : null,
        note: note || null
      })
      // An edit keeps the values it was seeded with: the dialog closes on
      // success, and a re-opened row must show the entry as it now stands.
      if (!initial) {
        setTypeId('')
        setJustificationId('')
        setStart('')
        setDuration('')
        setNote('')
      }
    } catch {
      // The caller reports the reason; the values stay for a retry.
    }
  }

  const grid = compact
    ? 'grid grid-cols-4 gap-2.5 px-3 py-3'
    : 'grid grid-cols-1 gap-2.5 px-4 py-3 md:grid-cols-2 xl:grid-cols-4'
  const typeSpan = compact ? 'col-span-2' : 'xl:col-span-2'
  const noteSpan = compact ? 'col-span-2' : 'md:col-span-2 xl:col-span-2'
  const buttonSpan = compact ? 'col-span-4' : 'md:col-span-2 xl:col-span-2'

  return (
    <form className={grid} onSubmit={submit}>
      <div className={typeSpan}>
        <label className="field-label">{tr(kind === 'punishment' ? 'Punishment type' : 'Reward type')}</label>
        <select
          value={typeId}
          onChange={(event) => setTypeId(event.target.value)}
          className="field"
          required
        >
          <option value="">{tr('Select type…')}</option>
          {typeList.map((type) => (
            <option
              key={type.PUNISHMENT_TYPE_ID || type.REWARD_TYPE_ID}
              value={type.PUNISHMENT_TYPE_ID || type.REWARD_TYPE_ID}
            >
              {localizedLabel(type, 'PUNISHMENT_LABEL') ||
                localizedLabel(type, 'REWARD_LABEL') ||
                type.PUNISHMENT_LABEL_EN ||
                type.REWARD_LABEL_EN}
            </option>
          ))}
        </select>
      </div>

      <div className={typeSpan}>
        <label className="field-label">
          {tr(kind === 'punishment' ? 'Punishment justification' : 'Reward justification')}
        </label>
        <select
          value={justificationId}
          onChange={(event) => setJustificationId(event.target.value)}
          className="field"
          required
        >
          <option value="">{tr('Select justification…')}</option>
          {justificationList.map((justification) => (
            <option
              key={justification.PUNISHMENT_JUSTIFICATION_ID || justification.REWARD_JUSTIFICATION_ID}
              value={justification.PUNISHMENT_JUSTIFICATION_ID || justification.REWARD_JUSTIFICATION_ID}
            >
              {localizedLabel(justification, 'PUNISHMENT_JUSTIFICATION_LABEL') ||
                localizedLabel(justification, 'REWARD_JUSTIFICATION_LABEL')}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="field-label">{tr('Timing')}</label>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line-strong bg-line">
          {[
            ['scheduled', tr('Scheduled')],
            ['immediate', tr('Immediate')]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`h-[30px] text-[11px] ${mode === value ? 'bg-selection text-ink' : 'bg-surface text-ink-3 hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="field-label">{tr('Starts')}</label>
        <input
          type="date"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          disabled={mode === 'immediate'}
          className="field"
        />
      </div>

      <div>
        <label className="field-label">{tr('Duration (days)')}</label>
        <input
          type="number"
          min="1"
          step="1"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          disabled={mode === 'immediate'}
          placeholder="—"
          className="field"
        />
      </div>

      <div>
        <label className="field-label">{tr('Ends')}</label>
        <div className="mono flex h-[32px] items-center rounded-[4px] border border-line bg-surface-muted px-2 text-[11px] text-ink-2">
          {mode === 'immediate' ? tr('Immediate') : end ? fmtDate(end) : '—'}
        </div>
      </div>

      <div className={noteSpan}>
        <label className="field-label">{tr('Note')}</label>
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={tr('Reason, context, or office reference')}
          className="field"
        />
      </div>

      <div className={`flex items-end gap-2 ${buttonSpan}`}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] text-ink-2 hover:bg-surface-muted"
          >
            {tr('Cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={!ready || saving || !canRecord}
          className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-line-strong px-3 text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
            kind === 'punishment'
              ? 'bg-danger-bg text-danger-ink hover:brightness-110'
              : 'bg-success-bg text-success-ink hover:brightness-110'
          }`}
        >
          {kind === 'punishment' ? <Gavel size={12} /> : <Award size={12} />}
          {saving ? savingLabel : submitLabel}
        </button>
      </div>
    </form>
  )
}

// Apply one entry to a whole group. The group is built here — by student, by
// section, by category — and every member can be taken back out before the
// entry is written. The server checks the scope of the whole batch, so nothing
// is written if one recipient turns out to be outside the account's categories.
const BulkApplyDialog = ({ open, onClose, user, students, types, permissions, onApplied, photoCache = {} }) => {
  const [kind, setKind] = useState('punishment')
  const [recipients, setRecipients] = useState([])
  const [addBy, setAddBy] = useState('student')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // A fresh group each time it opens: the previous batch is never applied twice.
  useEffect(() => {
    if (!open) return
    setRecipients([])
    setQuery('')
    setAddBy('student')
    setError('')
  }, [open])

  const chosen = useMemo(() => new Set(recipients.map((r) => Number(r.PERSON_ID))), [recipients])

  const sections = useMemo(() => {
    const map = new Map()
    students.forEach((student) => {
      if (student.SECTION_ID == null) return
      const entry = map.get(student.SECTION_ID) || {
        id: student.SECTION_ID,
        label: student.SECTION_LABEL || `#${student.SECTION_ID}`,
        category: student.TEACHING_CATEGORY_LABEL || '',
        members: []
      }
      entry.members.push(student)
      map.set(student.SECTION_ID, entry)
    })
    return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [students])

  const categories = useMemo(() => {
    const map = new Map()
    students.forEach((student) => {
      if (student.TEACHING_CATEGORY_ID == null) return
      const entry = map.get(student.TEACHING_CATEGORY_ID) || {
        id: student.TEACHING_CATEGORY_ID,
        label: student.TEACHING_CATEGORY_LABEL || `#${student.TEACHING_CATEGORY_ID}`,
        members: []
      }
      entry.members.push(student)
      map.set(student.TEACHING_CATEGORY_ID, entry)
    })
    return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [students])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return students
    return students.filter((student) =>
      `${student.PERSON_FIRST_NAME} ${student.PERSON_LAST_NAME} ${student.PERSON_ID}`
        .toLowerCase()
        .includes(q)
    )
  }, [students, query])

  const addStudents = (rows) => {
    setRecipients((current) => {
      const seen = new Set(current.map((r) => Number(r.PERSON_ID)))
      const next = [...current]
      rows.forEach((row) => {
        const id = Number(row.PERSON_ID)
        if (!seen.has(id)) {
          seen.add(id)
          next.push(row)
        }
      })
      return next
    })
  }

  const removeStudent = (personId) => {
    setRecipients((current) => current.filter((r) => Number(r.PERSON_ID) !== Number(personId)))
  }

  const canRecord = kind === 'punishment' ? permissions.canAddPunishments : permissions.canAddRewards

  const submit = async ({ typeId, justificationId, startDate, duration, note }) => {
    const ids = recipients.map((r) => Number(r.PERSON_ID))
    if (ids.length === 0) {
      const empty = new Error(tr('Add at least one student to the group.'))
      setError(empty.message)
      throw empty
    }

    setSaving(true)
    setError('')
    try {
      const res = kind === 'punishment'
        ? await window.api.applyPunishmentBulk(user.id, {
          STUDENT_PERSON_IDS: ids,
          PUNISHMENT_TYPE_ID: typeId,
          PUNISHMENT_JUSTIFICATION_ID: justificationId,
          PUNISHMENT_START_DATE: startDate,
          PUNISHMENT_DURATION: duration,
          PUNISHMENT_NOTE: note
        })
        : await window.api.applyRewardBulk(user.id, {
          STUDENT_PERSON_IDS: ids,
          REWARD_TYPE_ID: typeId,
          REWARD_JUSTIFICATION_ID: justificationId,
          REWARD_START_DATE: startDate,
          REWARD_DURATION: duration,
          REWARD_NOTE: note
        })
      onApplied(res?.count || ids.length, kind)
      onClose()
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSaving(false)
    }
  }

  const groupList = (rows) => (
    <div className="h-[156px] overflow-y-auto rounded-[3px] border border-line">
      {rows.length === 0 ? (
        <p className="px-2.5 py-6 text-center text-[11px] text-ink-3">{tr('Nothing to add here.')}</p>
      ) : (
        rows.map((row) => {
          const addedAll = row.members.every((member) => chosen.has(Number(member.PERSON_ID)))
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => addStudents(row.members)}
              disabled={addedAll}
              className="flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-start last:border-b-0 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] text-ink">{row.label}</span>
                <span className="mono block truncate text-[9.5px] text-ink-3">
                  {plural(row.members.length, tr('student'), tr('students'))}
                  {row.category ? ` · ${row.category}` : ''}
                </span>
              </span>
              <span className="mono shrink-0 text-[10px] text-ink-3">
                {addedAll ? tr('ADDED') : tr('ADD ALL')}
              </span>
            </button>
          )
        })
      )}
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr('Apply the same entry to a group')}
      maxWidth="max-w-[880px]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[10px] text-ink-3">
            {recipients.length === 0
              ? tr('NO RECIPIENT YET')
              : plural(recipients.length, tr('RECIPIENT'), tr('RECIPIENTS'))}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted"
          >
            {tr('Close')}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line-strong bg-line">
            {[
              ['punishment', tr('Punishment'), Gavel],
              ['reward', tr('Reward'), Award]
            ].map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[11px] ${
                  kind === value ? 'bg-selection text-ink' : 'bg-surface text-ink-3 hover:text-ink'
                }`}
              >
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>
          <span className="mono text-[10px] text-ink-3">{tr('ONE ENTRY, MANY STUDENTS')}</span>
        </div>

        <section className="overflow-hidden rounded-md border border-line bg-surface">
          <PanelHeader
            title={tr('The entry')}
            meta={kind === 'punishment' ? tr('PUNISHMENT') : tr('REWARD')}
            actions={!canRecord ? (
              <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--color-warning-ink)' }}>
                <AlertCircle size={11} />
                {tr('Your account may not record this entry. Ask an administrator.')}
              </span>
            ) : undefined}
          />
          <EntryForm
            key={kind}
            kind={kind}
            types={types}
            canRecord={canRecord}
            saving={saving}
            onSubmit={submit}
            compact
            submitLabel={recipients.length > 0
              ? `${tr('Apply to')} ${recipients.length}`
              : tr('Apply')}
            savingLabel={tr('Applying…')}
          />
        </section>

        <section className="overflow-hidden rounded-md border border-line bg-surface">
          <PanelHeader
            title={tr('Recipients')}
            meta={recipients.length}
            actions={recipients.length > 0 ? (
              <button
                type="button"
                onClick={() => setRecipients([])}
                className="mono text-[10px] text-ink-3 hover:text-danger-ink"
              >
                {tr('CLEAR')}
              </button>
            ) : undefined}
          />
          <div className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_286px]">
            <div className="min-w-0">
              <div className="mb-2 grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-line-strong bg-line">
                {[
                  ['student', tr('By student')],
                  ['section', tr('By section')],
                  ['category', tr('By category')]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAddBy(value)}
                    className={`h-[28px] text-[11px] ${
                      addBy === value ? 'bg-selection text-ink' : 'bg-surface text-ink-3 hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {addBy === 'student' && (
                <>
                  <div className="relative mb-1.5">
                    <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                    <input
                      type="text"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={tr('Name or person ID')}
                      aria-label={tr('Search students')}
                      className="field h-7 ps-6 text-[11.5px]"
                    />
                  </div>
                  <div className="h-[152px] overflow-y-auto rounded-[3px] border border-line">
                    {matches.length === 0 ? (
                      <p className="px-2.5 py-6 text-center text-[11px] text-ink-3">
                        {tr('No student matches this search.')}
                      </p>
                    ) : (
                      matches.map((student) => {
                        const added = chosen.has(Number(student.PERSON_ID))
                        return (
                          <button
                            key={student.PERSON_ID}
                            type="button"
                            onClick={() => addStudents([student])}
                            disabled={added}
                            className="flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-start last:border-b-0 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                          >
                            <StudentPhoto
                              student={student}
                              photo={photoCache[Number(student.PERSON_ID)]}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[11.5px] text-ink">{studentName(student)}</span>
                              <span className="mono block truncate text-[9.5px] text-ink-3">
                                {student.SECTION_LABEL || '—'}
                              </span>
                            </span>
                            {added
                              ? <Check size={12} className="shrink-0 text-ink-3" />
                              : <Plus size={12} className="shrink-0 text-ink-3" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </>
              )}

              {addBy === 'section' && groupList(sections)}
              {addBy === 'category' && groupList(categories)}
            </div>

            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between border-b border-line pb-1.5">
                <span className="kicker text-[9.5px]">{tr('The group')}</span>
                <span className="mono text-[10px] text-ink-3">{recipients.length}</span>
              </div>
              <div className="h-[190px] overflow-y-auto rounded-[3px] border border-line">
                {recipients.length === 0 ? (
                  <p className="px-2.5 py-6 text-center text-[11px] text-ink-3">
                    {tr('Nobody yet. Add a student, a whole section or a whole category.')}
                  </p>
                ) : (
                  recipients.map((student) => (
                    <div
                      key={student.PERSON_ID}
                      className="flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-b-0"
                    >
                      <StudentPhoto
                        student={student}
                        photo={photoCache[Number(student.PERSON_ID)]}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] text-ink">{studentName(student)}</span>
                        <span className="mono block truncate text-[9.5px] text-ink-3">
                          {student.SECTION_LABEL || '—'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStudent(student.PERSON_ID)}
                        aria-label={tr('Remove from the group')}
                        title={tr('Remove from the group')}
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div
            className="flex items-center gap-2 rounded-[3px] border border-line px-2.5 py-1.5 text-[11px]"
            style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }}
          >
            <AlertCircle size={12} /> {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

const RewardsPunishments = ({ user }) => {
  const [students, setStudents] = useState([])
  const [types, setTypes] = useState({
    punishmentTypes: [],
    rewardTypes: [],
    punishmentJustifications: [],
    rewardJustifications: []
  })
  const [photoCache, setPhotoCache] = useState({})
  const photosInFlight = useRef(new Set())
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState(null)
  const [history, setHistory] = useState({ punishments: [], rewards: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')
  // Non-null when this account only sees the students of its own categories.
  const [scopeLabel, setScopeLabel] = useState(null)
  // What this account may do to the ledger (secretary_detail): add, edit and
  // delete, for punishments and rewards. An admin is never limited, so these
  // start granted and are narrowed by the server.
  const [permissions, setPermissions] = useState({
    canAddPunishments: true,
    canEditPunishments: true,
    canDeletePunishments: true,
    canAddRewards: true,
    canEditRewards: true,
    canDeleteRewards: true
  })
  const [entryKind, setEntryKind] = useState('punishment')
  const [savingEntry, setSavingEntry] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [studentsRes, typesRes, scopeRes] = await Promise.all([
          window.api.getRewardsPunishmentsStudents(user?.id),
          window.api.getRewardsPunishmentsTypes(),
          window.api.getMyTeachingScope(user?.id).catch(() => null)
        ])
        if (scopeRes?.restricted) {
          setScopeLabel((scopeRes.categories || []).map(c => c.TEACHING_CATEGORY_LABEL).join(', '))
        }
        if (scopeRes?.permissions) {
          setPermissions((prev) => ({ ...prev, ...scopeRes.permissions }))
        }
        setStudents(studentsRes?.data || [])
        setTypes({
          punishmentTypes: typesRes?.punishmentTypes || [],
          rewardTypes: typesRes?.rewardTypes || [],
          punishmentJustifications: typesRes?.punishmentJustifications || [],
          rewardJustifications: typesRes?.rewardJustifications || []
        })
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const loadHistory = async (personId) => {
    if (!personId) { setHistory({ punishments: [], rewards: [] }); return }
    try {
      const res = await window.api.getStudentRewardsPunishments(user?.id, personId)
      setHistory({ punishments: res.punishments || [], rewards: res.rewards || [] })
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (selectedStudentId) loadHistory(selectedStudentId)
    else setHistory({ punishments: [], rewards: [] })
  }, [selectedStudentId])

  // One batched photo read per set of students; results are cached by person id
  // so selecting a student or opening the bulk dialog never re-reads a file.
  useEffect(() => {
    const wanted = students
      .map((student) => ({
        id: Number(student.PERSON_ID),
        path: student.PERSON_PHOTO || student.person_photo || null
      }))
      .filter((entry) => entry.path
        && photoCache[entry.id] === undefined
        && !photosInFlight.current.has(entry.id))
    if (wanted.length === 0) return

    wanted.forEach((entry) => photosInFlight.current.add(entry.id))
    window.api.readPersonPhotos(wanted.map((entry) => entry.path))
      .then((res) => {
        const dataUrls = res?.dataUrls || []
        setPhotoCache((prev) => {
          const next = { ...prev }
          wanted.forEach((entry, index) => { next[entry.id] = dataUrls[index] || null })
          return next
        })
      })
      // An unreadable photo is not an error: the row keeps its initials.
      .catch(() => {})
      .finally(() => { wanted.forEach((entry) => photosInFlight.current.delete(entry.id)) })
  }, [students, photoCache])

  const showFlash = (msg) => {
    setFlash(msg)
    setTimeout(() => setFlash(''), 3000)
  }

  const selectedStudent = students.find(s => Number(s.PERSON_ID) === Number(selectedStudentId))
  const filteredStudents = useMemo(() => {
    if (!studentSearch) return students
    const q = studentSearch.toLowerCase()
    return students.filter(s =>
      `${s.PERSON_FIRST_NAME} ${s.PERSON_LAST_NAME} ${s.PERSON_ID}`.toLowerCase().includes(q)
    )
  }, [students, studentSearch])

  // Both handlers rethrow so the form keeps its values when the server refuses.
  const handleApplyPunishment = async ({ typeId, justificationId, startDate, duration, note }) => {
    setError('')
    setSavingEntry(true)
    try {
      await window.api.applyPunishment(user.id, {
        STUDENT_PERSON_ID: selectedStudentId,
        PUNISHMENT_TYPE_ID: typeId,
        PUNISHMENT_JUSTIFICATION_ID: justificationId,
        PUNISHMENT_START_DATE: startDate,
        PUNISHMENT_DURATION: duration,
        PUNISHMENT_NOTE: note
      })
      showFlash(startDate === null ? tr('Immediate punishment applied.') : tr('Punishment applied.'))
      await loadHistory(selectedStudentId)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSavingEntry(false)
    }
  }

  const handleApplyReward = async ({ typeId, justificationId, startDate, duration, note }) => {
    setError('')
    setSavingEntry(true)
    try {
      await window.api.applyReward(user.id, {
        STUDENT_PERSON_ID: selectedStudentId,
        REWARD_TYPE_ID: typeId,
        REWARD_JUSTIFICATION_ID: justificationId,
        REWARD_START_DATE: startDate,
        REWARD_DURATION: duration,
        REWARD_NOTE: note
      })
      showFlash(startDate === null ? tr('Immediate reward applied.') : tr('Reward applied.'))
      await loadHistory(selectedStudentId)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSavingEntry(false)
    }
  }

  const handleDeletePunishment = async (id) => {
    try {
      await window.api.deletePunishment(user.id, id)
      await loadHistory(selectedStudentId)
    } catch (err) { setError(err.message) }
  }

  const handleDeleteReward = async (id) => {
    try {
      await window.api.deleteReward(user.id, id)
      await loadHistory(selectedStudentId)
    } catch (err) { setError(err.message) }
  }

  // Editing an entry that is already on the record. The entry id and its student
  // are the ones the page already holds; only the fields the form owns change.
  const handleUpdatePunishment = async ({ typeId, justificationId, startDate, duration, note }) => {
    if (!editTarget) return
    setError('')
    setSavingEntry(true)
    try {
      await window.api.updatePunishment(user.id, editTarget.id, {
        PUNISHMENT_TYPE_ID: typeId,
        PUNISHMENT_JUSTIFICATION_ID: justificationId,
        PUNISHMENT_START_DATE: startDate,
        PUNISHMENT_DURATION: duration,
        PUNISHMENT_NOTE: note
      })
      setEditTarget(null)
      showFlash(tr('Punishment updated.'))
      await loadHistory(selectedStudentId)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSavingEntry(false)
    }
  }

  const handleUpdateReward = async ({ typeId, justificationId, startDate, duration, note }) => {
    if (!editTarget) return
    setError('')
    setSavingEntry(true)
    try {
      await window.api.updateReward(user.id, editTarget.id, {
        REWARD_TYPE_ID: typeId,
        REWARD_JUSTIFICATION_ID: justificationId,
        REWARD_START_DATE: startDate,
        REWARD_DURATION: duration,
        REWARD_NOTE: note
      })
      setEditTarget(null)
      showFlash(tr('Reward updated.'))
      await loadHistory(selectedStudentId)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSavingEntry(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-ink-3 font-medium">{tr("Loading rewards and punishments data...")}</div>
      </div>
    )
  }

  const entries = [
    ...history.punishments.map((entry) => ({
      key: `punishment-${entry.PUNISHMENT_ID}`,
      kind: 'punishment',
      id: entry.PUNISHMENT_ID,
      label: localizedLabel(entry, 'PUNISHMENT_LABEL'),
      typeId: entry.PUNISHMENT_TYPE_ID,
      justificationId: entry.PUNISHMENT_JUSTIFICATION_ID,
      start: entry.PUNISHMENT_START_DATE,
      end: entry.PUNISHMENT_END_DATE,
      duration: entry.PUNISHMENT_DURATION,
      note: entry.PUNISHMENT_NOTE,
      justification: localizedLabel(entry, 'PUNISHMENT_JUSTIFICATION_LABEL')
    })),
    ...history.rewards.map((entry) => ({
      key: `reward-${entry.REWARD_ID}`,
      kind: 'reward',
      id: entry.REWARD_ID,
      label: localizedLabel(entry, 'REWARD_LABEL'),
      typeId: entry.REWARD_TYPE_ID,
      justificationId: entry.REWARD_JUSTIFICATION_ID,
      start: entry.REWARD_START_DATE,
      end: entry.REWARD_END_DATE,
      duration: entry.REWARD_DURATION,
      note: entry.REWARD_NOTE,
      justification: localizedLabel(entry, 'REWARD_JUSTIFICATION_LABEL')
    }))
  ].sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')) || Number(b.id) - Number(a.id))

  // The six rights are granted per account on the Secretary accounts page and
  // in Settings → Administration; the server refuses either way, so here they
  // only decide what is offered. Recording a new entry needs the add right,
  // changing one that exists needs the edit right.
  const canRecord = entryKind === 'punishment' ? permissions.canAddPunishments : permissions.canAddRewards
  const canEditEntry = (kind) => (
    kind === 'punishment' ? permissions.canEditPunishments : permissions.canEditRewards
  )
  const canDeleteEntry = (kind) => (
    kind === 'punishment' ? permissions.canDeletePunishments : permissions.canDeleteRewards
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice
        notice={flash ? { type: 'success', text: flash } : null}
        onDismiss={() => setFlash('')}
      />

      <PageHeader
        kicker={tr('Student conduct')}
        title={tr('Rewards & punishments')}
        meta={`${students.length} ${tr('students')}`}
        actions={
          <>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              disabled={students.length === 0}
              title={tr('Apply the same entry to a group of students')}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Users size={11} /> {tr('Apply to a group')}
            </button>
            <span className="mono hidden text-[10px] text-ink-3 md:inline">
              {selectedStudentId ? `${tr('In file')}: ${entries.length}` : tr('No student open')}
            </span>
          </>
        }
      />

      {scopeLabel !== null && (
        <div
          className="flex min-h-8 shrink-0 items-center gap-2 border-b border-line px-5 py-1.5 text-[11px]"
          style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning-ink)' }}
        >
          <AlertCircle size={12} className="shrink-0" />
          {scopeLabel
            ? `${tr('Only students in your teaching categories are listed')} (${scopeLabel}).`
            : tr('No teaching category has been assigned to you yet, so no student can be selected.')}
        </div>
      )}

      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-1.5 text-[11px]" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}

      <SplitPane
        side="start"
        storageKey="enote-rewards-punishments-split"
        initial={300}
        min={260}
        max={430}
        asideLabel={tr('Student register')}
        aside={
          <>
            <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-3.5">
              <span className="kicker">{tr('Student register')}</span>
              <span className="mono text-[10px] text-ink-3">{filteredStudents.length}</span>
            </div>
            <div className="shrink-0 border-b border-line p-2">
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(event) => setStudentSearch(event.target.value)}
                  placeholder={tr('Name or person ID')}
                  aria-label={tr('Search students')}
                  className="field h-7 ps-6 text-[11.5px]"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-2 p-3" role="status" aria-label={tr('Loading students')}>
                  {Array.from({ length: 7 }, (_, index) => (
                    <div key={index} className="h-8 rounded-sm bg-surface-muted" />
                  ))}
                </div>
              ) : filteredStudents.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-3">
                  {tr('No student matches this search.')}
                </p>
              ) : (
                filteredStudents.map((student) => {
                  const selected = Number(student.PERSON_ID) === Number(selectedStudentId)
                  return (
                    <button
                      key={student.PERSON_ID}
                      type="button"
                      onClick={() => setSelectedStudentId(student.PERSON_ID)}
                      aria-current={selected ? 'true' : undefined}
                      className={`flex w-full items-center gap-2.5 border-b border-line px-3 py-1.5 text-start ${
                        selected ? 'bg-selection' : 'hover:bg-surface-muted'
                      }`}
                      style={selected ? { boxShadow: 'inset 2px 0 0 var(--color-jade-500)' } : undefined}
                    >
                      <StudentPhoto
                        student={student}
                        photo={photoCache[Number(student.PERSON_ID)]}
                        size="list"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-ink">
                          {personNameLastFirst(student.PERSON_LAST_NAME, student.PERSON_FIRST_NAME)}
                        </span>
                        <span className="mono block text-[9.5px] text-ink-3">№ {String(student.PERSON_ID).padStart(4, '0')}</span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <div className="shrink-0 border-t border-line px-3.5 py-2 text-[10px] text-ink-3">
              {tr('Search covers every student in your scope.')}
            </div>
          </>
        }
      >
        {!selectedStudent ? (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-4">
              <span className="kicker">{tr('Conduct record')}</span>
              <span className="mono text-[10px] text-ink-3">{tr('NO SELECTION')}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
              <h2 className="serif max-w-[420px] text-[27px] leading-tight text-ink">
                {tr('Select a student to open their conduct record.')}
              </h2>
              <p className="mt-2 max-w-[430px] text-[11.5px] leading-relaxed text-ink-3">
                {tr('Punishments and rewards are recorded against the student, with a start date, a duration and the office that entered them.')}
              </p>
              <p className="mt-2 max-w-[430px] text-[11.5px] leading-relaxed text-ink-3">
                {tr('The same entry can also be applied to a whole group — by student, by section or by category — from the button in the masthead.')}
              </p>
              {loading && <p className="mt-3 mono text-[10px] text-ink-3">{tr('Loading register…')}</p>}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex min-h-[112px] shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
              <StudentPhoto
                student={selectedStudent}
                photo={photoCache[Number(selectedStudent.PERSON_ID)]}
                size="hero"
              />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="serif truncate text-[22px] leading-none text-ink">
                    {personNameLastFirst(selectedStudent.PERSON_LAST_NAME, selectedStudent.PERSON_FIRST_NAME)}
                  </h2>
                  <span className="mono shrink-0 text-[10px] text-ink-3">№ {String(selectedStudentId).padStart(4, '0')}</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10.5px] text-ink-3">
                  <span>{plural(entries.filter((entry) => entry.kind === 'punishment').length, tr('punishment'), tr('punishments'))}</span>
                  <span>{plural(entries.filter((entry) => entry.kind === 'reward').length, tr('reward'), tr('rewards'))}</span>
                </div>
              </div>
              <div className="ms-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setEntryKind('punishment')}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-[4px] border px-2 text-[11px] ${
                    entryKind === 'punishment'
                      ? 'border-line-strong bg-danger-bg text-danger-ink'
                      : 'border-line bg-surface text-ink-3 hover:bg-surface-muted'
                  }`}
                >
                  <Gavel size={11} /> {tr('Punishment')}
                </button>
                <button
                  type="button"
                  onClick={() => setEntryKind('reward')}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-[4px] border px-2 text-[11px] ${
                    entryKind === 'reward'
                      ? 'border-line-strong bg-success-bg text-success-ink'
                      : 'border-line bg-surface text-ink-3 hover:bg-surface-muted'
                  }`}
                >
                  <Award size={11} /> {tr('Reward')}
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <section className="min-h-0 flex-1 overflow-y-auto" aria-label={tr('History')}>
                <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-muted px-4">
                  <span className="kicker text-[9.5px]">{tr('Ledger')}</span>
                  <span className="mono text-[10px] text-ink-3">{entries.length}</span>
                </div>
                <DataTable
                  className="data-table"
                  label={tr('Conduct history')}
                  columns={[
                    { key: 'c0', width: 100, header: <>{tr('Date')}</> },
                    { key: 'c1', width: 96, header: <>{tr('Entry')}</> },
                    { key: 'c2', header: <>{tr('Label')}</> },
                    { key: 'c3', width: 168, header: <>{tr('Justification')}</> },
                    { key: 'c4', width: 224, header: <>{tr('Period')}</> },
                    { key: 'c5', header: <>{tr('Note')}</> },
                    { key: 'c6', width: 60 },
                  ]}
                >
                    {entries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="!h-24 text-center text-[11.5px] text-ink-3">
                          {tr('No conduct entry has been recorded for this student.')}
                        </td>
                      </tr>
                    ) : (
                      entries.map((entry) => (
                        <tr key={entry.key}>
                          <td className="mono text-[10.5px]">{fmtDate(entry.start || entry.end)}</td>
                          <td>
                            <span className={`inline-flex h-[20px] items-center gap-1 rounded-[3px] border px-1.5 text-[9.5px] uppercase tracking-[0.04em] ${
                              entry.kind === 'punishment'
                                ? 'border-danger/30 bg-danger-bg text-danger-ink'
                                : 'border-success/30 bg-success-bg text-success-ink'
                            }`}>
                              {entry.kind === 'punishment' ? <Gavel size={9} /> : <Award size={9} />}
                              {tr(entry.kind === 'punishment' ? 'Punishment' : 'Reward')}
                            </span>
                          </td>
                          <td className="max-w-0 truncate font-medium text-ink" title={entry.label}>{entry.label}</td>
                          <td className="max-w-0 truncate text-[11.5px]" title={entry.justification || undefined}>
                            {entry.justification || '—'}
                          </td>
                          <td
                            className="mono max-w-0 truncate text-[10.5px] text-ink-3"
                            title={scheduleText(entry.start, entry.end, entry.duration)}
                          >
                            {scheduleText(entry.start, entry.end, entry.duration)}
                          </td>
                          <td className="max-w-0 truncate text-[11.5px]" title={entry.note || undefined}>
                            {entry.note || '—'}
                          </td>
                          <td className="!pe-1 text-end">
                            <span className="inline-flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => setEditTarget(entry)}
                                disabled={!canEditEntry(entry.kind)}
                                className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-selection hover:text-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-3"
                                aria-label={tr('Edit entry')}
                                title={canEditEntry(entry.kind)
                                  ? tr('Edit entry')
                                  : tr('Your account may not edit this entry.')}
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmTarget({ kind: entry.kind, id: entry.id })}
                                disabled={!canDeleteEntry(entry.kind)}
                                className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-3"
                                aria-label={tr('Remove entry')}
                                title={canDeleteEntry(entry.kind)
                                  ? tr('Remove entry')
                                  : tr('Your account may not delete this entry.')}
                              >
                                <Trash2 size={11} />
                              </button>
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                </DataTable>
              </section>

              <section className="shrink-0 border-t border-line" aria-label={tr('New entry')}>
                <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-muted px-4">
                  <span className="kicker text-[9.5px]">{tr('Record an entry')}</span>
                  <span className="mono text-[10px] text-ink-3">
                    {entryKind === 'punishment' ? tr('PUNISHMENT') : tr('REWARD')}
                  </span>
                  {!canRecord && (
                    <span className="ms-auto flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--color-warning-ink)' }}>
                      <AlertCircle size={11} />
                      {tr('Your account may not record this entry. Ask an administrator.')}
                    </span>
                  )}
                </div>
                <EntryForm
                  key={entryKind}
                  kind={entryKind}
                  types={types}
                  canRecord={canRecord}
                  saving={savingEntry}
                  onSubmit={entryKind === 'punishment' ? handleApplyPunishment : handleApplyReward}
                  submitLabel={entryKind === 'punishment' ? tr('Record punishment') : tr('Record reward')}
                  savingLabel={tr('Recording…')}
                />
              </section>
            </div>
          </div>
        )}
      </SplitPane>

      <BulkApplyDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        user={user}
        students={students}
        photoCache={photoCache}
        types={types}
        permissions={permissions}
        onApplied={(count, kind) => {
          showFlash(
            kind === 'punishment'
              ? `${plural(count, tr('punishment'), tr('punishments'))} ${tr('applied to the group.')}`
              : `${plural(count, tr('reward'), tr('rewards'))} ${tr('applied to the group.')}`
          )
          if (selectedStudentId) loadHistory(selectedStudentId)
        }}
      />

      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget?.kind === 'reward' ? tr('Edit reward') : tr('Edit punishment')}
        maxWidth="max-w-[720px]"
      >
        {editTarget && (
          <EntryForm
            key={editTarget.key}
            compact
            kind={editTarget.kind}
            types={types}
            canRecord={canEditEntry(editTarget.kind)}
            saving={savingEntry}
            initial={{
              typeId: editTarget.typeId,
              justificationId: editTarget.justificationId,
              mode: editTarget.start ? 'scheduled' : 'immediate',
              start: isoDate(editTarget.start),
              duration: editTarget.duration,
              note: editTarget.note
            }}
            onSubmit={editTarget.kind === 'punishment' ? handleUpdatePunishment : handleUpdateReward}
            onCancel={() => setEditTarget(null)}
            submitLabel={tr('Save changes')}
            savingLabel={tr('Saving…')}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.kind === 'reward' ? tr('Delete Reward') : tr('Delete Punishment')}
        message={confirmTarget?.kind === 'reward' ? tr('Delete this reward?') : tr('Delete this punishment?')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          const t = confirmTarget
          setConfirmTarget(null)
          if (t?.kind === 'reward') handleDeleteReward(t.id)
          else handleDeletePunishment(t.id)
        }}
      />
    </div>
  )
}

export default RewardsPunishments
