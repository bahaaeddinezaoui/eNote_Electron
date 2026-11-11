import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatDate as formatDateValue, formatDateTime } from '../dateFormat'
import {
  AlertTriangle, BookMarked, BookOpen, Check, Clock, Download, ExternalLink,
  Eye, FileText, Film, FolderOpen, HardDrive, Pencil, Play, RefreshCw, Search,
  ShieldCheck, Trash2, Upload, X
} from 'lucide-react'
import { PageHeader, Panel, PanelHeader } from './ui/PageHeader'
import Button from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import Notice from './ui/Notice'
import { localizedLabel, tr } from '../i18n'

// Library — the school's own shelf.
//
// Lesson material is filed inside the curriculum (Lessons); the Library holds
// documents that belong to the school as a whole: books, novels, standalone
// lessons and recorded videos. A document is always a file. Teachers and Admins
// add it, an Admin reviews it, and then everyone entitled to it can read, watch
// or download it — within the restrictions the Admin set in Settings.
//
// Three shelves, one catalogue:
//   Catalogue  — everything published and readable by this account
//   My uploads — what this account added, including what is still waiting
//   Review     — the Admin's queue of submissions (Admin and Developer only)

const TYPE_DEFS = [
  { code: 'BOOK', label: 'Book', icon: BookOpen },
  { code: 'NOVEL', label: 'Novel', icon: BookMarked },
  { code: 'LESSON', label: 'Lesson', icon: FileText },
  { code: 'VIDEO', label: 'Video', icon: Film }
]

const TYPE_BY_CODE = Object.fromEntries(TYPE_DEFS.map((type) => [type.code, type]))

const AUDIENCE_LABELS = {
  EVERYONE: 'Everyone in the school',
  TEACHERS: 'Teachers only',
  STUDENTS: 'Students only'
}

const STATUS = {
  PENDING: { label: 'Waiting for review', tone: 'warn' },
  PUBLISHED: { label: 'Published', tone: 'good' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' }
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'popular', label: 'Most read' }
]

const formatSize = (bytes) => {
  const size = Number(bytes) || 0
  if (size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  const value = size / Math.pow(1024, i)
  return `${parseFloat(value.toFixed(value >= 10 || i === 0 ? 0 : 1))} ${units[i]}`
}

const formatDate = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return isNaN(date.getTime())
    ? String(value)
    : formatDateValue(date, { day: '2-digit', month: 'short', year: 'numeric' })
}

const mediaUrl = (itemId) => `library-media://media/${itemId}`

const categoryLabel = (item) =>
  localizedLabel(item, 'CATEGORY_LABEL') || tr('Uncategorized')

const typeOf = (item) => TYPE_BY_CODE[item?.ITEM_TYPE_CODE] || TYPE_BY_CODE.BOOK

const Pill = ({ tone = 'neutral', children, className = '' }) => {
  const palette =
    tone === 'good'
      ? { background: 'var(--color-success-bg)', color: 'var(--color-success-ink)' }
      : tone === 'warn'
        ? { background: 'var(--color-warning-bg)', color: 'var(--color-warning-ink)' }
        : tone === 'bad'
          ? { background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }
          : { background: 'var(--color-surface-muted)', color: 'var(--color-ink-2)' }
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[3px] px-1.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] ${className}`}
      style={palette}
    >
      {children}
    </span>
  )
}

const StatusPill = ({ status }) => {
  const entry = STATUS[status] || STATUS.PENDING
  return <Pill tone={entry.tone}>{tr(entry.label)}</Pill>
}

const TIMELINE_DOT = {
  good: 'var(--color-jade-500)',
  bad: 'var(--color-danger)',
  warn: 'var(--color-warning-ink)',
  neutral: 'var(--color-line-strong)'
}

// The document's own record of what happened to it: when it was submitted,
// what the reviewer decided and why, and when it reached the shelf. Built from
// the item's timestamps so it cannot disagree with the status pill.
const reviewTimeline = (item) => {
  const events = [
    {
      key: 'submitted',
      label: 'Submitted',
      at: item.CREATED_AT,
      tone: 'neutral',
      detail: item.UPLOADER_NAME ? `${tr('Added by')} ${item.UPLOADER_NAME}` : ''
    }
  ]

  if (item.REVIEWED_AT) {
    const rejected = item.STATUS_CODE === 'REJECTED'
    events.push({
      key: 'reviewed',
      label: rejected ? 'Rejected' : 'Approved',
      at: item.REVIEWED_AT,
      tone: rejected ? 'bad' : 'good',
      detail: item.REVIEWER_NAME ? `${tr('Reviewed by')} ${item.REVIEWER_NAME}` : '',
      note: item.REVIEW_NOTE || ''
    })
  } else if (item.STATUS_CODE === 'PENDING') {
    events.push({
      key: 'pending',
      label: 'Waiting for review',
      at: null,
      tone: 'warn',
      detail: tr('An administrator has not reviewed it yet.')
    })
  }

  if (item.PUBLISHED_AT) {
    events.push({
      key: 'published',
      label: 'Published',
      at: item.PUBLISHED_AT,
      tone: 'good',
      detail: tr('It is on the shelf.')
    })
  }

  if (item.STATUS_CODE === 'ARCHIVED') {
    events.push({
      key: 'archived',
      label: 'Withdrawn',
      at: item.UPDATED_AT,
      tone: 'neutral',
      detail: tr('An administrator removed it from the shelf.')
    })
  }

  return events
    .map((event, index) => ({
      ...event,
      index,
      time: event.at ? new Date(event.at).getTime() : Infinity
    }))
    .sort((a, b) => (a.time === b.time ? a.index - b.index : a.time - b.time))
}

const ReviewTimeline = ({ item }) => {
  const events = reviewTimeline(item)
  return (
    <div className="rounded-[3px] border border-line bg-surface-muted/50 px-3 py-2.5">
      <div className="mono text-[9px] uppercase tracking-[0.09em] text-ink-3">{tr('History')}</div>
      <ol className="mt-2 space-y-2.5 border-s border-line ps-4">
        {events.map((event) => (
          <li key={event.key} className="relative">
            <span
              className="absolute top-[5px] h-[5px] w-[5px] rounded-full"
              style={{
                insetInlineStart: '-18px',
                background: TIMELINE_DOT[event.tone] || TIMELINE_DOT.neutral
              }}
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-[11px] font-semibold text-ink">{tr(event.label)}</span>
              <span className="mono text-[9.5px] text-ink-3">
                {event.at ? formatDate(event.at) : tr('Pending')}
              </span>
            </div>
            {event.detail && (
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{event.detail}</p>
            )}
            {event.note && (
              <p className="mt-1 border-s-2 border-line-strong ps-2 text-[10.5px] leading-relaxed text-ink-2">
                {event.note}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

const Stat = ({ label, value, hint }) => (
  <div className="border-e border-line px-5 py-2.5 last:border-e-0">
    <div className="mono text-[9px] uppercase tracking-[0.09em] text-ink-3">{label}</div>
    <div className="mt-0.5 flex items-baseline gap-1.5">
      <span className="mono text-[15px] text-ink">{value}</span>
      {hint && <span className="truncate text-[10px] text-ink-3">{hint}</span>}
    </div>
  </div>
)

// A shelf card. The cover is drawn from the document's own type and title — no
// invented artwork, no gradient — so a shelf of twenty still reads as a
// catalogue rather than as decoration.
const ItemCard = ({ item, isMine, onOpen }) => {
  const type = typeOf(item)
  const Icon = type.icon
  const video = type.code === 'VIDEO'
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group flex w-full flex-col overflow-hidden rounded-md border border-line bg-surface text-start hover:border-line-strong hover:bg-surface-muted focus-visible:outline-none"
    >
      <span
        className="relative flex w-full items-end overflow-hidden border-b border-line"
        style={{
          aspectRatio: video ? '16 / 9' : '4 / 3',
          background: video ? 'var(--color-sunken)' : 'var(--color-surface-muted)',
          paddingInlineStart: video ? 0 : 10
        }}
      >
        {video ? (
          <>
            <span className="absolute inset-0 grid place-items-center text-ink-3">
              <Film size={26} strokeWidth={1.3} />
            </span>
            <span className="absolute bottom-2 end-2 grid h-7 w-7 place-items-center rounded-full border border-line-strong bg-surface text-ink">
              <Play size={11} fill="currentColor" strokeWidth={0} className="ms-0.5" />
            </span>
          </>
        ) : (
          <>
            <span
              className="absolute inset-y-0 start-0 w-[3px]"
              style={{ background: 'var(--color-jade-solid)' }}
              aria-hidden="true"
            />
            <span className="absolute end-3 top-3 text-ink-3/70">
              <Icon size={20} strokeWidth={1.3} />
            </span>
            <span className="serif relative mb-2.5 line-clamp-4 text-[16px] leading-[19px] text-ink">
              {item.TITLE}
            </span>
          </>
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-2">
        <span className="flex items-start gap-1.5">
          <span className={`min-w-0 flex-1 truncate text-[12px] font-medium text-ink ${video ? '' : 'hidden'}`}>
            {item.TITLE}
          </span>
          {isMine && item.STATUS_CODE !== 'PUBLISHED' && <StatusPill status={item.STATUS_CODE} />}
        </span>
        <span className="mono flex items-center gap-1.5 truncate text-[10px] text-ink-3">
          <span className="truncate">{tr(type.label)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{categoryLabel(item)}</span>
        </span>
        <span className="mono mt-auto flex items-center gap-2 truncate pt-1 text-[9.5px] text-ink-3">
          <span className="truncate">{item.UPLOADER_NAME || tr('Unknown author')}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">{formatSize(item.FILE_SIZE)}</span>
          {Number(item.VIEW_COUNT) > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex shrink-0 items-center gap-0.5">
                <Eye size={9} /> {item.VIEW_COUNT}
              </span>
            </>
          )}
        </span>
      </span>
    </button>
  )
}

const ItemRow = ({ item, isMine, onOpen }) => {
  const type = typeOf(item)
  const Icon = type.code === 'VIDEO' ? Film : type.icon
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-center gap-2.5 border-t border-line/70 px-3 py-2.5 text-start first:border-t-0 hover:bg-surface-muted"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-line bg-surface-muted text-ink-2">
        <Icon size={14} strokeWidth={1.6} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] text-ink">{item.TITLE}</span>
          {isMine && item.STATUS_CODE !== 'PUBLISHED' && <StatusPill status={item.STATUS_CODE} />}
        </span>
        <span className="mono mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-ink-3">
          <span>{tr(type.label)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{categoryLabel(item)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{item.UPLOADER_NAME || tr('Unknown author')}</span>
        </span>
      </span>
      <span className="mono hidden shrink-0 text-[10px] text-ink-3 sm:block">{formatSize(item.FILE_SIZE)}</span>
      <span className="mono hidden w-16 shrink-0 text-end text-[10px] text-ink-3 md:block">
        {formatDate(item.PUBLISHED_AT || item.CREATED_AT)}
      </span>
      <span className="grid h-6 w-6 shrink-0 place-items-center text-ink-3">
        <ExternalLink size={12} />
      </span>
    </button>
  )
}

// One metadata editor, used both to add a document and to correct an existing
// one. The file is chosen once; a correction never replaces it.
const ItemForm = ({
  mode,
  initial,
  categories,
  policy,
  fileName,
  onChooseFile,
  submitting,
  error,
  onSubmit,
  onCancel
}) => {
  const [title, setTitle] = useState(initial?.TITLE || '')
  const [description, setDescription] = useState(initial?.DESCRIPTION || '')
  const [typeCode, setTypeCode] = useState(initial?.ITEM_TYPE_CODE || 'BOOK')
  const [categoryId, setCategoryId] = useState(String(initial?.LIBRARY_CATEGORY_ID || ''))
  const [audience, setAudience] = useState(initial?.AUDIENCE_CODE || 'EVERYONE')
  const [resubmit, setResubmit] = useState(false)

  const isVideo = typeCode === 'VIDEO'
  const rejected = mode === 'edit' && initial?.STATUS_CODE === 'REJECTED'

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ title, description, typeCode, categoryId, audience, resubmit })
      }}
    >
      {error && (
        <div className="flex items-start gap-2 rounded-[3px] border border-danger/40 bg-danger-bg px-2.5 py-2 text-[11px] leading-relaxed text-danger-ink">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label className="field-label" htmlFor="library-title">{tr('Title')}</label>
        <input
          id="library-title"
          className="field h-8 text-[11.5px]"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={240}
          placeholder={tr('The title shown on the shelf')}
          autoFocus
        />
      </div>

      <div>
        <label className="field-label" htmlFor="library-description">{tr('Description')}</label>
        <textarea
          id="library-description"
          className="field min-h-[64px] resize-y py-1.5 text-[11.5px]"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={4000}
          placeholder={tr('What the document covers, and who it is for')}
        />
      </div>

      <div>
        <span className="field-label">{tr('Kind of document')}</span>
        <div className="flex flex-wrap gap-1">
          {TYPE_DEFS.map((type) => {
            const Icon = type.icon
            const active = typeCode === type.code
            return (
              <button
                key={type.code}
                type="button"
                onClick={() => setTypeCode(type.code)}
                aria-pressed={active}
                className={`inline-flex h-7 items-center gap-1.5 rounded-[3px] border px-2 text-[11px] ${
                  active
                    ? 'border-jade-600 bg-jade-50 text-jade-700'
                    : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink'
                }`}
              >
                <Icon size={11} /> {tr(type.label)}
              </button>
            )
          })}
        </div>
        {isVideo && (
          <p className="mt-1 text-[10px] text-ink-3">
            {tr('A video document must be a video file. The file decides the kind when it is added.')}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="library-category">
            {tr('Category')}{policy?.requireCategory ? ' *' : ''}
          </label>
          <select
            id="library-category"
            className="field h-8 text-[11.5px]"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">{tr('Choose a category')}</option>
            {categories.map((category) => (
              <option key={category.LIBRARY_CATEGORY_ID} value={category.LIBRARY_CATEGORY_ID}>
                {localizedLabel(category, 'LABEL')}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="library-audience">{tr('Who may read it')}</label>
          <select
            id="library-audience"
            className="field h-8 text-[11.5px]"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
          >
            {Object.entries(AUDIENCE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{tr(label)}</option>
            ))}
          </select>
        </div>
      </div>

      {mode === 'upload' ? (
        <div>
          <span className="field-label">{tr('File')}</span>
          <div className="flex items-center gap-2 rounded-[3px] border border-line-strong bg-canvas px-2.5 py-2">
            <HardDrive size={13} className="shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11.5px] text-ink">
                {fileName || tr('No file chosen yet')}
              </div>
              <div className="mono text-[9.5px] text-ink-3">
                {tr('Up to {size} MB', { size: policy?.maxFileMb || 512 })}
              </div>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={onChooseFile}>
              <FolderOpen size={11} /> {tr('Choose file')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mono truncate text-[10px] text-ink-3">
          {tr('File')}: {initial?.FILE_NAME} · {formatSize(initial?.FILE_SIZE)}
        </p>
      )}

      {policy?.reviewRequired && !rejected && (
        <div className="flex items-start gap-2 rounded-[3px] border border-line-strong bg-surface-muted px-2.5 py-2 text-[10.5px] leading-relaxed text-ink-2">
          <ShieldCheck size={13} className="mt-px shrink-0" style={{ color: 'var(--color-jade-600)' }} />
          <span>
            {tr('An administrator reviews the document before it is published. Until then it is visible only to you and to administrators.')}
          </span>
        </div>
      )}

      {rejected && (
        <label className="flex items-start gap-2 rounded-[3px] border border-line-strong bg-surface-muted px-2.5 py-2 text-[11px] leading-relaxed text-ink-2">
          <input
            type="checkbox"
            className="mt-0.5 h-3 w-3 shrink-0"
            checked={resubmit}
            onChange={(event) => setResubmit(event.target.checked)}
          />
          <span>{tr('Send this document back for review after saving the corrections.')}</span>
        </label>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {tr('Cancel')}
        </Button>
        <Button type="submit" loading={submitting} disabled={submitting}>
          {mode === 'upload'
            ? tr('Add to the Library')
            : rejected && resubmit
              ? tr('Save and resubmit')
              : tr('Save changes')}
        </Button>
      </div>
    </form>
  )
}

const Library = ({ user }) => {
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const roles = user?.roles || []
  const isAdmin = roles.includes('ADMIN') || roles.includes('DEVELOPER')
  const isTeacher = roles.includes('TEACHER')
  const isStudent = roles.includes('STUDENT') && !isTeacher && !isAdmin

  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [policy, setPolicy] = useState(null)
  const [queue, setQueue] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)

  const [tab, setTab] = useState('catalogue')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('enote-library-view') === 'list' ? 'list' : 'shelf'
    } catch {
      return 'shelf'
    }
  })

  const [selected, setSelected] = useState(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [chosenFile, setChosenFile] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [reviewTarget, setReviewTarget] = useState(null)
  const [reviewDecision, setReviewDecision] = useState('APPROVE')
  const [reviewNote, setReviewNote] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [player, setPlayer] = useState(null)

  const userId = user?.id

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [itemsRes, categoriesRes, policyRes, queueRes] = await Promise.all([
        window.api.getLibraryItems(userId),
        window.api.getLibraryCategories(userId),
        window.api.getLibraryPolicy(),
        isAdmin ? window.api.getLibraryReviewQueue(userId) : Promise.resolve(null)
      ])
      if (itemsRes?.error) throw new Error(itemsRes.error)
      setItems(itemsRes?.data || [])
      setCategories(categoriesRes?.data || [])
      setPolicy(policyRes || null)
      setQueue(queueRes && !queueRes.error ? queueRes : null)
      // The sidebar badge and the Overview queue count the same submissions.
      window.dispatchEvent(new Event('library-updated'))
    } catch (err) {
      console.error('Failed to load the Library', err)
      setError(err.message || tr('The Library could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // A student has no review shelf; never leave the tab pointing at one.
    if (!isAdmin) setTab('catalogue')
  }, [userId, isAdmin])

  // The Overview work-queue row opens the review shelf directly, and the
  // notification for a decision opens the author's own shelf.
  useEffect(() => {
    if (requestedTab === 'review' && isAdmin) setTab('review')
    if (requestedTab === 'mine' && (isAdmin || isTeacher)) setTab('mine')
  }, [requestedTab, isAdmin, isTeacher])

  useEffect(() => {
    try {
      localStorage.setItem('enote-library-view', view)
    } catch {
      // A per-device preference only; the page works without it.
    }
  }, [view])

  const canUpload = !!policy?.uploadsEnabled && (isAdmin || (isTeacher && !!policy?.teacherUploadsEnabled))
  const isMine = (item) => String(item.UPLOADED_BY_USER_ID) === String(userId)

  const published = useMemo(() => items.filter((item) => item.STATUS_CODE === 'PUBLISHED'), [items])
  const mine = useMemo(() => items.filter(isMine), [items, userId])

  const source = tab === 'mine' ? mine : published

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const result = source.filter((item) => {
      if (typeFilter !== 'all' && item.ITEM_TYPE_CODE !== typeFilter) return false
      if (categoryFilter !== 'all' && String(item.LIBRARY_CATEGORY_ID || '') !== categoryFilter) return false
      if (!term) return true
      return [
        item.TITLE,
        item.DESCRIPTION,
        categoryLabel(item),
        item.UPLOADER_NAME,
        item.ITEM_TYPE_CODE,
        tr(typeOf(item).label),
        item.FILE_EXTENSION
      ].filter(Boolean).join(' ').toLowerCase().includes(term)
    })

    return [...result].sort((a, b) => {
      if (sortBy === 'title') return String(a.TITLE || '').localeCompare(String(b.TITLE || ''))
      if (sortBy === 'popular') return (Number(b.VIEW_COUNT) || 0) - (Number(a.VIEW_COUNT) || 0)
      const left = new Date(a.PUBLISHED_AT || a.CREATED_AT || 0).getTime()
      const right = new Date(b.PUBLISHED_AT || b.CREATED_AT || 0).getTime()
      return sortBy === 'oldest' ? left - right : right - left
    })
  }, [source, typeFilter, categoryFilter, search, sortBy])

  const typeCounts = useMemo(() => {
    const counts = new Map()
    for (const item of source) counts.set(item.ITEM_TYPE_CODE, (counts.get(item.ITEM_TYPE_CODE) || 0) + 1)
    return counts
  }, [source])

  const pendingCount = queue?.stats?.pending || 0

  const openUpload = () => {
    setChosenFile(null)
    setFormError('')
    setUploadOpen(true)
  }

  const chooseFile = async () => {
    try {
      const result = await window.api.openFileDialog({ multiple: false })
      if (!result || result.canceled || !result.filePaths?.length) return
      const path = result.filePaths[0]
      const name = path.split(/[\\/]/).pop() || ''
      setChosenFile({ path, name })
      setFormError('')
    } catch (err) {
      setFormError(err.message || tr('The file could not be chosen.'))
    }
  }

  const submitUpload = async (values) => {
    if (!chosenFile) {
      setFormError(tr('Choose a file to add.'))
      return
    }
    setSubmitting(true)
    setFormError('')
    try {
      const result = await window.api.uploadLibraryItem(userId, chosenFile.path, {
        ...values,
        title: values.title || chosenFile.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
      })
      if (result?.error) {
        setFormError(result.error)
        return
      }
      setUploadOpen(false)
      await load()
      setNotice({
        type: 'ok',
        text: result?.status === 'PENDING'
          ? tr('Document added. It is waiting for an administrator to review it.')
          : tr('Document added and published.')
      })
    } catch (err) {
      console.error('Upload failed', err)
      setFormError(err.message || tr('The document could not be added.'))
    } finally {
      setSubmitting(false)
    }
  }

  const submitEdit = async (values) => {
    if (!editTarget) return
    setSubmitting(true)
    setFormError('')
    try {
      const result = await window.api.updateLibraryItem(userId, editTarget.LIBRARY_ITEM_ID, values)
      if (result?.error) {
        setFormError(result.error)
        return
      }
      setEditTarget(null)
      setSelected(null)
      await load()
      setNotice({ type: 'ok', text: values.resubmit ? tr('Document saved and sent back for review.') : tr('Document updated.') })
    } catch (err) {
      console.error('Update failed', err)
      setFormError(err.message || tr('The document could not be saved.'))
    } finally {
      setSubmitting(false)
    }
  }

  // Keeps a copy of this document on this computer, so it opens during an
  // outage. The catalogue row is already cached; the file is not.
  const saveOffline = async (item) => {
    try {
      const result = await window.api.saveLibraryItemOffline(userId, item.LIBRARY_ITEM_ID)
      if (result?.error) setNotice({ type: 'error', text: result.error })
      else if (result?.success) {
        setNotice({ type: 'ok', text: tr('Saved on this computer. It can be opened during an outage.') })
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('The document could not be saved for offline use.') })
    }
  }

  const openFile = async (item) => {
    try {
      const result = await window.api.openLibraryItem(userId, item.LIBRARY_ITEM_ID)
      if (result?.error) setNotice({ type: 'error', text: result.error })
      else load()
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('The document could not be opened.') })
    }
  }

  const download = async (item) => {
    try {
      const result = await window.api.downloadLibraryItem(userId, item.LIBRARY_ITEM_ID)
      if (result?.error) setNotice({ type: 'error', text: result.error })
      else if (result?.success) {
        setNotice({ type: 'ok', text: `${tr('Saved to')}: ${result.path}` })
        load()
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('The document could not be downloaded.') })
    }
  }

  const play = (item) => {
    setPlayer(item)
    try {
      window.api.trackLibraryView?.(item.LIBRARY_ITEM_ID, userId, 'PLAY')?.catch?.(() => {})
    } catch {
      // Usage is a nicety; the video still plays.
    }
  }

  const remove = async () => {
    const item = deleteTarget
    setDeleteTarget(null)
    if (!item) return
    try {
      const result = await window.api.deleteLibraryItem(userId, item.LIBRARY_ITEM_ID)
      if (result?.error) {
        setNotice({ type: 'error', text: result.error })
        return
      }
      setSelected(null)
      await load()
      setNotice({ type: 'ok', text: tr('Document removed.') })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('The document could not be removed.') })
    }
  }

  const archive = async (item, archived) => {
    try {
      const result = await window.api.archiveLibraryItem(userId, item.LIBRARY_ITEM_ID, archived)
      if (result?.error) {
        setNotice({ type: 'error', text: result.error })
        return
      }
      setSelected(null)
      await load()
      setNotice({ type: 'ok', text: archived ? tr('Document archived. It is no longer on the shelf.') : tr('Document published again.') })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('The document could not be changed.') })
    }
  }

  const askReview = (item, decision) => {
    setReviewTarget(item)
    setReviewDecision(decision)
    setReviewNote('')
  }

  const confirmReview = async () => {
    if (!reviewTarget) return
    if (reviewDecision === 'REJECT' && !reviewNote.trim()) return
    setReviewBusy(true)
    try {
      const result = await window.api.reviewLibraryItem(
        userId, reviewTarget.LIBRARY_ITEM_ID, reviewDecision, reviewNote
      )
      if (result?.error) {
        setNotice({ type: 'error', text: result.error })
        return
      }
      setReviewTarget(null)
      setSelected(null)
      await load()
      setNotice({
        type: 'ok',
        text: reviewDecision === 'APPROVE' ? tr('Document published.') : tr('Document returned to its author.')
      })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('The review could not be saved.') })
    } finally {
      setReviewBusy(false)
    }
  }

  const resetFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setCategoryFilter('all')
  }

  // Only an account that can add documents has an uploads shelf; a student and
  // a Director read the catalogue, and only an administrator sees the queue.
  const tabs = [
    { id: 'catalogue', label: tr('Catalogue'), count: published.length },
    ...(isAdmin || isTeacher ? [{ id: 'mine', label: tr('My uploads'), count: mine.length }] : []),
    ...(isAdmin ? [{ id: 'review', label: tr('Review'), count: pendingCount }] : [])
  ]

  const selectedType = selected ? typeOf(selected) : null
  const selectedIsMine = selected ? isMine(selected) : false
  const canEditSelected = !!selected && (isAdmin || (selectedIsMine && selected.STATUS_CODE !== 'PUBLISHED'))
  const canDeleteSelected = !!selected && (isAdmin || (selectedIsMine && selected.STATUS_CODE !== 'PUBLISHED'))
  const canDownloadSelected = !!selected && (!isStudent || !!policy?.studentDownloads)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Resources')}
        title={tr('Library')}
        meta={`${published.length} ${tr('documents')}`}
        actions={
          <>
            {isAdmin && (
              <Button size="sm" variant="secondary" onClick={() => setTab('review')}>
                <ShieldCheck size={12} /> {tr('Review')} {pendingCount > 0 ? `(${pendingCount})` : ''}
              </Button>
            )}
            {canUpload && (
              <Button size="sm" onClick={openUpload}>
                <Upload size={12} /> {tr('Add a document')}
              </Button>
            )}
          </>
        }
      />

      <div className="grid shrink-0 grid-cols-2 border-b border-line sm:grid-cols-4">
        <Stat label={tr('Published')} value={published.length} hint={tr('on the shelf')} />
        <Stat
          label={tr('Videos')}
          value={published.filter((item) => item.ITEM_TYPE_CODE === 'VIDEO').length}
          hint={tr('watchable here')}
        />
        <Stat label={tr('Categories')} value={categories.length} hint={tr('shelves')} />
        {isAdmin ? (
          <Stat
            label={tr('Waiting for review')}
            value={pendingCount}
            hint={pendingCount ? tr('needs an administrator') : tr('nothing waiting')}
          />
        ) : isTeacher ? (
          <Stat label={tr('My uploads')} value={mine.length} hint={tr('added by you')} />
        ) : (
          <Stat
            label={tr('Downloads')}
            value={policy?.studentDownloads ? tr('Allowed') : tr('Off')}
            hint={tr('set by an administrator')}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-3">
          {policy && policy.reviewRequired && tab !== 'review' && (isTeacher || isAdmin) && (
            <div
              className="flex items-start gap-2 rounded-[3px] border px-3 py-2 text-[11px] leading-relaxed"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-info) 35%, transparent)',
                background: 'var(--color-info-bg)',
                color: 'var(--color-info-ink)'
              }}
            >
              <ShieldCheck size={13} className="mt-px shrink-0" />
              <span>
                {tr('Every document is reviewed by an administrator before it is published. You can follow its status under My uploads.')}
              </span>
            </div>
          )}

          {/* The shelves, the search and the filters sit in one plate so the
              page reads as a catalogue rather than as a dashboard. */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line pb-2">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? 'page' : undefined}
                className={`inline-flex h-7 items-center gap-1.5 rounded-[3px] border px-2.5 text-[11.5px] ${
                  tab === entry.id
                    ? 'border-jade-600 bg-jade-50 font-medium text-jade-700'
                    : 'border-transparent text-ink-2 hover:bg-surface-muted hover:text-ink'
                }`}
              >
                {entry.label}
                <span className="mono text-[9.5px] text-ink-3">{entry.count}</span>
              </button>
            ))}
            <span className="ms-auto flex items-center gap-1">
              <Button
                size="sm"
                variant={view === 'shelf' ? 'secondary' : 'ghost'}
                onClick={() => setView('shelf')}
                aria-pressed={view === 'shelf'}
                title={tr('Shelf view')}
              >
                <BookOpen size={12} />
              </Button>
              <Button
                size="sm"
                variant={view === 'list' ? 'secondary' : 'ghost'}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                title={tr('List view')}
              >
                <FileText size={12} />
              </Button>
            </span>
          </div>

          {tab !== 'review' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative min-w-[190px] flex-1">
                <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tr('Search titles, authors, categories…')}
                  aria-label={tr('Search the Library')}
                  className="field h-7 w-full ps-7 text-[11.5px]"
                />
              </div>
              <select
                className="field h-7 w-auto text-[11px]"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label={tr('Filter by category')}
              >
                <option value="all">{tr('All categories')}</option>
                {categories.map((category) => (
                  <option key={category.LIBRARY_CATEGORY_ID} value={String(category.LIBRARY_CATEGORY_ID)}>
                    {localizedLabel(category, 'LABEL')}
                  </option>
                ))}
              </select>
              <select
                className="field h-7 w-auto text-[11px]"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                aria-label={tr('Sort documents')}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
              <span className="mono shrink-0 text-[10px] text-ink-3">
                {filtered.length} / {source.length}
              </span>
            </div>
          )}

          {tab !== 'review' && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                aria-pressed={typeFilter === 'all'}
                className={`inline-flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-[10.5px] ${
                  typeFilter === 'all' ? 'bg-surface-muted font-medium text-ink' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {tr('All')} <span className="mono text-[9px]">{source.length}</span>
              </button>
              {TYPE_DEFS.filter((type) => (typeCounts.get(type.code) || 0) > 0).map((type) => {
                const Icon = type.icon
                const active = typeFilter === type.code
                return (
                  <button
                    key={type.code}
                    type="button"
                    onClick={() => setTypeFilter(active ? 'all' : type.code)}
                    aria-pressed={active}
                    className={`inline-flex h-6 items-center gap-1 rounded-[3px] px-1.5 text-[10.5px] ${
                      active ? 'bg-surface-muted font-medium text-ink' : 'text-ink-3 hover:text-ink'
                    }`}
                  >
                    <Icon size={10} /> {tr(type.label)}
                    <span className="mono text-[9px]">{typeCounts.get(type.code)}</span>
                  </button>
                )
              })}
            </div>
          )}

          {error ? (
            <Panel>
              <div className="px-6 py-10 text-center">
                <AlertTriangle size={20} className="mx-auto text-danger-ink" strokeWidth={1.6} />
                <p className="mt-2 text-[12px] font-medium text-ink">{tr('The Library could not be loaded.')}</p>
                <p className="mx-auto mt-1 max-w-lg text-[11px] leading-relaxed text-ink-3">{error}</p>
                <Button size="sm" variant="secondary" className="mt-3" onClick={load}>
                  <RefreshCw size={11} /> {tr('Try again')}
                </Button>
              </div>
            </Panel>
          ) : loading ? (
            <Panel>
              <p className="px-3 py-10 text-center text-[11.5px] text-ink-3">{tr('Loading the Library…')}</p>
            </Panel>
          ) : tab === 'review' ? (
            <ReviewShelf
              queue={queue}
              onOpen={(item) => setSelected(item)}
              onApprove={(item) => askReview(item, 'APPROVE')}
              onReject={(item) => askReview(item, 'REJECT')}
            />
          ) : filtered.length === 0 ? (
            <Panel>
              <div className="px-6 py-14 text-center">
                <BookOpen size={22} className="mx-auto text-ink-3" strokeWidth={1.6} />
                <p className="mt-2 text-[12px] font-medium text-ink">
                  {source.length === 0
                    ? tab === 'mine'
                      ? tr('You have not added a document yet.')
                      : tr('The shelf is empty.')
                    : tr('Nothing matches this search or filter.')}
                </p>
                <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-ink-3">
                  {source.length === 0
                    ? tab === 'mine'
                      ? tr('Add a book, a novel, a lesson or a video; an administrator reviews it before it is published.')
                      : tr('Documents appear here once an administrator publishes them.')
                    : tr('Clear the search and filters to see the whole shelf.')}
                </p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  {source.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={resetFilters}>
                      <X size={11} /> {tr('Clear filters')}
                    </Button>
                  )}
                  {source.length === 0 && tab === 'catalogue' && canUpload && (
                    <Button size="sm" onClick={openUpload}>
                      <Upload size={11} /> {tr('Add the first document')}
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          ) : view === 'shelf' ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((item) => (
                <ItemCard
                  key={item.LIBRARY_ITEM_ID}
                  item={item}
                  isMine={isMine(item)}
                  onOpen={setSelected}
                />
              ))}
            </div>
          ) : (
            <Panel>
              {filtered.map((item) => (
                <ItemRow
                  key={item.LIBRARY_ITEM_ID}
                  item={item}
                  isMine={isMine(item)}
                  onOpen={setSelected}
                />
              ))}
            </Panel>
          )}
        </div>
      </div>

      {/* ---- The document itself ---- */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.TITLE || ''}
        maxWidth="max-w-[660px]"
        footer={
          selected && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <StatusPill status={selected.STATUS_CODE} />
                <span className="mono text-[9.5px] text-ink-3">
                  {tr(typeOf(selected).label)} · {categoryLabel(selected)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {isAdmin && selected.STATUS_CODE === 'PENDING' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => askReview(selected, 'REJECT')}>
                      <X size={11} /> {tr('Reject')}
                    </Button>
                    <Button size="sm" onClick={() => askReview(selected, 'APPROVE')}>
                      <Check size={11} /> {tr('Publish')}
                    </Button>
                  </>
                )}
                {isAdmin && selected.STATUS_CODE === 'PUBLISHED' && (
                  <Button size="sm" variant="secondary" onClick={() => archive(selected, true)}>
                    {tr('Archive')}
                  </Button>
                )}
                {isAdmin && selected.STATUS_CODE === 'ARCHIVED' && (
                  <Button size="sm" variant="secondary" onClick={() => archive(selected, false)}>
                    {tr('Publish again')}
                  </Button>
                )}
                {canEditSelected && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFormError('')
                      setEditTarget(selected)
                    }}
                  >
                    <Pencil size={11} /> {tr('Edit')}
                  </Button>
                )}
                {canDeleteSelected && (
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(selected)}>
                    <Trash2 size={11} /> {tr('Remove')}
                  </Button>
                )}
                {selectedType?.code === 'VIDEO' && (
                  <Button size="sm" variant="secondary" onClick={() => play(selected)}>
                    <Play size={11} /> {tr('Watch')}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => openFile(selected)}>
                  <ExternalLink size={11} /> {tr('Open')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => saveOffline(selected)}>
                  <BookOpen size={11} /> {tr('Save for offline')}
                </Button>
                {canDownloadSelected && (
                  <Button size="sm" onClick={() => download(selected)}>
                    <Download size={11} /> {tr('Download')}
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {selected && (
          <div className="space-y-3">
            {selected.DESCRIPTION && (
              <p className="whitespace-pre-line text-[12px] leading-relaxed text-ink-2">{selected.DESCRIPTION}</p>
            )}

            {(selectedIsMine || isAdmin) && <ReviewTimeline item={selected} />}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-[11px]">
              <div>
                <dt className="mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3">{tr('Added by')}</dt>
                <dd className="mt-0.5 text-ink">{selected.UPLOADER_NAME || tr('Unknown author')}</dd>
              </div>
              <div>
                <dt className="mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3">{tr('Added')}</dt>
                <dd className="mono mt-0.5 text-ink">{formatDate(selected.CREATED_AT)}</dd>
              </div>
              <div>
                <dt className="mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3">{tr('File')}</dt>
                <dd className="mono mt-0.5 truncate text-ink" title={selected.FILE_NAME}>
                  {selected.FILE_NAME} · {formatSize(selected.FILE_SIZE)}
                </dd>
              </div>
              <div>
                <dt className="mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3">{tr('Who may read it')}</dt>
                <dd className="mt-0.5 text-ink">{tr(AUDIENCE_LABELS[selected.AUDIENCE_CODE] || selected.AUDIENCE_CODE)}</dd>
              </div>
              <div>
                <dt className="mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3">{tr('Read')}</dt>
                <dd className="mono mt-0.5 text-ink">
                  {selected.VIEW_COUNT || 0} · {selected.DOWNLOAD_COUNT || 0} {tr('downloads')}
                </dd>
              </div>
              <div>
                <dt className="mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3">{tr('Published')}</dt>
                <dd className="mono mt-0.5 text-ink">{selected.PUBLISHED_AT ? formatDate(selected.PUBLISHED_AT) : '—'}</dd>
              </div>
            </dl>

            {selectedType?.code === 'VIDEO' && (
              <video
                key={selected.LIBRARY_ITEM_ID}
                src={mediaUrl(selected.LIBRARY_ITEM_ID)}
                controls
                preload="metadata"
                className="max-h-[46vh] w-full rounded-[3px] border border-line bg-black"
              />
            )}
          </div>
        )}
      </Modal>

      {/* ---- Add a document ---- */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title={tr('Add a document to the Library')}
        maxWidth="max-w-[560px]"
      >
        <ItemForm
          mode="upload"
          categories={categories}
          policy={policy}
          fileName={chosenFile?.name}
          onChooseFile={chooseFile}
          submitting={submitting}
          error={formError}
          onSubmit={submitUpload}
          onCancel={() => setUploadOpen(false)}
        />
      </Modal>

      {/* ---- Edit the catalogue entry ---- */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={tr('Edit this document')}
        maxWidth="max-w-[560px]"
      >
        {editTarget && (
          <ItemForm
            mode="edit"
            initial={editTarget}
            categories={categories}
            policy={policy}
            submitting={submitting}
            error={formError}
            onSubmit={submitEdit}
            onCancel={() => setEditTarget(null)}
          />
        )}
      </Modal>

      {/* ---- Review decision ---- */}
      <Modal
        open={!!reviewTarget}
        onClose={() => setReviewTarget(null)}
        title={reviewDecision === 'APPROVE' ? tr('Publish this document') : tr('Reject this document')}
        maxWidth="max-w-[480px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReviewTarget(null)} disabled={reviewBusy}>
              {tr('Cancel')}
            </Button>
            <Button
              onClick={confirmReview}
              loading={reviewBusy}
              disabled={reviewBusy || (reviewDecision === 'REJECT' && !reviewNote.trim())}
            >
              {reviewDecision === 'APPROVE' ? tr('Publish') : tr('Reject')}
            </Button>
          </div>
        }
      >
        <div className="space-y-2.5">
          <p className="text-[12px] leading-relaxed text-ink-2">
            {reviewDecision === 'APPROVE'
              ? tr('“{title}” will be published to everyone allowed to read it.').replace('{title}', reviewTarget?.TITLE || '')
              : tr('“{title}” will not be published. Its author sees your note and can correct it and send it back.').replace('{title}', reviewTarget?.TITLE || '')}
          </p>
          <div>
            <label className="field-label" htmlFor="library-review-note">
              {reviewDecision === 'REJECT' ? tr('What needs correcting') : tr('Note for the author (optional)')}
            </label>
            <textarea
              id="library-review-note"
              className="field min-h-[70px] resize-y py-1.5 text-[11.5px]"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              maxLength={1000}
              placeholder={reviewDecision === 'REJECT' ? tr('For example: this is a duplicate of an existing book.') : ''}
              autoFocus
            />
          </div>
        </div>
      </Modal>

      {/* ---- Video player ---- */}
      <Modal
        open={!!player}
        onClose={() => setPlayer(null)}
        title={player?.TITLE || ''}
        maxWidth="max-w-[880px]"
        footer={
          player && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="mono text-[10px] text-ink-3">
                {[tr(typeOf(player).label), categoryLabel(player), formatSize(player.FILE_SIZE)]
                  .filter(Boolean).join(' · ')}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => openFile(player)}>
                  <ExternalLink size={11} /> {tr('Open externally')}
                </Button>
                {(!isStudent || !!policy?.studentDownloads) && (
                  <Button size="sm" onClick={() => download(player)}>
                    <Download size={11} /> {tr('Download')}
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        {player && (
          <div>
            <video
              key={player.LIBRARY_ITEM_ID}
              src={mediaUrl(player.LIBRARY_ITEM_ID)}
              controls
              autoPlay
              playsInline
              className="max-h-[58vh] w-full rounded-[3px] bg-black"
            />
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
              {tr('If this recording does not play here, open it externally — the file itself is unchanged.')}
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title={tr('Remove this document')}
        message={`${tr('“{name}” will be deleted from the Library and from storage. This cannot be undone.').replace('{name}', deleteTarget?.TITLE || '')}`}
        confirmLabel={tr('Remove')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </div>
  )
}

// The Admin's review shelf: what is waiting, what the catalogue holds, and what
// the school has actually been reading. Monitoring sits with the queue because
// that is where an administrator already is.
const ReviewShelf = ({ queue, onOpen, onApprove, onReject }) => {
  if (!queue) {
    return (
      <Panel>
        <p className="px-3 py-8 text-center text-[11.5px] text-ink-3">
          {tr('The review queue is not available. Check that the Library tables can be created on this database.')}
        </p>
      </Panel>
    )
  }

  const stats = queue.stats || {}
  const pending = queue.data || []
  const activity = queue.recentActivity || []

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={tr('Waiting')} value={stats.pending || 0} hint={tr('needs a decision')} />
        <Stat label={tr('Published')} value={stats.published || 0} hint={tr('on the shelf')} />
        <Stat label={tr('Rejected')} value={stats.rejected || 0} hint={tr('returned to authors')} />
        <Stat label={tr('Storage')} value={formatSize(stats.storage)} hint={tr('in the Library')} />
      </div>

      <Panel>
        <PanelHeader title={tr('Waiting for review')} meta={pending.length ? `${pending.length}` : undefined} />
        {pending.length === 0 ? (
          <p className="px-3 py-8 text-center text-[11.5px] text-ink-3">
            {tr('Nothing is waiting. Every submission has a decision.')}
          </p>
        ) : (
          pending.map((item) => {
            const type = typeOf(item)
            const Icon = type.code === 'VIDEO' ? Film : type.icon
            return (
              <div
                key={item.LIBRARY_ITEM_ID}
                className="flex flex-wrap items-center gap-2 border-t border-line/70 px-3 py-2.5 first:border-t-0 hover:bg-surface-muted"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-line bg-surface-muted text-ink-2">
                  <Icon size={14} strokeWidth={1.6} />
                </span>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  className="min-w-0 flex-1 text-start"
                >
                  <span className="block truncate text-[12.5px] text-ink">{item.TITLE}</span>
                  <span className="mono mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-ink-3">
                    <span>{tr(type.label)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{categoryLabel(item)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.UPLOADER_NAME || tr('Unknown author')}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(item.CREATED_AT)}</span>
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => onReject(item)}>
                    <X size={11} /> {tr('Reject')}
                  </Button>
                  <Button size="sm" onClick={() => onApprove(item)}>
                    <Check size={11} /> {tr('Publish')}
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </Panel>

      <Panel>
        <PanelHeader title={tr('Recent reading')} meta={tr('Last 10 accesses')} />
        {activity.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11.5px] text-ink-3">
            {tr('No document has been opened yet.')}
          </p>
        ) : (
          activity.map((entry, index) => (
            <div
              key={`${entry.ACCESSED_AT}-${index}`}
              className="flex items-center gap-2 border-t border-line/70 px-3 py-2 first:border-t-0"
            >
              <Clock size={11} className="shrink-0 text-ink-3" />
              <span className="mono shrink-0 text-[9.5px] text-ink-3">
                {formatDateTime(entry.ACCESSED_AT, {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                })}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{entry.TITLE}</span>
              <Pill>{tr(entry.ACCESS_KIND === 'DOWNLOAD' ? 'Downloaded' : 'Opened')}</Pill>
              <span className="mono w-28 shrink-0 truncate text-end text-[10px] text-ink-3">
                {entry.READER_NAME || tr('Unknown reader')}
              </span>
            </div>
          ))
        )}
      </Panel>
    </div>
  )
}

export default Library
