import React, { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate as formatDateValue } from '../dateFormat'
import {
  Archive, BookOpen, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown,
  Download, ExternalLink, File, FileImage, FileText, Film, Folder, FolderOpen, HardDrive,
  Music, Play, Presentation, Search, Table, Trash2, Upload
} from 'lucide-react'
import { PageHeader, Panel, PanelHeader } from './ui/PageHeader'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import Button from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import Notice from './ui/Notice'
import { tr } from '../i18n'

// Lessons — the teaching library.
//
// Every file is attached to a lesson (inside a chapter, inside a major, inside a
// major category), so the page reads as the curriculum does: category → major →
// chapter → lesson → files. A lesson can hold handouts and slides as before, and
// now also video recordings, which the page plays in place instead of handing to
// the operating system.
//
// Files live on disk; the renderer never sees a path. A video is played through
// `lesson-media://media/<id>`, which the main process resolves to the stored file
// and serves with range support, so seeking works.

// Every file is classified by its extension, and that classification is what a
// reader filters on. "Documents" was one bucket for handouts, slide decks,
// spreadsheets and scans alike, which is no help in a shelf of a thousand files,
// so each family is named, counted and filtered on its own.
const FILE_TYPE_DEFS = [
  {
    key: 'video', label: 'Video', icon: Film,
    color: 'var(--color-jade-600)', bg: 'color-mix(in srgb, var(--color-jade-500) 12%, transparent)',
    extensions: ['mp4', 'm4v', 'webm', 'ogv', 'ogg', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp']
  },
  {
    key: 'audio', label: 'Audio', icon: Music,
    color: 'var(--color-jade-700)', bg: 'color-mix(in srgb, var(--color-jade-500) 10%, transparent)',
    extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'oga', 'opus', 'wma', 'aiff', 'amr']
  },
  {
    key: 'image', label: 'Image', icon: FileImage,
    color: 'var(--color-ember-600)', bg: 'color-mix(in srgb, var(--color-ember-500) 14%, transparent)',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff']
  },
  {
    key: 'pdf', label: 'PDF', icon: FileText,
    color: 'var(--color-danger-ink)', bg: 'color-mix(in srgb, var(--color-danger-ink) 12%, transparent)',
    extensions: ['pdf']
  },
  {
    key: 'word', label: 'Word', icon: FileText,
    color: 'var(--color-jade-700)', bg: 'color-mix(in srgb, var(--color-jade-500) 10%, transparent)',
    extensions: ['doc', 'docx', 'odt', 'rtf']
  },
  {
    key: 'slides', label: 'Slides', icon: Presentation,
    color: 'var(--color-ember-600)', bg: 'color-mix(in srgb, var(--color-ember-500) 12%, transparent)',
    extensions: ['ppt', 'pptx', 'odp', 'key']
  },
  {
    key: 'sheet', label: 'Spreadsheet', icon: Table,
    color: 'var(--color-jade-700)', bg: 'color-mix(in srgb, var(--color-jade-500) 10%, transparent)',
    extensions: ['xls', 'xlsx', 'ods', 'csv']
  },
  {
    key: 'text', label: 'Text', icon: FileText,
    color: 'var(--color-ink-2)', bg: 'var(--color-surface-muted)',
    extensions: ['txt', 'md', 'log', 'json', 'xml', 'html', 'css', 'js']
  },
  {
    key: 'archive', label: 'Archive', icon: Archive,
    color: 'var(--color-ink-2)', bg: 'var(--color-surface-muted)',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2']
  },
  {
    key: 'other', label: 'Other file', icon: File,
    color: 'var(--color-ink-3)', bg: 'var(--color-surface-muted)',
    extensions: []
  }
]

const FILE_TYPES = Object.fromEntries(FILE_TYPE_DEFS.map((type) => [type.key, type]))

// Extension → family, built once: a library can hold thousands of files and the
// filter runs on every keystroke.
const EXTENSION_FAMILY = new Map(
  FILE_TYPE_DEFS.flatMap((type) => type.extensions.map((extension) => [extension, type.key]))
)

const fileTypeOf = (doc) => {
  if (doc?.IS_VIDEO) return 'video'
  const ext = String(doc?.FILE_EXTENSION || '').toLowerCase()
  return EXTENSION_FAMILY.get(ext) || 'other'
}

const mediaUrl = (documentId) => `lesson-media://media/${documentId}`

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

const typeStyle = (key) => FILE_TYPES[key] || FILE_TYPES.other

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'largest', label: 'Largest first' }
]

// The order the files inside a lesson are listed in.
const compareDocs = (sortBy) => (a, b) => {
  if (sortBy === 'name') return String(a.DOCUMENT_LABEL || '').localeCompare(String(b.DOCUMENT_LABEL || ''))
  if (sortBy === 'largest') return (Number(b.DOCUMENT_SIZE) || 0) - (Number(a.DOCUMENT_SIZE) || 0)
  const left = new Date(a.DOCUMENT_UPLOAD_DATETIME || 0).getTime()
  const right = new Date(b.DOCUMENT_UPLOAD_DATETIME || 0).getTime()
  return sortBy === 'oldest' ? left - right : right - left
}

// A video row shows a frame taken from the recording itself rather than a film
// icon: the frame is what tells one lecture from another in a list of fifteen.
//
// Capturing is serialised through one hidden <video>, not one player per row — a
// lesson can hold many recordings and a decoder each, just to paint a 50px
// preview, is not worth it. Results (including failures) are cached per document
// for the life of the window, so scrolling and reopening groups reuse the frame.
const FRAME_WIDTH = 100
const FRAME_HEIGHT = 56
const FRAME_CACHE = new Map()
const frameQueue = []
let frameRunning = false

function captureVideoFrame(documentId) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      fn(value)
    }
    // A file that is missing or unreadable must not hold the queue forever.
    const timer = setTimeout(() => finish(reject, new Error('The frame took too long to read.')), 12000)

    const draw = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = FRAME_WIDTH
        canvas.height = FRAME_HEIGHT
        const context = canvas.getContext('2d')
        context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT)
        finish(resolve, canvas.toDataURL('image/jpeg', 0.72))
      } catch (error) {
        finish(reject, error)
      }
    }

    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'
    video.addEventListener('error', () => finish(reject, new Error('The video could not be read.')))
    video.addEventListener('loadeddata', () => {
      // Only when no seek was needed: a frame at the very start is better than none.
      if (!video.currentTime) draw()
    })
    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      // A little way in: recordings often open on a title card or black.
      if (duration > 1) video.currentTime = Math.min(duration * 0.1, 20)
    })
    video.addEventListener('seeked', draw)
    video.src = mediaUrl(documentId)
  })
}

function pumpFrames() {
  if (frameRunning) return
  const job = frameQueue.shift()
  if (!job) return
  frameRunning = true
  captureVideoFrame(job.documentId)
    .then((dataUrl) => {
      FRAME_CACHE.set(job.documentId, dataUrl)
      job.onReady(dataUrl)
    })
    .catch(() => {
      FRAME_CACHE.set(job.documentId, null)
      job.onReady(null)
    })
    .finally(() => {
      frameRunning = false
      pumpFrames()
    })
}

// A still from the recording, or the old icon chip until it arrives (or if the
// file cannot be decoded by this build).
const VideoFrame = ({ documentId }) => {
  const [frame, setFrame] = useState(() => FRAME_CACHE.get(documentId))

  useEffect(() => {
    if (FRAME_CACHE.has(documentId)) {
      setFrame(FRAME_CACHE.get(documentId))
      return undefined
    }
    let live = true
    frameQueue.push({
      documentId,
      onReady: (dataUrl) => {
        if (live) setFrame(dataUrl)
      }
    })
    pumpFrames()
    return () => {
      live = false
    }
  }, [documentId])

  if (!frame) {
    return (
      <span
        className="grid h-8 w-[56px] shrink-0 place-items-center rounded-[3px] border border-line"
        style={{ background: FILE_TYPES.video.bg, color: FILE_TYPES.video.color }}
      >
        <Film size={14} strokeWidth={1.7} />
      </span>
    )
  }

  return (
    <span className="relative h-8 w-[56px] shrink-0 overflow-hidden rounded-[3px] border border-line bg-black">
      <img src={frame} alt="" className="h-full w-full object-cover" />
      <span
        className="absolute inset-0 grid place-items-center"
        style={{ background: 'color-mix(in srgb, #000 22%, transparent)' }}
        aria-hidden="true"
      >
        <Play size={9} strokeWidth={0} fill="#fff" />
      </span>
    </span>
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

// A shelf row: one file from the newest or the most-used end of the library.
// It leads two ways — the name puts the file back in its place in the curriculum
// below, the action opens (or plays) it here.
const HighlightRow = ({ doc, meta, onReveal, onOpen, onPlay }) => {
  const type = fileTypeOf(doc)
  const style = typeStyle(type)
  const Icon = style.icon
  const action = 'grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface hover:text-ink'
  const context = [doc.LESSON_LABEL, doc.CHAPTER_LABEL].filter(Boolean).join(' · ')

  return (
    <div className="flex items-center gap-2.5 border-t border-line/70 px-3 py-2.5 hover:bg-surface-muted">
      {type === 'video' ? (
        <VideoFrame documentId={doc.DOCUMENT_ID} />
      ) : (
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-line"
          style={{ background: style.bg, color: style.color }}
        >
          <Icon size={14} strokeWidth={1.7} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onReveal(doc)}
          className="block w-full truncate text-start text-[12.5px] text-ink hover:text-jade-600"
          title={tr('Show in the library')}
        >
          {doc.DOCUMENT_LABEL}
        </button>
        <div className="mono mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-ink-3">
          <span className="truncate">{context || tr('Unfiled')}</span>
          {meta && (
            <>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{meta}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {type === 'video' && (
          <button
            type="button"
            onClick={() => onPlay(doc)}
            className="inline-flex h-7 items-center gap-1 rounded-[3px] px-1.5 text-[11px] font-medium text-jade-600 hover:bg-surface"
            title={tr('Watch video')}
          >
            <Play size={12} strokeWidth={2} /> {tr('Watch')}
          </button>
        )}
        <button type="button" onClick={() => onOpen(doc)} className={action} title={tr('Open')}>
          <ExternalLink size={13} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}

const Lessons = ({ user }) => {
  const [documents, setDocuments] = useState([])
  const [documentTypes, setDocumentTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('all') // 'all' or a file-family key
  // 'all' or 'mine': a teacher who uploads a lot still needs to find their own
  // files again in a library that belongs to everybody.
  const [uploaderFilter, setUploaderFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [expanded, setExpanded] = useState({})
  const [notice, setNotice] = useState(null)

  // Upload dialog: the cascade of category → major → chapter → lesson.
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [categories, setCategories] = useState([])
  const [majors, setMajors] = useState([])
  const [chapters, setChapters] = useState([])
  const [lessons, setLessons] = useState([])
  const [teacherMajors, setTeacherMajors] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedMajor, setSelectedMajor] = useState('')
  const [selectedChapter, setSelectedChapter] = useState('')
  const [selectedLesson, setSelectedLesson] = useState('')
  // Who may read the files in this upload; the curriculum default keeps them
  // with the major they are filed under.
  const [visibility, setVisibility] = useState('CURRICULUM')

  const [playerDoc, setPlayerDoc] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  // The popular shelf needs a usage signal from the database; `unavailable`
  // hides it instead of showing a permanently empty panel.
  const [popular, setPopular] = useState([])
  const [popularUnavailable, setPopularUnavailable] = useState(false)
  const libraryRef = useRef(null)

  const roles = user?.roles || []
  const isStudent = roles.includes('STUDENT') && !roles.includes('TEACHER') && !roles.includes('ADMIN')
  // The school office looks after every major, a teacher only the ones they
  // teach. The main process draws the same line, so the page and the record
  // agree on who may read, add and remove a file.
  const isOffice = ['ADMIN', 'DEVELOPER', 'DIRECTOR', 'SECRETARY', 'SCHEDULER'].some((role) => roles.includes(role))
  const isTeacher = roles.includes('TEACHER')
  const canAddFiles = isOffice || isTeacher
  // TEACHER accounts may only file material under the majors they teach.
  const isTeacherRestricted = isTeacher && !isOffice
  // The account behind the screen, used to recognise the files it uploaded.
  const myUserId = user?.id ? String(user.id) : ''
  const isMyUpload = (doc) => !!myUserId && String(doc.DOCUMENT_UPLOADED_BY_USER_ID) === myUserId
  // The office may remove any file; anyone else only the ones they added.
  const canDelete = (doc) => isOffice || isMyUpload(doc)

  useEffect(() => {
    loadInitialData()
  }, [])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const [docsResult, typesResult, popularResult] = await Promise.all([
        window.api.getDocuments(user?.id),
        window.api.getDocumentTypes(),
        window.api.getPopularDocuments({ limit: 6, days: 90, userId: user?.id }).catch(() => null)
      ])
      setDocuments(docsResult.data || [])
      setDocumentTypes(typesResult.data || [])
      setPopular(popularResult?.data || [])
      setPopularUnavailable(!!popularResult?.unavailable)
    } catch (err) {
      console.error('Failed to load lessons', err)
      setNotice({ type: 'error', text: `${tr('Could not load the lesson library')}: ${err.message || ''}` })
    } finally {
      setLoading(false)
    }
  }

  const loadDocuments = async () => {
    try {
      const result = await window.api.getDocuments(user?.id)
      setDocuments(result.data || [])
    } catch (err) {
      console.error('Failed to reload lessons', err)
    }
  }

  const loadPopular = async () => {
    try {
      const result = await window.api.getPopularDocuments({ limit: 6, days: 90, userId: user?.id })
      setPopular(result?.data || [])
      setPopularUnavailable(!!result?.unavailable)
    } catch (err) {
      console.error('Failed to reload the popular files', err)
    }
  }

  // Playing a recording in the page is an access like any other, so it counts
  // towards the popular shelf. Best-effort: a failure never blocks the player.
  const openPlayer = (doc) => {
    setPlayerDoc(doc)
    try {
      window.api.trackDocumentView?.(doc.DOCUMENT_ID, user?.id)?.catch?.(() => {})
    } catch {
      // Usage is a nicety; the video still plays.
    }
  }

  // A shelf row is also a way back into the curriculum: searching for its name
  // and opening its branch puts the file in context in the library below.
  const revealInLibrary = (doc) => {
    setTypeFilter('all')
    setSearchTerm(doc.DOCUMENT_LABEL || '')
    setExpanded((prev) => ({
      ...prev,
      [`category:${String(doc.MAJOR_CATEGORY_ID ?? 'uncategorized')}`]: true,
      [`major:${String(doc.MAJOR_ID ?? 'no-major')}`]: true,
      [`chapter:${String(doc.CHAPTER_ID ?? 'no-chapter')}`]: true
    }))
    libraryRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const openFromShelf = (doc) => {
    if (fileTypeOf(doc) === 'video') openPlayer(doc)
    else handleOpen(doc.DOCUMENT_ID)
  }

  const teacherCategories = []
  const seenCategories = new Set()
  teacherMajors.forEach((m) => {
    const id = m.MAJOR_CATEGORY_ID ?? ''
    if (seenCategories.has(String(id))) return
    seenCategories.add(String(id))
    teacherCategories.push({
      MAJOR_CATEGORY_ID: id,
      MAJOR_CATEGORY_LABEL: m.MAJOR_CATEGORY_LABEL || tr('Uncategorized')
    })
  })
  const restrictedMajors = teacherMajors.filter(m => String(m.MAJOR_CATEGORY_ID ?? '') === String(selectedCategory ?? ''))

  const openUpload = async () => {
    setSelectedCategory('')
    setSelectedMajor('')
    setSelectedChapter('')
    setSelectedLesson('')
    setVisibility('CURRICULUM')
    setMajors([])
    setChapters([])
    setLessons([])

    if (isTeacherRestricted) {
      try {
        const result = await window.api.getMajorsTaughtByTeacher(user.personId)
        const taught = result?.data || []
        setTeacherMajors(taught)
        if (taught.length === 0) {
          setNotice({
            type: 'error',
            text: tr('No majors are assigned to you yet. Ask an administrator to assign the majors you teach before uploading lessons.')
          })
          return
        }
      } catch (err) {
        console.error('Failed to load the majors you teach', err)
        setNotice({ type: 'error', text: tr('Failed to load the majors you teach.') })
        return
      }
      setShowUploadModal(true)
      return
    }

    setShowUploadModal(true)
    try {
      const result = await window.api.getDocMajorCategories()
      setCategories(result.data || [])
    } catch (err) {
      console.error('Failed to load categories', err)
    }
  }

  const handleCategoryChange = async (categoryId) => {
    setSelectedCategory(categoryId)
    setSelectedMajor('')
    setSelectedChapter('')
    setSelectedLesson('')
    setChapters([])
    setLessons([])
    if (isTeacherRestricted) {
      setMajors(teacherMajors.filter(m => String(m.MAJOR_CATEGORY_ID ?? '') === String(categoryId ?? '')))
    } else if (categoryId) {
      try {
        const result = await window.api.getMajorsByCategory(categoryId)
        setMajors(result.data || [])
      } catch (err) {
        console.error('Failed to load majors', err)
      }
    } else {
      setMajors([])
    }
  }

  const handleMajorChange = async (majorId) => {
    setSelectedMajor(majorId)
    setSelectedChapter('')
    setSelectedLesson('')
    setLessons([])
    if (!majorId) {
      setChapters([])
      return
    }
    try {
      const result = await window.api.getChaptersByMajor(majorId)
      setChapters(result.data || [])
    } catch (err) {
      console.error('Failed to load chapters', err)
    }
  }

  const handleChapterChange = async (chapterId) => {
    setSelectedChapter(chapterId)
    setSelectedLesson('')
    if (!chapterId) {
      setLessons([])
      return
    }
    try {
      const result = await window.api.getLessonsByChapter(chapterId)
      setLessons(result.data || [])
    } catch (err) {
      console.error('Failed to load lessons', err)
    }
  }

  // One pick can carry a whole lecture: slides, a handout and the recording go
  // into the same lesson in a single pass. Files are copied one at a time so a
  // single unreadable file is reported by name instead of sinking the batch.
  const handleConfirmUpload = async () => {
    let fileResult = null
    try {
      fileResult = await window.api.openFileDialog({ multiple: true })
    } catch (err) {
      setNotice({ type: 'error', text: `${tr('Upload failed')}: ${err.message || ''}` })
      return
    }
    if (!fileResult || fileResult.canceled || !fileResult.filePaths?.length) return

    setUploading(true)
    const failed = []
    let refusal = ''
    let added = 0
    try {
      for (const filePath of fileResult.filePaths) {
        const metadata = { DOCUMENT_LABEL_EN: filePath.split(/[\\/]/).pop() }
        if (documentTypes.length > 0) metadata.DOCUMENT_TYPE_ID = documentTypes[0].DOCUMENT_TYPE_ID
        if (selectedLesson) metadata.lessonId = selectedLesson
        metadata.DOCUMENT_VISIBILITY_CODE = visibility
        // Attribute the file to its uploader so it can be found again under
        // "My uploads".
        if (user?.id) metadata.uploadedByUserId = user.id
        try {
          const result = await window.api.uploadDocument(filePath, metadata)
          // A refusal comes back as a plain answer, not a throw: the file was
          // not copied and the reason is shown instead.
          if (result?.error) {
            refusal = result.error
            failed.push(metadata.DOCUMENT_LABEL_EN)
          } else {
            added += 1
          }
        } catch (err) {
          console.error('Upload failed', filePath, err)
          failed.push(metadata.DOCUMENT_LABEL_EN)
        }
      }

      await loadDocuments()
      if (added) setShowUploadModal(false)

      if (refusal && !added) {
        setNotice({ type: 'error', text: refusal })
      } else if (failed.length) {
        const addedNote = added ? ` — ${added} ${added === 1 ? tr('file added') : tr('files added')}` : ''
        setNotice({ type: 'error', text: `${tr('Could not add')}: ${failed.join(', ')}${addedNote}` })
      } else {
        setNotice({
          type: 'ok',
          text: added === 1
            ? tr('File added to the lesson library.')
            : `${added} ${tr('files added to the lesson library.')}`
        })
      }
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      const result = await window.api.deleteDocument(id, user?.id)
      if (result?.error) {
        setNotice({ type: 'error', text: result.error })
        return
      }
      await loadDocuments()
      await loadPopular()
      setNotice({ type: 'ok', text: tr('File deleted.') })
    } catch (err) {
      console.error('Delete failed', err)
      setNotice({ type: 'error', text: `${tr('Delete failed')}: ${err.message || ''}` })
    }
  }

  // Keeps a copy of this file on this computer, so it opens during an outage.
  // The lesson catalogue is cached; the file on the share is not.
  const handleSaveOffline = async (id) => {
    try {
      const result = await window.api.saveDocumentOffline(user?.id, id)
      if (result?.error) setNotice({ type: 'error', text: result.error })
      else if (result?.success) {
        setNotice({ type: 'ok', text: tr('Saved on this computer. It can be opened during an outage.') })
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('The file could not be saved for offline use.') })
    }
  }

  const handleDownload = async (id) => {
    try {
      const result = await window.api.downloadDocument(id, user?.id)
      if (result?.error) setNotice({ type: 'error', text: result.error })
      else if (result?.success) {
        setNotice({ type: 'ok', text: `${tr('Saved to')}: ${result.path}` })
        loadPopular()
      }
    } catch (err) {
      console.error('Download failed', err)
      setNotice({ type: 'error', text: `${tr('Download failed')}: ${err.message}` })
    }
  }

  const handleOpen = async (id) => {
    try {
      const result = await window.api.openDocument(id, user?.id)
      if (result?.error) setNotice({ type: 'error', text: result.error })
      else if (result?.success) loadPopular()
    } catch (err) {
      console.error('Open failed', err)
      setNotice({ type: 'error', text: `${tr('Open failed')}: ${err.message}` })
    }
  }

  // The families the library actually holds, in catalogue order, each with the
  // count shown on its chip — an empty family is not offered.
  const typeCounts = useMemo(() => {
    const counts = new Map()
    for (const doc of documents) {
      const key = fileTypeOf(doc)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return FILE_TYPE_DEFS
      .map((type) => ({ ...type, count: counts.get(type.key) || 0 }))
      .filter((type) => type.count > 0)
  }, [documents])

  // How many files this account added, for the "My uploads" option's count.
  const myUploadsCount = useMemo(
    () => documents.filter(isMyUpload).length,
    [documents, myUserId]
  )

  const filteredDocs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return documents.filter((doc) => {
      if (uploaderFilter === 'mine' && !isMyUpload(doc)) return false
      const type = fileTypeOf(doc)
      if (typeFilter !== 'all' && type !== typeFilter) return false
      if (!term) return true
      // The family and the extension are searchable too, so "pdf" or "slides"
      // finds a file whose name says nothing about what it is.
      return [
        doc.DOCUMENT_LABEL, doc.DOCUMENT_TYPE_LABEL, doc.FILE_EXTENSION,
        typeStyle(type).label, tr(typeStyle(type).label),
        doc.LESSON_LABEL, doc.CHAPTER_LABEL, doc.MAJOR_LABEL, doc.MAJOR_CATEGORY_LABEL
      ].filter(Boolean).join(' ').toLowerCase().includes(term)
    })
  }, [documents, typeFilter, uploaderFilter, searchTerm, myUserId])

  // category → major → chapter → lesson → files, with the counts each level
  // needs for its header.
  const groupedDocs = useMemo(() => {
    const byLabel = (a, b) => String(a.label || '').localeCompare(String(b.label || ''))
    const categories = new Map()

    for (const doc of filteredDocs) {
      const categoryKey = String(doc.MAJOR_CATEGORY_ID ?? 'uncategorized')
      if (!categories.has(categoryKey)) {
        categories.set(categoryKey, {
          key: categoryKey,
          label: doc.MAJOR_CATEGORY_LABEL || tr('Uncategorized'),
          code: doc.MAJOR_CATEGORY_CODE,
          majors: new Map()
        })
      }
      const category = categories.get(categoryKey)

      const majorKey = String(doc.MAJOR_ID ?? 'no-major')
      if (!category.majors.has(majorKey)) {
        category.majors.set(majorKey, {
          key: majorKey,
          label: doc.MAJOR_LABEL || tr('No major'),
          code: doc.MAJOR_CODE,
          chapters: new Map()
        })
      }
      const major = category.majors.get(majorKey)

      const chapterKey = String(doc.CHAPTER_ID ?? 'no-chapter')
      if (!major.chapters.has(chapterKey)) {
        major.chapters.set(chapterKey, {
          key: chapterKey,
          label: doc.CHAPTER_LABEL || tr('No chapter'),
          code: doc.CHAPTER_CODE,
          lessons: new Map()
        })
      }
      const chapter = major.chapters.get(chapterKey)

      const lessonKey = String(doc.LESSON_ID ?? 'no-lesson')
      if (!chapter.lessons.has(lessonKey)) {
        chapter.lessons.set(lessonKey, {
          key: lessonKey,
          label: doc.LESSON_LABEL || tr('Unfiled'),
          code: doc.LESSON_CODE,
          documents: []
        })
      }
      chapter.lessons.get(lessonKey).documents.push(doc)
    }

    return [...categories.values()]
      .sort(byLabel)
      .map((category) => ({
        ...category,
        count: [...category.majors.values()].reduce(
          (n, major) => n + [...major.chapters.values()].reduce(
            (m, chapter) => m + [...chapter.lessons.values()].reduce((l, lesson) => l + lesson.documents.length, 0),
            0
          ),
          0
        ),
        majors: [...category.majors.values()]
          .filter((major) => major.chapters.size > 0)
          .map((major) => ({
            ...major,
            chapters: [...major.chapters.values()]
              .filter((chapter) => chapter.lessons.size > 0)
              .map((chapter) => ({
                ...chapter,
                lessons: [...chapter.lessons.values()]
                  .sort(byLabel)
                  .map((lesson) => ({
                    ...lesson,
                    documents: [...lesson.documents].sort(compareDocs(sortBy))
                  }))
              }))
          }))
      }))
  }, [filteredDocs, sortBy])

  const stats = useMemo(() => {
    const byType = new Map()
    for (const doc of documents) {
      const type = fileTypeOf(doc)
      byType.set(type, (byType.get(type) || 0) + 1)
    }
    const lessons = new Set(documents.map((doc) => doc.LESSON_ID).filter(Boolean))
    const written = documents.filter((doc) => !['video', 'audio', 'image'].includes(fileTypeOf(doc)))
    // This calendar week opens on Sunday.
    const weekStartDate = new Date()
    weekStartDate.setHours(0, 0, 0, 0)
    weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay())
    const weekStart = weekStartDate.getTime()
    return {
      files: documents.length,
      videos: byType.get('video') || 0,
      images: byType.get('image') || 0,
      documents: written.length,
      types: byType.size,
      lessons: lessons.size,
      // What arrived this week (Sunday→Saturday): the masthead's one piece of momentum.
      filesThisWeek: documents.filter(
        (doc) => new Date(doc.DOCUMENT_UPLOAD_DATETIME || 0).getTime() >= weekStart
      ).length,
      storage: formatSize(documents.reduce((sum, doc) => sum + (Number(doc.DOCUMENT_SIZE) || 0), 0))
    }
  }, [documents])

  const latestDocs = useMemo(() => {
    const uploadedAt = (doc) => new Date(doc.DOCUMENT_UPLOAD_DATETIME || 0).getTime() || 0
    return [...documents].sort((a, b) => uploadedAt(b) - uploadedAt(a)).slice(0, 6)
  }, [documents])

  // Everything below the category level opens at once, so a whole curriculum can
  // be read without a dozen clicks — and closes again the same way.
  const allKeys = useMemo(() => {
    const keys = []
    for (const category of groupedDocs) {
      keys.push(`category:${category.key}`)
      for (const major of category.majors) {
        keys.push(`major:${major.key}`)
        for (const chapter of major.chapters) {
          keys.push(`chapter:${chapter.key}`)
          for (const lesson of chapter.lessons) keys.push(`lesson:${lesson.key}`)
        }
      }
    }
    return keys
  }, [groupedDocs])

  const allOpen = allKeys.length > 0 && allKeys.every((key) => expanded[key])
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  const expandAll = () => {
    if (allOpen) {
      setExpanded({})
      return
    }
    const next = {}
    for (const key of allKeys) next[key] = true
    setExpanded(next)
  }

  const rowAction = 'grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface hover:text-ink'

  const renderFile = (doc) => {
    const type = fileTypeOf(doc)
    const style = typeStyle(type)
    const Icon = style.icon
    return (
      <div
        key={doc.DOCUMENT_ID}
        className="group flex items-center gap-2.5 border-t border-line/70 px-3 py-2.5 hover:bg-surface-muted"
      >
        {type === 'video' ? (
          <VideoFrame documentId={doc.DOCUMENT_ID} />
        ) : (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-line"
            style={{ background: style.bg, color: style.color }}
          >
            <Icon size={14} strokeWidth={1.7} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[12.5px] text-ink">{doc.DOCUMENT_LABEL}</span>
            <span
              className="mono shrink-0 rounded-[2px] px-1 text-[8.5px] uppercase tracking-[0.06em]"
              style={{ background: style.bg, color: style.color }}
            >
              {doc.FILE_EXTENSION || tr(style.label)}
            </span>
            {isMyUpload(doc) && (
              <span
                className="shrink-0 rounded-[2px] px-1 text-[8.5px] text-jade-600"
                style={{ background: 'color-mix(in srgb, var(--color-jade-500) 12%, transparent)' }}
                title={tr('You added this file')}
              >
                {tr('Uploaded by you')}
              </span>
            )}
          </div>
          <div className="mono mt-0.5 flex items-center gap-2 truncate text-[10.5px] text-ink-3">
            <span className="truncate">{tr(style.label)}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{formatSize(doc.DOCUMENT_SIZE)}</span>
            {doc.DOCUMENT_UPLOAD_DATETIME && (
              <>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{formatDate(doc.DOCUMENT_UPLOAD_DATETIME)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {type === 'video' && (
            <button
              type="button"
              onClick={() => openPlayer(doc)}
              className="inline-flex h-7 items-center gap-1 rounded-[3px] px-1.5 text-[11px] font-medium text-jade-600 hover:bg-surface"
              title={tr('Watch video')}
            >
              <Play size={12} strokeWidth={2} /> {tr('Watch')}
            </button>
          )}
          <button type="button" onClick={() => handleOpen(doc.DOCUMENT_ID)} className={rowAction} title={tr('Open with the default application')}>
            <ExternalLink size={13} strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => handleDownload(doc.DOCUMENT_ID)} className={rowAction} title={tr('Download')}>
            <Download size={13} strokeWidth={1.8} />
          </button>
          <button type="button" onClick={() => handleSaveOffline(doc.DOCUMENT_ID)} className={rowAction} title={tr('Save for offline')}>
            <HardDrive size={13} strokeWidth={1.8} />
          </button>
          {canDelete(doc) && (
            <button
              type="button"
              onClick={() => setConfirmTarget(doc)}
              className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface hover:text-danger-ink"
              title={tr('Delete')}
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const renderGroupRow = ({ rowKey, label, code, count, depth, expandedKey, children }) => {
    const isOpen = !!expanded[expandedKey]
    const Chevron = isOpen ? ChevronDown : ChevronRight
    const FolderIcon = isOpen ? FolderOpen : Folder
    return (
      <div key={rowKey}>
        <button
          type="button"
          onClick={() => toggle(expandedKey)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-1.5 border-t border-line bg-surface px-3 py-2 text-start hover:bg-surface-muted"
          style={{ paddingInlineStart: 12 + depth * 14 }}
        >
          <Chevron size={13} className="shrink-0 text-ink-3" />
          <FolderIcon size={14} strokeWidth={1.7} className="shrink-0" style={{ color: depth === 0 ? 'var(--color-jade-600)' : 'var(--color-ink-3)' }} />
          <span className={`truncate ${depth === 0 ? 'text-[13px] font-semibold text-ink' : 'text-[12.5px] text-ink-2'}`}>{label}</span>
          {code && <span className="mono shrink-0 text-[9.5px] text-ink-3">{code}</span>}
          <span className="mono ms-auto shrink-0 text-[10.5px] text-ink-3">{count}</span>
        </button>
        {isOpen && children}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Teaching')}
        title={tr('Lessons')}
        meta={`${stats.files} ${tr('files')} · ${stats.videos} ${tr('videos')} · ${stats.types} ${tr('file types')} · ${stats.lessons} ${tr('lessons')}`}
        actions={
          canAddFiles && (
            <Button size="sm" onClick={openUpload}>
              <Upload size={12} strokeWidth={2} /> {tr('Add files')}
            </Button>
          )
        }
      />

      <div className="grid shrink-0 grid-cols-2 border-b border-line sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={tr('Files')}
          value={stats.files}
          hint={stats.filesThisWeek ? `+${stats.filesThisWeek} ${tr('this week')}` : tr('in the library')}
        />
        <Stat label={tr('Videos')} value={stats.videos} hint={tr('watchable here')} />
        <Stat label={tr('Documents')} value={stats.documents} hint={tr('open or download')} />
        <Stat label={tr('Images')} value={stats.images} hint={tr('in the library')} />
        <Stat label={tr('Storage')} value={stats.storage} hint={`${stats.types} ${tr('file types')}`} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-3">
          {/* Two shelves over the library: what just arrived, and what the
              school actually reaches for. Both are one click from the file. */}
          <div className={`grid gap-3 ${popularUnavailable ? '' : 'xl:grid-cols-2'}`}>
            <Panel>
              <PanelHeader
                title={tr('Latest uploads')}
                meta={latestDocs.length ? `${latestDocs.length} ${tr('files')}` : undefined}
              />
              {loading ? (
                <p className="px-3 py-6 text-center text-[11.5px] text-ink-3">{tr('Loading the lesson library…')}</p>
              ) : latestDocs.length === 0 ? (
                <p className="px-3 py-6 text-center text-[11.5px] text-ink-3">{tr('Nothing has been added yet.')}</p>
              ) : (
                latestDocs.map((doc) => (
                  <HighlightRow
                    key={doc.DOCUMENT_ID}
                    doc={doc}
                    meta={formatDate(doc.DOCUMENT_UPLOAD_DATETIME)}
                    onReveal={revealInLibrary}
                    onOpen={openFromShelf}
                    onPlay={openPlayer}
                  />
                ))
              )}
            </Panel>

            {!popularUnavailable && (
              <Panel>
                <PanelHeader title={tr('Popular')} meta={tr('Last 90 days')} />
                {loading ? (
                  <p className="px-3 py-6 text-center text-[11.5px] text-ink-3">{tr('Loading the lesson library…')}</p>
                ) : popular.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[11.5px] leading-relaxed text-ink-3">
                    {tr('No usage recorded yet. Files appear here once they are opened or downloaded.')}
                  </p>
                ) : (
                  popular.map((doc) => (
                    <HighlightRow
                      key={doc.DOCUMENT_ID}
                      doc={doc}
                      meta={Number(doc.ACCESS_COUNT) === 1
                        ? tr('opened once')
                        : tr('opened {count} times', { count: doc.ACCESS_COUNT })}
                      onReveal={revealInLibrary}
                      onOpen={openFromShelf}
                      onPlay={openPlayer}
                    />
                  ))
                )}
              </Panel>
            )}
          </div>

          <div ref={libraryRef}>
            <Panel>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <div className="relative min-w-[190px] flex-1">
              <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={tr('Search files, lessons, chapters…')}
                aria-label={tr('Search the lesson library')}
                className="field h-7 w-full ps-7 text-[11.5px]"
              />
            </div>

            <Button size="sm" variant="secondary" onClick={expandAll} disabled={allKeys.length === 0}>
              {allOpen ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
              {allOpen ? tr('Collapse all') : tr('Expand all')}
            </Button>

            <span className="mono shrink-0 text-[10px] text-ink-3">
              {filteredDocs.length} / {documents.length}
            </span>

          {/* The file family and the ordering sit beside the search. */}
          <FilterBar
            activeCount={
              (searchTerm.trim() ? 1 : 0)
              + (typeFilter !== 'all' ? 1 : 0)
              + (canAddFiles && uploaderFilter !== 'all' ? 1 : 0)
            }
            onClear={() => { setSearchTerm(''); setTypeFilter('all'); setUploaderFilter('all') }}
            matchCount={filteredDocs.length}
            matchLabel="file"
            title={tr('Filter files')}
          >
            {/* Only an account that can add files has any of its own to find. */}
            {canAddFiles && (
              <FilterField label={tr('Uploaded by')}>
                <select
                  className={filterInputCls}
                  value={uploaderFilter}
                  onChange={(e) => setUploaderFilter(e.target.value)}
                  aria-label={tr('Filter by uploader')}
                >
                  <option value="all">{tr('All files')} ({documents.length})</option>
                  <option value="mine">{tr('My uploads')} ({myUploadsCount})</option>
                </select>
              </FilterField>
            )}
            <FilterField label={tr('File type')}>
              <select
                className={filterInputCls}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label={tr('Filter by file type')}
              >
                <option value="all">{tr('All files')} ({documents.length})</option>
                {typeCounts.map((type) => (
                  <option key={type.key} value={type.key}>{tr(type.label)} ({type.count})</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr('Sort by')}>
              <select
                className={filterInputCls}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label={tr('Sort files')}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
            </FilterField>
          </FilterBar>
          </div>

          {loading ? (
            <p className="px-3 py-10 text-center text-[11.5px] text-ink-3">{tr('Loading the lesson library…')}</p>
          ) : documents.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <BookOpen size={22} className="mx-auto text-ink-3" strokeWidth={1.6} />
              <p className="mt-2 text-[12px] font-medium text-ink">{tr('No lesson files yet.')}</p>
              <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-ink-3">
                {isStudent
                  ? tr('Files your teachers add to a lesson will appear here.')
                  : tr('Add slides, handouts, images or a recorded session to a lesson; videos play right here in the page.')}
              </p>
              {canAddFiles && (
                <Button size="sm" className="mt-3" onClick={openUpload}>
                  <Upload size={12} /> {tr('Add the first file')}
                </Button>
              )}
            </div>
          ) : filteredDocs.length === 0 ? (
            <p className="px-3 py-10 text-center text-[11.5px] text-ink-3">
              {tr('Nothing matches this search or filter.')}
            </p>
          ) : (
            <div>
              {groupedDocs.map((category) =>
                renderGroupRow({
                  rowKey: `category:${category.key}`,
                  label: category.label,
                  code: category.code,
                  count: category.count,
                  depth: 0,
                  expandedKey: `category:${category.key}`,
                  children: category.majors.map((major) =>
                    renderGroupRow({
                      rowKey: `major:${major.key}`,
                      label: major.label,
                      code: major.code,
                      count: [...major.chapters.values()].reduce(
                        (n, chapter) => n + chapter.lessons.reduce((m, lesson) => m + lesson.documents.length, 0),
                        0
                      ),
                      depth: 1,
                      expandedKey: `major:${major.key}`,
                      children: major.chapters.map((chapter) =>
                        renderGroupRow({
                          rowKey: `chapter:${chapter.key}`,
                          label: chapter.label,
                          code: chapter.code,
                          count: chapter.lessons.reduce((n, lesson) => n + lesson.documents.length, 0),
                          depth: 2,
                          expandedKey: `chapter:${chapter.key}`,
                          children: chapter.lessons.map((lesson) => (
                            <div key={lesson.key}>
                              <div
                                className="flex items-center gap-1.5 border-t border-line bg-surface-muted px-3 py-2"
                                style={{ paddingInlineStart: 12 + 3 * 14 }}
                              >
                                <BookOpen size={13} strokeWidth={1.7} className="shrink-0" style={{ color: 'var(--color-jade-600)' }} />
                                <span className="truncate text-[12.5px] text-ink">{lesson.label}</span>
                                {lesson.code && <span className="mono shrink-0 text-[9.5px] text-ink-3">{lesson.code}</span>}
                                <span className="mono ms-auto shrink-0 text-[10.5px] text-ink-3">
                                  {formatSize(lesson.documents.reduce((sum, doc) => sum + (Number(doc.DOCUMENT_SIZE) || 0), 0))}
                                  {' · '}
                                  {lesson.documents.length}
                                </span>
                              </div>
                              {lesson.documents.map(renderFile)}
                            </div>
                          ))
                        })
                      )
                    })
                  )
                })
              )}
            </div>
          )}
            </Panel>
          </div>
        </div>
      </div>

      <Modal
        open={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        title={tr('Add files to a lesson')}
        maxWidth="max-w-[520px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowUploadModal(false)} disabled={uploading}>{tr('Cancel')}</Button>
            <Button
              onClick={handleConfirmUpload}
              loading={uploading}
              disabled={uploading || (isTeacherRestricted && !selectedLesson)}
            >
              <Upload size={12} /> {uploading ? tr('Adding files…') : tr('Choose files and upload')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {isTeacherRestricted && (
            <p className="rounded-[3px] border border-line-strong bg-surface-muted px-2.5 py-2 text-[11px] leading-relaxed text-ink-2">
              {tr('You can only add files to the majors you teach.')}
            </p>
          )}

          <div>
            <label className="field-label" htmlFor="lesson-category">{tr('Category')}</label>
            <select id="lesson-category" className="field h-8 text-[11.5px]" value={selectedCategory} onChange={(e) => handleCategoryChange(e.target.value)}>
              <option value="">{tr('Select a category')}</option>
              {(isTeacherRestricted ? teacherCategories : categories).map(cat => (
                <option key={String(cat.MAJOR_CATEGORY_ID ?? 'uncategorized')} value={cat.MAJOR_CATEGORY_ID ?? ''}>
                  {cat.MAJOR_CATEGORY_LABEL}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="lesson-major">{tr('Major')}</label>
            <select
              id="lesson-major"
              className="field h-8 text-[11.5px]"
              value={selectedMajor}
              onChange={(e) => handleMajorChange(e.target.value)}
              disabled={!selectedCategory}
            >
              <option value="">{tr('Select a major')}</option>
              {(isTeacherRestricted ? restrictedMajors : majors).map(major => (
                <option key={major.MAJOR_ID} value={major.MAJOR_ID}>{major.MAJOR_LABEL}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="lesson-chapter">{tr('Chapter')}</label>
            <select
              id="lesson-chapter"
              className="field h-8 text-[11.5px]"
              value={selectedChapter}
              onChange={(e) => handleChapterChange(e.target.value)}
              disabled={!selectedMajor}
            >
              <option value="">{tr('Select a chapter')}</option>
              {chapters.map(chapter => (
                <option key={chapter.CHAPTER_ID} value={chapter.CHAPTER_ID}>{chapter.CHAPTER_LABEL}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="lesson-lesson">{tr('Lesson')}</label>
            <select
              id="lesson-lesson"
              className="field h-8 text-[11.5px]"
              value={selectedLesson}
              onChange={(e) => setSelectedLesson(e.target.value)}
              disabled={!selectedChapter}
            >
              <option value="">{tr('Select a lesson')}</option>
              {lessons.map(lesson => (
                <option key={lesson.LESSON_ID} value={lesson.LESSON_ID}>{lesson.LESSON_LABEL}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
              {tr('Every file is filed by its extension — video, audio, image, PDF, slides or spreadsheet — so the filters above can find it again; videos play in this page and any file can still be downloaded.')}
            </p>
            {isTeacherRestricted && !selectedLesson && (
              <p className="mt-1.5 text-[10.5px] text-danger-ink">
                {tr('Choose the lesson this file belongs to.')}
              </p>
            )}
          </div>

          <div>
            <label className="field-label" htmlFor="lesson-visibility">{tr('Who may read it')}</label>
            <select
              id="lesson-visibility"
              className="field h-8 text-[11.5px]"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
            >
              <option value="CURRICULUM">{tr('Students and teachers of the lesson’s major')}</option>
              <option value="TEACHERS">{tr('Teachers of that major only')}</option>
              <option value="ADMINS">{tr('The school office only')}</option>
              {isOffice && <option value="EVERYONE">{tr('Everyone in the school')}</option>}
            </select>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
              {tr('The major a file is filed under decides who may read it; this narrows that for a file that must not reach students.')}
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!playerDoc}
        onClose={() => setPlayerDoc(null)}
        title={playerDoc?.DOCUMENT_LABEL || ''}
        maxWidth="max-w-[880px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[10px] text-ink-3">
              {[
                playerDoc?.DOCUMENT_TYPE_LABEL || playerDoc?.FILE_EXTENSION?.toUpperCase(),
                playerDoc && formatSize(playerDoc.DOCUMENT_SIZE),
                playerDoc && formatDate(playerDoc.DOCUMENT_UPLOAD_DATETIME),
                playerDoc?.LESSON_LABEL
              ].filter(Boolean).join(' · ')}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => playerDoc && handleOpen(playerDoc.DOCUMENT_ID)}>
                <ExternalLink size={11} /> {tr('Open externally')}
              </Button>
              <Button size="sm" onClick={() => playerDoc && handleDownload(playerDoc.DOCUMENT_ID)}>
                <Download size={11} /> {tr('Download')}
              </Button>
            </div>
          </div>
        }
      >
        {playerDoc && (
          <div>
            <video
              key={playerDoc.DOCUMENT_ID}
              src={mediaUrl(playerDoc.DOCUMENT_ID)}
              controls
              autoPlay
              playsInline
              className="max-h-[58vh] w-full rounded-[3px] bg-black"
            />
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
              {tr('If this recording does not play here, open it externally — the file itself is unchanged.')}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <HardDrive size={11} className="shrink-0 text-ink-3" />
              <span className="mono text-[10px] text-ink-3">
                {[playerDoc.CHAPTER_LABEL, playerDoc.MAJOR_LABEL, playerDoc.MAJOR_CATEGORY_LABEL].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={tr('Delete this file')}
        message={`${tr('“{name}” will be removed from the lesson and deleted from this computer. This cannot be undone.').replace('{name}', confirmTarget?.DOCUMENT_LABEL || '')}`}
        confirmLabel={tr('Delete')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          const doc = confirmTarget
          setConfirmTarget(null)
          if (doc) handleDelete(doc.DOCUMENT_ID)
        }}
      />
    </div>
  )
}

export default Lessons
