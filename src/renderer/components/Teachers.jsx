import React, { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate as formatDateValue } from '../dateFormat'
import {
  UserPlus, Edit2, Trash2, Check, Calendar, Shield, GraduationCap,
  Image as ImageIcon, UserRound, KeyRound, X, RotateCcw, AlertCircle, Building2
} from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import PhotoZoom from './ui/PhotoZoom'
import Notice from './ui/Notice'
import { PageHeader } from './ui/PageHeader'
import FilterBar, { FilterField, FilterSearchField, filterInputCls } from './ui/FilterBar'
import Pagination from './ui/Pagination'
import { CardSkeletonGrid, CardEmptyMessage } from './ui/CardStates'
import Modal from './ui/Modal'
import Button from './ui/Button'
import LocalizedInput from './ui/LocalizedInput'
import ListError from './ui/ListError'
import UndoToast from './ui/UndoToast'
import { usePersistentState } from '../usePersistentState'
import { useBeforeUnload } from '../useUnsavedChanges'
import { formatLatinFirstName, formatLatinLastName } from '../../shared/personNames'
import { personIdError, personIdValue } from '../../shared/personId'
import { localizedLabel, tr } from '../i18n'
import { useIdentifierConflicts, conflictMessage } from '../studentIdentifiers'
import { ipcErrorMessage } from '../ipcError'

// The People page: every member of staff, not only the teachers.
//
// A person record is the identity (names, birthdate, sex, grades, photo); what
// somebody IS in the institution is their role. Roles live in two places in the
// database — person_has_role describes the person, while the role a sign-in
// account holds (user.role_id) decides what that login may reach — so the
// service returns both and the page shows them together. Every role can be
// recorded here as person_has_role rows, but this form never grants access: the
// role an account signs in with is set on the Accounts and Secretary accounts
// pages, where the login it belongs to is part of the picture.

const ROLE_LABELS = {
  TEACHER: 'Teacher',
  DIRECTOR: 'Director',
  SECRETARY: 'Secretary',
  ADMIN: 'Admin',
  SCHEDULER: 'Scheduler',
  DEVELOPER: 'Developer',
  STUDENT: 'Student'
}

const ROLE_ORDER = ['TEACHER', 'DIRECTOR', 'SECRETARY', 'SCHEDULER', 'ADMIN', 'DEVELOPER', 'STUDENT']

// The roles this form may set, with what each one means for the record. A staff
// role recorded here describes the person; it gives no account any permission.
const ROLE_CHOICES = ROLE_ORDER

const ROLE_HINTS = {
  TEACHER: 'Teachers can be given a schedule and appear in the attendance and observation pages.',
  DIRECTOR: 'Directors follow absences, observations and the oversight pages. This records who the person is; the role they sign in with is set on the Accounts page.',
  SECRETARY: 'Secretaries look after student records and the conduct ledger. This records who the person is; the role they sign in with is set on the Accounts page.',
  SCHEDULER: 'Schedulers build and maintain the timetable. This records who the person is; the role they sign in with is set on the Accounts page.',
  ADMIN: 'Administrators manage the application itself. This records who the person is; the role they sign in with is set on the Accounts page.',
  DEVELOPER: 'Developers maintain the installation and its releases. This records who the person is; the role they sign in with is set on the Accounts page.',
  STUDENT: 'Students are enrolled in the school and appear in Student Records and the cohort registers.'
}

const PERSON_COLUMNS = [
  'PERSON_ID',
  'PERSON_FIRST_NAME_LA', 'PERSON_FIRST_NAME_AR',
  'PERSON_LAST_NAME_LA', 'PERSON_LAST_NAME_AR',
  'PERSON_BIRTHDATE', 'PERSON_SEX',
  'MILITARY_GRADE_ID', 'ACADEMIC_GRADE_ID'
]

const EMPTY_PHOTO = { sourcePath: null, preview: null, remove: false, existing: false }

const emptyForm = () => ({
  // The id is typed in, so it is the field being edited; ORIGINAL_PERSON_ID
  // holds the one the record already had, and null means "not saved yet".
  PERSON_ID: '',
  ORIGINAL_PERSON_ID: null,
  PERSON_FIRST_NAME_LA: '',
  PERSON_FIRST_NAME_AR: '',
  PERSON_LAST_NAME_LA: '',
  PERSON_LAST_NAME_AR: '',
  PERSON_BIRTHDATE: '',
  PERSON_SEX: 'M',
  // The roles ticked in the form, and the ones the record already had, so only
  // the difference is written on save.
  PERSON_ROLES: [],
  ORIGINAL_ROLES: [],
  // The department belongs to the TEACHER role row (person_has_role), so it is
  // only offered while Teacher is ticked.
  PERSON_DEPARTMENT_ID: '',
  ORIGINAL_DEPARTMENT_ID: null,
  MILITARY_GRADE_ID: '',
  ACADEMIC_GRADE_ID: ''
})

// Format a DB date (JS Date or 'YYYY-MM-DD' string) for display.
const formatDate = (value) => {
  if (!value) return '—'
  if (value instanceof Date && !isNaN(value.getTime())) return formatDateValue(value)
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return formatDateValue(new Date(+m[1], +m[2] - 1, +m[3]))
  return String(value)
}

// Convert a DB date to the 'YYYY-MM-DD' string an <input type="date"> expects.
const toDateInput = (value) => {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const personRoles = (person) => {
  const set = new Set()
  for (const code of [...(person.PERSON_ROLE_CODES || []), ...(person.ACCOUNT_ROLE_CODES || [])]) {
    if (code) set.add(code)
  }
  return [...set].sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a)
    const ib = ROLE_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
}

const displayName = (person) =>
  [person.PERSON_FIRST_NAME, person.PERSON_LAST_NAME].filter(Boolean).join(' ')
  || `${tr('Person')} #${person.PERSON_ID}`

const People = ({ user }) => {
  const [people, setPeople] = useState([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [pendingUndo, setPendingUndo] = useState(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const formBaseline = useRef('')
  // The view survives a visit to a person's record and back.
  const [searchTerm, setSearchTerm] = usePersistentState('personnel:search', '')
  const [listFilters, setListFilters] = usePersistentState('personnel:filters', { role: '', sex: '', gradeId: '' })
  const [page, setPage] = usePersistentState('personnel:page', 1)
  // Six cards fill two rows of the three-column grid exactly, so a page never
  // ends on a ragged single card.
  const PAGE_SIZE = 6

  const [grades, setGrades] = useState([])
  const [academicGrades, setAcademicGrades] = useState([])
  // Administrative departments, each already under a direction. Only a person
  // holding the Teacher role can be assigned one.
  const [departments, setDepartments] = useState([])

  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [photo, setPhoto] = useState(EMPTY_PHOTO)
  const [photoError, setPhotoError] = useState('')
  const [idError, setIdError] = useState('')

  // person.person_id is unique across every person, staff included. The same
  // debounced check the student forms use answers under this field before Save.
  const personIdChanged = form.ORIGINAL_PERSON_ID === null
    || String(form.PERSON_ID).trim() !== String(form.ORIGINAL_PERSON_ID)
  const { conflicts: idConflicts, checking: idChecking } = useIdentifierConflicts({
    userId: user?.id,
    personId: form.ORIGINAL_PERSON_ID ?? null,
    values: { PERSON_ID: form.PERSON_ID },
    enabled: showModal && personIdChanged
  })
  const idConflict = conflictMessage(idConflicts, 'PERSON_ID', tr)

  // id -> data URL, read once per visible row and after a save.
  const [photoCache, setPhotoCache] = useState({})

  const [confirmTarget, setConfirmTarget] = useState(null)

  // A card whose account role is missing from the person record opens this
  // dialog: the person, the role being written and the last failure. Resolving
  // it only adds person_has_role rows, which the main process lets an Admin do,
  // so the action is offered to an Admin alone; everyone else keeps the note.
  const canSettleRoles = user?.roles?.includes('ADMIN')
  const [roleFix, setRoleFix] = useState(null)
  const [roleFixBusy, setRoleFixBusy] = useState('')
  const [roleFixError, setRoleFixError] = useState('')

  // A half-filled person record warns before the window closes, and the dialog
  // asks before discarding it.
  useBeforeUnload(showModal && !saving)
  useEffect(() => {
    if (showModal) formBaseline.current = JSON.stringify(form)
  }, [showModal])

  const loadPeople = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await window.api.getPersonnel()
      setPeople(result.data || [])
    } catch (err) {
      setLoadError(err.message || tr('Failed to load the personnel list'))
      setNotice({ type: 'error', text: `${tr('Failed to load the personnel list')}: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPeople()
    window.api.getGrades().then(res => setGrades(res.data || [])).catch(() => {})
    window.api.getAcademicGrades().then(res => setAcademicGrades(res.data || [])).catch(() => {})
    window.api.getDepartments().then(res => setDepartments(res.data || [])).catch(() => {})
  }, [])

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }))

  // The person roles are independent: ticking one never unticks another, so a
  // record can hold several at once.
  const toggleRole = (code) =>
    setForm(f => ({
      ...f,
      PERSON_ROLES: f.PERSON_ROLES.includes(code)
        ? f.PERSON_ROLES.filter(c => c !== code)
        : [...f.PERSON_ROLES, code]
    }))

  // ---- photos -------------------------------------------------------------

  const pathsFor = (rows) => rows.map(row => row.PERSON_PHOTO || null)

  const loadPhotos = async (rows) => {
    const wanted = rows.filter(row => row.PERSON_PHOTO && photoCache[Number(row.PERSON_ID)] === undefined)
    if (wanted.length === 0) return
    try {
      const res = await window.api.readPersonPhotos(pathsFor(wanted))
      const urls = res?.dataUrls || []
      setPhotoCache(prev => {
        const next = { ...prev }
        wanted.forEach((row, index) => { next[Number(row.PERSON_ID)] = urls[index] || null })
        return next
      })
    } catch {
      // A picture that cannot be read is not an error: the card keeps its initials.
    }
  }

  const pickPhoto = async () => {
    setPhotoError('')
    try {
      const picked = await window.api.choosePersonPhoto()
      if (!picked || picked.canceled || !picked.path) return
      setPhoto({ sourcePath: picked.path, preview: picked.dataUrl || null, remove: false, existing: photo.existing })
    } catch (err) {
      setPhotoError(err.message || tr('That photo could not be used.'))
    }
  }

  // Clearing here only marks the photo for removal; the file is deleted when the
  // form is saved, so cancelling the edit leaves the record untouched.
  const clearPhoto = () => {
    setPhotoError('')
    setPhoto({ sourcePath: null, preview: null, remove: true, existing: false })
  }

  // ---- list ---------------------------------------------------------------

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return people.filter(person => {
      if (term) {
        const haystack = [
          person.PERSON_FIRST_NAME,
          person.PERSON_LAST_NAME,
          person.PERSON_FIRST_NAME_AR,
          person.PERSON_LAST_NAME_AR,
          localizedLabel(person, 'DEPARTMENT_LABEL'),
          localizedLabel(person, 'DIRECTION_LABEL')
        ].filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(term)) return false
      }
      if (listFilters.sex && person.PERSON_SEX !== listFilters.sex) return false
      if (listFilters.gradeId && String(person.MILITARY_GRADE_ID || '') !== listFilters.gradeId) return false
      if (listFilters.role && !personRoles(person).includes(listFilters.role)) return false
      return true
    })
  }, [people, searchTerm, listFilters])

  const filterCount =
    (searchTerm ? 1 : 0) + (listFilters.sex ? 1 : 0) + (listFilters.gradeId ? 1 : 0) + (listFilters.role ? 1 : 0)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (!loading) loadPhotos(paged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, safePage, people, searchTerm, listFilters])

  // Every role actually in use, so the filter offers only what exists.
  const availableRoles = useMemo(() => {
    const set = new Set()
    for (const person of people) for (const code of personRoles(person)) set.add(code)
    return ROLE_ORDER.filter(code => set.has(code))
  }, [people])

  // ---- create / edit ------------------------------------------------------

  const openCreate = () => {
    setForm(emptyForm())
    setPhoto(EMPTY_PHOTO)
    setPhotoError('')
    setIdError('')
    setShowModal(true)
  }

  const openEdit = async (person) => {
    const next = emptyForm()
    for (const column of PERSON_COLUMNS) {
      if (person[column] !== undefined && person[column] !== null) next[column] = person[column]
    }
    next.PERSON_ID = String(person.PERSON_ID)
    next.ORIGINAL_PERSON_ID = Number(person.PERSON_ID)
    next.PERSON_BIRTHDATE = toDateInput(person.PERSON_BIRTHDATE)
    next.PERSON_ROLES = ROLE_CHOICES.filter(code => personRoles(person).includes(code))
    next.ORIGINAL_ROLES = [...next.PERSON_ROLES]
    next.PERSON_DEPARTMENT_ID = person.TEACHER_DEPARTMENT_ID || ''
    next.ORIGINAL_DEPARTMENT_ID = person.TEACHER_DEPARTMENT_ID || null
    // A student record kept its grade on person_grade_id only, so the one
    // Military Grade field opens on the value the card shows.
    next.MILITARY_GRADE_ID = person.MILITARY_GRADE_ID || person.PERSON_GRADE_ID || ''
    next.ACADEMIC_GRADE_ID = person.ACADEMIC_GRADE_ID || ''
    setForm(next)
    setPhoto({ ...EMPTY_PHOTO, preview: photoCache[Number(person.PERSON_ID)] || null, existing: !!person.PERSON_PHOTO })
    setPhotoError('')
    setIdError('')
    setShowModal(true)
    if (!photoCache[Number(person.PERSON_ID)] && person.PERSON_PHOTO) {
      try {
        const res = await window.api.readPersonPhoto(person.PERSON_PHOTO)
        if (res?.dataUrl) setPhoto(p => ({ ...p, preview: res.dataUrl }))
      } catch {
        // Leave the initials in place.
      }
    }
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setIdError('')
    setSaving(true)
    try {
      // The id is supplied by hand (11-person-id-manual.sql). A record that
      // predates the twelve-digit rule keeps its short id, so the value is only
      // checked when the record is new or when the id is being changed.
      const originalId = form.ORIGINAL_PERSON_ID
      const idChanged = originalId === null || String(form.PERSON_ID).trim() !== String(originalId)
      if (idChanged) {
        const problem = personIdError(form.PERSON_ID)
        if (problem) {
          setIdError(problem)
          return
        }
        if (idConflict) {
          setIdError(idConflict)
          return
        }
        if (idChecking) return
      }

      const payload = {
        ...Object.fromEntries(PERSON_COLUMNS.filter(c => c !== 'PERSON_ID').map(c => [c, form[c]])),
        PERSON_BIRTHDATE: form.PERSON_BIRTHDATE || null,
        MILITARY_GRADE_ID: form.MILITARY_GRADE_ID || null,
        ACADEMIC_GRADE_ID: form.ACADEMIC_GRADE_ID || null,
        // person.grade holds the same military grade for student records, and
        // the student pages read it, so the two columns are written together.
        PERSON_GRADE_ID: form.MILITARY_GRADE_ID || null
      }

      let personId = originalId
      if (personId === null) {
        const created = await window.api.createPerson({ ...payload, PERSON_ID: personIdValue(form.PERSON_ID) })
        personId = created?.PERSON_ID
      } else {
        await window.api.updatePerson(user?.id, personId, idChanged
          ? { ...payload, PERSON_ID: personIdValue(form.PERSON_ID) }
          : payload)
        if (idChanged) personId = personIdValue(form.PERSON_ID)
      }
      if (!personId) throw new Error(tr('The person could not be saved.'))

      // Roles are rows of their own, so each change is sent on its own and only
      // the difference: a role left as it was keeps its row, and the two roles
      // never overwrite each other.
      for (const code of ROLE_CHOICES) {
        const wanted = form.PERSON_ROLES.includes(code)
        const had = form.ORIGINAL_ROLES.includes(code)
        if (wanted === had) continue
        if (wanted) await window.api.assignPersonRole(user?.id, personId, code)
        else await window.api.endPersonRole(user?.id, personId, code)
      }

      // A department is part of the TEACHER role row, so it is written after
      // the role itself and only while that role is still held.
      const departmentChanged =
        String(form.PERSON_DEPARTMENT_ID || '') !== String(form.ORIGINAL_DEPARTMENT_ID || '')
      if (form.PERSON_ROLES.includes('TEACHER') && departmentChanged) {
        await window.api.setPersonDepartment(user?.id, personId, form.PERSON_DEPARTMENT_ID || null)
      }

      if (photo.sourcePath) {
        const res = await window.api.setPersonPhoto(user?.id, personId, photo.sourcePath)
        setPhotoCache(prev => ({ ...prev, [Number(personId)]: res?.dataUrl || photo.preview || null }))
      } else if (photo.remove) {
        await window.api.setPersonPhoto(user?.id, personId, null)
        setPhotoCache(prev => ({ ...prev, [Number(personId)]: null }))
      }

      setShowModal(false)
      setPhoto(EMPTY_PHOTO)
      await loadPeople()
      setNotice({ type: 'success', text: originalId !== null ? tr('Person updated.') : tr('Person added.') })
    } catch (err) {
      console.error('Failed to save the person', err)
      const message = ipcErrorMessage(err, tr('Failed to save the person'))
      // The live check normally catches this first; a concurrent save can still
      // race it. Keep the sentence at the field instead of the IPC wrapper.
      if (/already exists/i.test(message)) {
        const duplicate = tr('This person ID is already used by another person.')
        setIdError(duplicate)
        setNotice({ type: 'error', text: duplicate })
      } else {
        setNotice({ type: 'error', text: message })
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await window.api.deletePerson(user?.id, id)
      await loadPeople()
      setNotice({ type: 'success', text: tr('Person deleted.') })
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to delete the person') })
    }
  }

  // The account's role is a permission; the person record is the register.
  // Settling the flag writes the role the account already uses onto the person,
  // which changes no account and grants nothing — the other direction (the
  // login is the one that is wrong) stays on the Accounts page, where a role is
  // changed with the rest of the account.
  const settleRoleMismatch = async () => {
    if (!roleFix) return
    const missing = roleFix.ROLE_CONFLICT_ROLES || []
    if (missing.length === 0) {
      setRoleFix(null)
      return
    }
    setRoleFixError('')
    try {
      for (const code of missing) {
        setRoleFixBusy(code)
        await window.api.assignPersonRole(user?.id, roleFix.PERSON_ID, code)
      }
      setRoleFix(null)
      await loadPeople()
      setNotice({ type: 'success', text: tr('The role is now recorded on the person.') })
    } catch (err) {
      // Reload before showing the failure: a run that stopped halfway has
      // already written the roles before it, and the card should say so.
      await loadPeople()
      setRoleFixError(ipcErrorMessage(err, tr('Could not record the role.')))
    } finally {
      setRoleFixBusy('')
    }
  }

  const confirmName = confirmTarget ? displayName(confirmTarget) : ''

  // Clearing the view is reversible for a few seconds: the toast keeps the
  // previous search, filters and page, and puts them back on undo.
  const resetFilters = () => {
    setPendingUndo({ searchTerm, listFilters, page })
    setSearchTerm('')
    setListFilters({ role: '', sex: '', gradeId: '' })
    setPage(1)
  }

  const closeForm = () => {
    if (!saving && JSON.stringify(form) !== formBaseline.current) {
      setDiscardOpen(true)
      return
    }
    setShowModal(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Administration')}
        title={tr('Personnel')}
        meta={`${people.length} ${people.length === 1 ? tr('person') : tr('people')}`}
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold text-on-jade transition-[filter] hover:brightness-110"
          >
            <UserPlus size={12} /> {tr('Add person')}
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-muted px-3 py-2">
            <span className="kicker text-[9px]">{tr('Personnel')}</span>
            <div className="flex items-center gap-2">
              <span className="mono text-[10px] text-ink-3">{filtered.length} / {people.length}</span>
              <FilterBar
                activeCount={filterCount}
                onClear={resetFilters}
                matchCount={filtered.length}
                matchLabel="person"
                title={tr('Filter personnel')}
              >
                <FilterSearchField
                  placeholder={tr('Search by name...')}
                  value={searchTerm}
                  onChange={(v) => { setSearchTerm(v); setPage(1) }}
                />
                <FilterField label={tr('Role')}>
                  <select
                    className={filterInputCls}
                    value={listFilters.role}
                    onChange={e => { setListFilters(f => ({ ...f, role: e.target.value })); setPage(1) }}
                  >
                    <option value="">{tr('All')}</option>
                    {availableRoles.map(code => (
                      <option key={code} value={code}>{tr(ROLE_LABELS[code] || code)}</option>
                    ))}
                  </select>
                </FilterField>
                <FilterField label={tr('Sex')}>
                  <select
                    className={filterInputCls}
                    value={listFilters.sex}
                    onChange={e => { setListFilters(f => ({ ...f, sex: e.target.value })); setPage(1) }}
                  >
                    <option value="">{tr('All')}</option>
                    <option value="M">{tr('Male')}</option>
                    <option value="F">{tr('Female')}</option>
                  </select>
                </FilterField>
                <FilterField label={tr('Military Grade')}>
                  <select
                    className={filterInputCls}
                    value={listFilters.gradeId}
                    onChange={e => { setListFilters(f => ({ ...f, gradeId: e.target.value })); setPage(1) }}
                  >
                    <option value="">{tr('All')}</option>
                    {grades.map(g => (
                      <option key={g.MILITARY_GRADE_ID} value={g.MILITARY_GRADE_ID}>
                        {localizedLabel(g, 'MILITARY_GRADE_NAME') || g.MILITARY_GRADE_NAME_EN}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </FilterBar>
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line px-1.5 text-[10px] text-ink-3 hover:border-line-strong hover:text-ink"
              >
                <RotateCcw size={9} /> {tr('Reset view')}
              </button>
            </div>
          </div>
          {loadError ? (
            <ListError label={tr('Failed to load the personnel list')} detail={loadError} onRetry={loadPeople} />
          ) : loading ? (
            <div className="p-5">
              <CardSkeletonGrid loadingLabel={tr('Loading personnel...')} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <CardEmptyMessage
                label={filterCount > 0 ? tr('No one matches these filters') : tr('No personnel records yet')}
                hint={
                  filterCount > 0
                    ? tr('Clear the role, grade or search filters to see the whole register.')
                    : tr('Add the first person here, then give them a role in their record.')
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-px bg-line md:grid-cols-2 xl:grid-cols-3">
              {paged.map(person => {
                const roles = personRoles(person)
                const initials = `${person.PERSON_FIRST_NAME?.[0] || ''}${person.PERSON_LAST_NAME?.[0] || ''}`.toUpperCase()
                const picture = photoCache[Number(person.PERSON_ID)]
                // Student records keep the same grade on person_grade_id, so a
                // record that only has that column still shows its grade here.
                const militaryGradeId = person.MILITARY_GRADE_ID || person.PERSON_GRADE_ID
                const gradeRow = grades.find(g => Number(g.MILITARY_GRADE_ID) === Number(militaryGradeId))
                const militaryGrade = gradeRow
                  ? (localizedLabel(gradeRow, 'MILITARY_GRADE_NAME') || gradeRow.MILITARY_GRADE_NAME_EN || localizedLabel(gradeRow, 'MILITARY_GRADE_LABEL') || gradeRow.MILITARY_GRADE_LABEL_EN)
                  : null
                const academicRow = academicGrades.find(ag => Number(ag.ACADEMIC_GRADE_ID) === Number(person.ACADEMIC_GRADE_ID))
                const academicGrade = academicRow
                  ? (localizedLabel(academicRow, 'ACADEMIC_GRADE_LABEL') || academicRow.ACADEMIC_GRADE_LABEL)
                  : null
                const isTeacher = roles.includes('TEACHER')
                const department = person.TEACHER_DEPARTMENT_ID
                  ? localizedLabel(person, 'DEPARTMENT_LABEL')
                  : ''
                const direction = department ? localizedLabel(person, 'DIRECTION_LABEL') : ''

                return (
                  <article key={person.PERSON_ID} className="flex flex-col gap-3 bg-surface p-4 transition-colors hover:bg-surface-muted/40">
                    <div className="flex items-start gap-3">
                      <div
                        className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line-strong text-[16px] font-semibold"
                        style={{
                          background: picture ? 'var(--color-surface)' : (isTeacher ? 'var(--color-jade-50)' : 'var(--color-surface-muted)'),
                          color: isTeacher ? 'var(--color-jade-600)' : 'var(--color-ink-2)'
                        }}
                      >
                        {picture
                          ? <PhotoZoom src={picture} alt={displayName(person)} />
                          : (initials || <UserRound size={22} />)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-ink" title={displayName(person)}>
                          {displayName(person)}
                        </div>
                        <div className="mono mt-0.5 text-[10px] text-ink-3">#{person.PERSON_ID} · {person.PERSON_SEX === 'F' ? tr('Female') : tr('Male')}</div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {roles.length === 0 ? (
                            <span className="mono rounded-[3px] border border-dashed border-line-strong px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-ink-3">
                              {tr('No role')}
                            </span>
                          ) : roles.map(code => (
                            <span
                              key={code}
                              className="mono rounded-[3px] border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em]"
                              style={code === 'TEACHER'
                                ? { borderColor: 'color-mix(in srgb, var(--color-jade-500) 40%, transparent)', color: 'var(--color-jade-600)', background: 'var(--color-jade-50)' }
                                : { borderColor: 'var(--line-strong, var(--color-line))', color: 'var(--color-ink-2)' }}
                            >
                              {tr(ROLE_LABELS[code] || code)}
                            </span>
                          ))}
                          {person.HAS_ACCOUNT && (
                            <span className="mono inline-flex items-center gap-1 rounded-[3px] border border-line-strong px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-ink-3">
                              <KeyRound size={8} /> {tr('Account')}
                            </span>
                          )}
                          {person.ROLE_CONFLICT && (canSettleRoles ? (
                            <button
                              type="button"
                              onClick={() => { setRoleFixError(''); setRoleFix(person) }}
                              className="mono inline-flex items-center gap-1 rounded-[3px] border border-danger/35 bg-danger-bg px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-danger-ink transition-[filter] hover:brightness-110"
                              title={tr('The account holds a school role that the person record does not have. Add the role to the record, or change the account role on the Accounts page.')}
                            >
                              <AlertCircle size={8} /> {tr('Role mismatch')}
                            </button>
                          ) : (
                            <span
                              className="mono inline-flex items-center gap-1 rounded-[3px] border border-danger/35 bg-danger-bg px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-danger-ink"
                              title={tr('The account holds a school role that the person record does not have. Add the role to the record, or change the account role on the Accounts page.')}
                            >
                              <AlertCircle size={8} /> {tr('Role mismatch')}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-line pt-2.5 text-[10.5px] text-ink-2">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={10} className="shrink-0 text-ink-3" />
                        <dt className="sr-only">{tr('Birthdate')}</dt>
                        <dd className="truncate">{person.PERSON_BIRTHDATE ? formatDate(person.PERSON_BIRTHDATE) : tr('N/A')}</dd>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Shield size={10} className="shrink-0 text-ink-3" />
                        <dt className="sr-only">{tr('Military Grade')}</dt>
                        <dd className="truncate" title={militaryGrade}>{militaryGrade || tr('No military grade')}</dd>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <GraduationCap size={10} className="shrink-0 text-ink-3" />
                        <dt className="sr-only">{tr('Academic Grade')}</dt>
                        <dd className="truncate" title={academicGrade}>{academicGrade || tr('No academic grade')}</dd>
                      </div>
                      {department && (
                        <div className="col-span-2 flex items-center gap-1.5">
                          <Building2 size={10} className="shrink-0 text-ink-3" />
                          <dt className="sr-only">{tr('Department')}</dt>
                          <dd
                            className="truncate"
                            title={direction ? `${department} · ${direction}` : department}
                          >
                            {department}{direction ? ` · ${direction}` : ''}
                          </dd>
                        </div>
                      )}
                    </dl>

                    <div className="flex items-center justify-end gap-1 border-t border-line pt-2">
                      <button
                        type="button"
                        onClick={() => openEdit(person)}
                        className="inline-flex h-7 items-center gap-1 rounded-[3px] px-1.5 text-[10.5px] text-ink-3 transition-colors hover:bg-surface-muted hover:text-ink"
                        title={tr('Edit person')}
                        aria-label={`${tr('Edit person')}: ${displayName(person)}`}
                      >
                        <Edit2 size={11} aria-hidden="true" /> {tr('Edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmTarget(person)}
                        className="inline-flex h-7 items-center gap-1 rounded-[3px] px-1.5 text-[10.5px] text-ink-3 transition-colors hover:bg-surface-muted hover:text-danger-ink"
                        title={tr('Delete person')}
                        aria-label={`${tr('Delete person')}: ${displayName(person)}`}
                      >
                        <Trash2 size={11} aria-hidden="true" /> {tr('Delete')}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <Pagination page={safePage} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      </div>

      <Modal
        open={showModal}
        onClose={closeForm}
        title={form.ORIGINAL_PERSON_ID !== null ? tr('Edit person') : tr('Add person')}
        maxWidth="max-w-lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={closeForm}>{tr('Cancel')}</Button>
            <Button
              type="submit"
              form="person-form"
              loading={saving}
              disabled={idChecking || !!idConflict}
            >
              {!saving && <Check size={12} />} {tr('Save person')}
            </Button>
          </div>
        }
      >
        <form id="person-form" onSubmit={handleSave} className="space-y-3">
          {/* Photo: chosen here, stored with the rest of the record. */}
          <div className="flex items-center gap-3 rounded-[4px] border border-line bg-canvas p-2.5">
            <div
              className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-full border border-line-strong text-[15px] font-semibold text-ink-2"
              style={{ background: 'var(--color-surface-muted)' }}
            >
              {photo.preview
                ? <img src={photo.preview} alt={tr('Photo')} className="h-full w-full object-cover" />
                : `${form.PERSON_FIRST_NAME_LA?.[0] || ''}${form.PERSON_LAST_NAME_LA?.[0] || ''}`.toUpperCase() || <UserRound size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-medium text-ink">{tr('Photo')}</div>
              <p className="mt-0.5 text-[10.5px] leading-snug text-ink-3">
                {tr('PNG, JPG or WebP up to 4 MB. The file is copied into the application folder.')}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={pickPhoto}
                  className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-2 text-[10.5px] font-medium text-ink-2 hover:bg-surface-muted"
                >
                  <ImageIcon size={10} /> {photo.preview ? tr('Replace photo') : tr('Choose photo')}
                </button>
                {(photo.preview || photo.existing) && (
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="inline-flex h-6 items-center gap-1 rounded-[3px] border px-2 text-[10.5px] font-medium"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-danger) 35%, transparent)',
                      background: 'var(--color-danger-bg)',
                      color: 'var(--color-danger-ink)'
                    }}
                  >
                    <X size={10} /> {tr('Remove')}
                  </button>
                )}
              </div>
              {photoError && <p className="mt-1 text-[10.5px]" style={{ color: 'var(--color-danger-ink)' }}>{photoError}</p>}
            </div>
          </div>

          {/* person.person_id is typed in, not generated: twelve digits, the
              number the institution uses for the person on every form. */}
          <div>
            <label className="kicker mb-1 block text-[9px]" htmlFor="person-id">{tr('Person ID')}</label>
            <input
              id="person-id"
              type="text"
              inputMode="numeric"
              maxLength={12}
              className="field text-[12px]"
              placeholder={tr('12 digits')}
              value={form.PERSON_ID}
              aria-invalid={!!(idError || idConflict)}
              aria-describedby="person-id-help"
              onChange={e => { setField('PERSON_ID', e.target.value.replace(/\D/g, '').slice(0, 12)); setIdError('') }}
            />
            <p
              id="person-id-help"
              role={idError || idConflict ? 'alert' : undefined}
              className={`mt-1 text-[10px] leading-snug ${idError || idConflict ? '' : 'text-ink-3'}`}
              style={idError || idConflict ? { color: 'var(--color-danger-ink)' } : undefined}
            >
              {idError || idConflict || (idChecking
                ? tr('Checking availability…')
                : tr('Twelve digits. It can be corrected later, and the change follows the person everywhere.'))}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <LocalizedInput
              base="PERSON_FIRST_NAME"
              scheme="la"
              form={form}
              setForm={setForm}
              label={tr('First Name')}
              required
              inputClassName="field text-[12px]"
              formatValue={(_key, value) => formatLatinFirstName(value)}
            />
            <LocalizedInput
              base="PERSON_LAST_NAME"
              scheme="la"
              form={form}
              setForm={setForm}
              label={tr('Last Name')}
              required
              inputClassName="field text-[12px]"
              formatValue={(_key, value) => formatLatinLastName(value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Birthdate')}</label>
              <input
                type="date"
                className="field text-[12px]"
                value={form.PERSON_BIRTHDATE}
                onChange={e => setField('PERSON_BIRTHDATE', e.target.value)}
              />
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Sex')}</label>
              <select
                className="field text-[12px]"
                value={form.PERSON_SEX}
                onChange={e => setField('PERSON_SEX', e.target.value)}
              >
                <option value="M">{tr('Male')}</option>
                <option value="F">{tr('Female')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Military Grade')}</label>
              <select
                className="field text-[12px]"
                value={form.MILITARY_GRADE_ID || ''}
                onChange={e => setField('MILITARY_GRADE_ID', e.target.value ? parseInt(e.target.value, 10) : '')}
              >
                <option value="">{tr('None')}</option>
                {grades.map(grade => (
                  <option key={grade.MILITARY_GRADE_ID} value={grade.MILITARY_GRADE_ID}>
                    {localizedLabel(grade, 'MILITARY_GRADE_NAME') || grade.MILITARY_GRADE_NAME_EN || localizedLabel(grade, 'MILITARY_GRADE_LABEL') || grade.MILITARY_GRADE_LABEL_EN}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Academic Grade')}</label>
              <select
                className="field text-[12px]"
                value={form.ACADEMIC_GRADE_ID || ''}
                onChange={e => setField('ACADEMIC_GRADE_ID', e.target.value ? parseInt(e.target.value, 10) : '')}
              >
                <option value="">{tr('None')}</option>
                {academicGrades.map(grade => (
                  <option key={grade.ACADEMIC_GRADE_ID} value={grade.ACADEMIC_GRADE_ID}>
                    {grade.ACADEMIC_GRADE_LABEL}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <span className="kicker block text-[9px]">{tr('Roles')}</span>

            {ROLE_CHOICES.map(code => (
              <label
                key={code}
                className="flex items-start gap-2 rounded-[4px] border border-line bg-canvas px-2.5 py-2"
              >
                <input
                  type="checkbox"
                  checked={form.PERSON_ROLES.includes(code)}
                  onChange={() => toggleRole(code)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-jade-600)]"
                />
                <span>
                  <span className="block text-[11.5px] font-medium text-ink">{tr(ROLE_LABELS[code])}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3">
                    {tr(ROLE_HINTS[code])}
                  </span>
                </span>
              </label>
            ))}

            {form.PERSON_ROLES.includes('TEACHER') && (
              <div className="rounded-[4px] border border-line bg-canvas px-2.5 py-2">
                <label className="kicker mb-1 block text-[9px]" htmlFor="person-department">
                  {tr('Department')}
                </label>
                <select
                  id="person-department"
                  className="field h-8 w-full text-[12px]"
                  value={form.PERSON_DEPARTMENT_ID || ''}
                  onChange={e => setField('PERSON_DEPARTMENT_ID', e.target.value ? parseInt(e.target.value, 10) : '')}
                >
                  <option value="">{tr('No department')}</option>
                  {departments.map(dept => {
                    const direction = localizedLabel(dept, 'DIRECTION_LABEL')
                    return (
                      <option key={dept.DEPARTMENT_ID} value={dept.DEPARTMENT_ID}>
                        {localizedLabel(dept, 'DEPARTMENT_LABEL')}{direction ? ` — ${direction}` : ''}
                      </option>
                    )
                  })}
                </select>
                <p className="mt-1 text-[10px] leading-snug text-ink-3">
                  {tr('Only a person holding the Teacher role belongs to a department.')}
                </p>
              </div>
            )}

            <p className="text-[10.5px] text-ink-3">
              {tr('A person can hold several roles at once; each is kept on its own, so ticking one never clears another. What is ticked here describes the person and gives no sign-in account any permission — the role an account signs in with is set on the Accounts page.')}
            </p>
          </div>
        </form>
      </Modal>

      {/* The role a sign-in account uses is a permission; the roles on the
          person are the register. When the two disagree the card offers the
          register-side fix, which is the one that changes no access. */}
      <Modal
        open={!!roleFix}
        onClose={() => { if (!roleFixBusy) setRoleFix(null) }}
        title={tr('Role mismatch')}
        maxWidth="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setRoleFix(null)} disabled={!!roleFixBusy}>
              {tr('Cancel')}
            </Button>
            <Button type="button" onClick={settleRoleMismatch} loading={!!roleFixBusy}>
              {!roleFixBusy && <Check size={12} />} {tr('Add to the person record')}
            </Button>
          </div>
        }
      >
        {roleFix && (
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-ink-2">
              {tr('This sign-in account uses a role that the person record does not list.')}
            </p>

            <div className="rounded-[4px] border border-line bg-canvas px-2.5 py-2">
              <div className="kicker text-[9px]">{tr('Roles on the person')}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(roleFix.PERSON_ROLE_CODES || []).length === 0 ? (
                  <span className="mono rounded-[3px] border border-dashed border-line-strong px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-ink-3">
                    {tr('No role')}
                  </span>
                ) : (roleFix.PERSON_ROLE_CODES || []).map(code => (
                  <span
                    key={code}
                    className="mono rounded-[3px] border border-line-strong px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-ink-2"
                  >
                    {tr(ROLE_LABELS[code] || code)}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-[4px] border border-line bg-canvas px-2.5 py-2">
              <div className="kicker text-[9px]">{tr('Roles on the account')}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(roleFix.ACCOUNT_ROLE_CODES || []).map(code => {
                  const missing = (roleFix.ROLE_CONFLICT_ROLES || []).includes(code)
                  return (
                    <span
                      key={code}
                      className={`mono rounded-[3px] border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] ${missing
                        ? 'border-danger/35 bg-danger-bg text-danger-ink'
                        : 'border-line-strong text-ink-2'}`}
                    >
                      {tr(ROLE_LABELS[code] || code)}
                    </span>
                  )
                })}
              </div>
            </div>

            <p className="text-[10.5px] leading-snug text-ink-3">
              {tr('Recording the missing role on the person keeps the register truthful. If the login is the one that is wrong, change its role on the Accounts page instead.')}
            </p>

            {roleFixError && (
              <p role="alert" className="text-[11px]" style={{ color: 'var(--color-danger-ink)' }}>{roleFixError}</p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={tr('Delete person')}
        message={confirmTarget
          ? tr('Delete {name}? Their person record is removed, and any account they hold is deleted with it.', { name: confirmName })
          : ''}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => { const id = confirmTarget.PERSON_ID; setConfirmTarget(null); handleDelete(id) }}
      />

      <ConfirmDialog
        open={discardOpen}
        title={tr('Discard unsaved changes?')}
        message={tr('You have edits that have not been saved. Closing this form discards them.')}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => { setDiscardOpen(false); setShowModal(false) }}
      />

      <UndoToast
        message={pendingUndo ? tr('Filters cleared') : null}
        onUndo={() => {
          if (!pendingUndo) return
          setSearchTerm(pendingUndo.searchTerm)
          setListFilters(pendingUndo.listFilters)
          setPage(pendingUndo.page)
        }}
        onClose={() => setPendingUndo(null)}
      />
    </div>
  )
}

export default People
