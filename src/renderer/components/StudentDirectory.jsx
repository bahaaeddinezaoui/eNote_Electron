import React, { useState, useEffect, useMemo, useRef } from 'react'
import { formatDate as formatDateValue } from '../dateFormat'
import DataTable from './ui/DataTable'
import { usePersistentState } from '../usePersistentState'
import { useBeforeUnload } from '../useUnsavedChanges'
import ListError from './ui/ListError'
import UndoToast from './ui/UndoToast'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  UserPlus, Edit2, Trash2, X, Check, Layers, UserRound, HeartPulse,
  GraduationCap, Users, Phone, Plus, Calendar,
  CreditCard, Shield, HardHat, Info, Lock, Shirt, MapPin, ChevronRight,
  Search, MoreHorizontal, Download, FileDown, Copy, ClipboardList as ClipboardListIcon,
  Image as ImageIcon, Upload,
  RotateCcw, Sparkles,
} from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import PhotoZoom from './ui/PhotoZoom'
import Notice from './ui/Notice'
import Pagination from './ui/Pagination'
import SplitPane from './ui/SplitPane'
import MultiSelect from './ui/MultiSelect'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import ContextMenu from './ui/ContextMenu'
import { PageHeader, StateMark } from './ui/PageHeader'
import { activatableRowProps, sortColumnProps } from './ui/tableA11y'
import StudentReportDialog from './StudentReportDialog'
import { formatLatinFirstName, formatLatinLastName, personNameLastFirst } from '../../shared/personNames'
import { personIdError, personIdValue } from '../../shared/personId'
import { familyCountErrors, firstFamilyCountError } from '../../shared/studentDetailRules'
import { PARADE_UNIFORM_FIELDS, FEMALE_ONLY_UNIFORM_KEYS } from '../../shared/uniformSizes'
import UniformSizeSelect from './ui/UniformSizeSelect'
import { localizedLabel, tr } from '../i18n'

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

// Shared styling for the full-information registration form. The field
// classes defer to the global control styles so the form matches the rest of
// the registry instead of carrying its own palette.
const formInputCls = "field w-full text-[12.5px]"
const formLabelCls = "field-label"
const formCardCls = "border border-line bg-surface-muted/40 p-3"

import { useIdentifierConflicts, conflictMessage } from '../studentIdentifiers'
import { ipcErrorMessage } from '../ipcError'

// A duplicate identifier is refused under the field that holds it, before the
// user presses Save; the database constraint is the backstop.
// Label, control and error are one unit: the label points at the control, and
// an error is announced as the control's description instead of sitting next to
// it as unassociated text. Children that are not a native control (a radio
// group, a composed picker) keep their own labelling.
const Field = ({ label, children, error }) => {
  const id = React.useId()
  const errorId = `${id}-error`
  const isControl =
    React.isValidElement(children) &&
    (children.type === 'input' || children.type === 'select' || children.type === 'textarea')
  const controlId = isControl ? children.props.id || id : undefined
  const control = isControl
    ? React.cloneElement(children, {
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : children.props['aria-describedby']
      })
    : children

  return (
    <div>
      <label htmlFor={controlId} className={formLabelCls}>{label}</label>
      {control}
      {error ? (
        <p id={errorId} className="mt-1 text-[10.5px] leading-snug" style={{ color: 'var(--color-danger-ink)' }}>{error}</p>
      ) : null}
    </div>
  )
}

// The student's photo. The picker runs in the main process and returns a
// preview data URL; the chosen file is copied into the app's own folder when
// the record is saved, so the stored path never points into Downloads.
const EMPTY_PHOTO = { sourcePath: null, preview: null, name: '', existing: false, remove: false }

const PhotoField = ({ photo, onChoose, onClear }) => (
  <div className="flex flex-wrap items-center gap-3 border border-line bg-surface-muted/40 p-3">
    <div className="grid h-[112px] w-[112px] shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line-strong bg-surface">
      {photo.preview
        ? <img src={photo.preview} alt="" className="h-full w-full object-cover" />
        : <ImageIcon size={20} strokeWidth={1.6} className="text-ink-3" />}
    </div>
    <div className="min-w-0 flex-1">
      <p className={formLabelCls}>{tr('Student photo')}</p>
      <p className="mt-0.5 truncate text-[10.5px] text-ink-3">
        {photo.preview
          ? (photo.name || tr('Saved photo'))
          : tr('PNG, JPG or WebP · up to 4 MB')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onChoose}
          className="inline-flex h-7 items-center gap-1.5 rounded-[3px] border border-line-strong bg-surface px-2 text-[11px] font-medium text-ink hover:bg-surface-muted"
        >
          <Upload size={11} /> {photo.preview ? tr('Replace photo') : tr('Choose photo')}
        </button>
        {photo.preview && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-7 items-center gap-1.5 rounded-[3px] border border-danger/40 px-2 text-[11px] font-medium text-danger-ink hover:bg-danger-bg"
          >
            <X size={11} /> {tr('Remove')}
          </button>
        )}
      </div>
    </div>
  </div>
)

// Sort field options for the directory toolbar (cards have no column headers).
const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'id', label: 'ID' },
  { value: 'birthdate', label: 'Birthdate' },
  { value: 'sex', label: 'Sex' },
  { value: 'category', label: 'Category' },
  { value: 'section', label: 'Section' }
]

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const YES_NO = ['Yes', 'No']
const ORPHAN = ['None', 'Father', 'Mother', 'Both']
const PARENTS_SIT = ['Married', 'Divorced', 'Separated', 'Widowed']

const CREATE_TABS = [
  { id: 'identity', label: 'Identity', icon: UserRound },
  { id: 'health', label: 'Health & Body', icon: HeartPulse },
  { id: 'schooling', label: 'Schooling', icon: GraduationCap },
  { id: 'family', label: 'Family', icon: Users },
  { id: 'hobbies', label: 'Hobbies', icon: Sparkles },
  { id: 'contacts', label: 'Emergency Contacts', icon: Phone },
  { id: 'uniforms', label: 'Uniforms & Address', icon: Shirt },
  { id: 'enrollment', label: 'Section', icon: Layers }
]

// Blank state for every field the registration form collects.
const emptyStudentForm = () => ({
  identity: { personId: '', firstName: '', firstNameAr: '', lastName: '', lastNameAr: '', birthdate: '', sex: 'M', gradeId: '' },
  detail: {
    STUDENT_PERSONAL_PHONE: '', STUDENT_IS_FOREIGN: false, STUDENT_BLOOD_TYPE: '',
    STUDENT_HEALTH_STATUS_ID: '', STUDENT_HEIGHT_CM: '', STUDENT_WEIGHT_KG: '',
    STUDENT_MILITARY_NECKLACE: 'No', STUDENT_ARMY_ID: '',
    STUDENT_NATIONAL_IDENTIFICATION_NUMBER: '', STUDENT_BIRTHDATE_CERTIFICATE_NUMBER: '',
    STUDENT_POSTAL_ACCOUNT_NUMBER: '', STUDENT_LAPTOP_SERIAL_NUMBER: '',
    STUDENT_INSURANCE_CARD_NUMBER: '', STUDENT_MILITARY_CARD_NUMBER: '',
    STUDENT_MILITARY_HELMET_NUMBER: '',
    STUDENT_BACCALAUREATE_SUB_NUMBER: '', STUDENT_SCHOOL_SUB_DATE: '',
    STUDENT_SCHOOL_SUB_CARD_NUMBER: '', EDUCATIONAL_CERTIFICATE_ID: '',
    STUDENT_ACADEMIC_LEVEL_ID: '', STUDENT_SPECIALITY_ID: '', STUDENT_ACADEMIC_AVERAGE: '',
    STUDENT_RECRUITMENT_SOURCE_ID: '',
    STUDENT_NUMBER_OF_SIBLINGS: '', STUDENT_NUMBER_OF_SISTERS: '',
    STUDENT_ORDER_AMONG_SIBLINGS: '', STUDENT_ORPHAN_STATUS: 'None',
    STUDENT_PARENTS_SITUATION: 'Married'
  },
  parents: {
    FATHER_FIRST_NAME_LA: '', FATHER_LAST_NAME_LA: '', FATHER_FIRST_NAME_AR: '',
    FATHER_LAST_NAME_AR: '', FATHER_PROFESSION_ID: '', MOTHER_FIRST_NAME_LA: '',
    MOTHER_LAST_NAME_LA: '', MOTHER_FIRST_NAME_AR: '', MOTHER_LAST_NAME_AR: '',
    MOTHER_PROFESSION_ID: ''
  }
})

// How complete a student's file is. The server counts the checklist items; here
// they only become what the register shows. A row without a total (an older
// roster, or a count the query could not make) has no figure at all, rather
// than a false 0%.
const studentCompletion = (student) => {
  const total = Number(student.INFO_TOTAL ?? student.info_total ?? 0)
  const filled = Number(student.INFO_FILLED ?? student.info_filled ?? 0)
  if (!total) return null
  return { filled, total, missing: total - filled, percent: Math.round((filled / total) * 100) }
}

// Student Directory: student list, registration (full info), edit, delete,
// and section assignment. Formerly the standalone "Students" page; now hosted
// inside the Student Records page.
const StudentDirectory = ({ user, onOpenRecord }) => {
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [pendingUndo, setPendingUndo] = useState(null)
  // Table tooling (search, sort, filters, page) survives navigation: opening a
  // student and coming back returns to the same view.
  const [searchTerm, setSearchTerm] = usePersistentState('directory:search', '')
  const [sortKey, setSortKey] = usePersistentState('directory:sortKey', 'name')
  const [sortDir, setSortDir] = usePersistentState('directory:sortDir', 'asc')
  const [categoryFilter, setCategoryFilter] = usePersistentState('directory:category', '')
  const [sectionFilter, setSectionFilter] = usePersistentState('directory:section', '')
  // Secretary-only: show only the students whose file is complete/incomplete.
  const [infoFilter, setInfoFilter] = usePersistentState('directory:info', '')
  const [page, setPage] = usePersistentState('directory:page', 1)
  const PAGE_SIZE = 25
  const [showModal, setShowModal] = useState(false)
  // A registration form in progress warns before the window closes; closing
  // the form itself is still an explicit choice made in the dialog.
  useBeforeUnload(showModal)
  const [saveError, setSaveError] = useState('')
  const [showSectionModal, setShowSectionModal] = useState(false)
  // Unassigning a section is immediate and leaves the student outside every
  // section list, so it is asked for before it runs.
  const [confirmRemoveSection, setConfirmRemoveSection] = useState(false)
  const [sections, setSections] = useState([])
  const [teachingCategories, setTeachingCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [studentSections, setStudentSections] = useState([])
  const [studentGroups, setStudentGroups] = useState([])
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [currentStudent, setCurrentStudent] = useState({ PERSON_ID: null })

  // Registration-form state: the full student information.
  const [createTab, setCreateTab] = useState('identity')
  const [lookups, setLookups] = useState(null)
  // The sizes an administrator defined per uniform item (Settings → Registers
  // → Uniform sizes), grouped by kind for the Uniforms tab.
  const [uniformSizeOptions, setUniformSizeOptions] = useState({})
  const [grades, setGrades] = useState([])
  const [identity, setIdentity] = useState({ personId: '', firstName: '', firstNameAr: '', lastName: '', lastNameAr: '', birthdate: '', sex: 'M', gradeId: '' })
  const [photo, setPhoto] = useState(EMPTY_PHOTO)
  const [detail, setDetail] = useState({})
  const [parents, setParents] = useState({})
  const [contacts, setContacts] = useState([])
  // Every section this student has belonged to, newest first (open row = now).
  const [sectionHistory, setSectionHistory] = useState([])
  const [newContact, setNewContact] = useState({
    CONTACT_FIRST_NAME_LA: '', CONTACT_LAST_NAME_LA: '', CONTACT_RELATION_ID: '',
    CONTACT_PHONE_NUMBER: '', CONSULATE_NUMBER: ''
  })
  const [hobbySel, setHobbySel] = useState([])
  const [geoSel, setGeoSel] = useState({ wilayaId: '', dairaId: '', communeId: '' })
  const [wilayas, setWilayas] = useState([])
  const [dairas, setDairas] = useState([])
  const [communes, setCommunes] = useState([])
  const [selectedSectionId, setSelectedSectionId] = useState('')
  // Uniforms + personal address — the blocks the Student Records editor shows
  // on its Uniforms/Identity tabs; editable here too (edit mode only).
  const emptyUniforms = () => ({
    combat: { FIRST_OUTFIT_NUMBER: '', FIRST_OUTFIT_SIZE: '', SECOND_OUTFIT_NUMBER: '', SECOND_OUTFIT_SIZE: '', COMBAT_SHOE_SIZE: '' },
    parade: {
      SUMMER_JACKET_SIZE: '', WINTER_JACKET_SIZE: '', SUMMER_TROUSERS_SIZE: '', WINTER_TROUSERS_SIZE: '',
      SUMMER_SHIRT_SIZE: '', WINTER_SHIRT_SIZE: '', SUMMER_HAT_SIZE: '', WINTER_HAT_SIZE: '',
      SUMMER_SKIRT_SIZE: '', WINTER_SKIRT_SIZE: ''
    },
    addr: { ADDRESS_STREET_LA: '', ADDRESS_STREET_AR: '' }
  })
  const [combat, setCombat] = useState(emptyUniforms().combat)
  const [parade, setParade] = useState(emptyUniforms().parade)
  const [addr, setAddr] = useState(emptyUniforms().addr)
  // Personal-address commune cascade (independent of the birth-place one).
  const [addrSel, setAddrSel] = useState({ wilayaId: '', dairaId: '', communeId: '' })
  const [addrDairas, setAddrDairas] = useState([])
  const [addrCommunes, setAddrCommunes] = useState([])
  // Whether the record already had a row, so saving empty clears it.
  const [hadCombat, setHadCombat] = useState(false)
  const [hadParade, setHadParade] = useState(false)
  const [hadAddress, setHadAddress] = useState(false)
  // Which teaching categories this account may work in (empty scope = all).
  const [scope, setScope] = useState({ restricted: false, categoryIds: [], categories: [] })
  // Edit mode of the student form: loading the full record, plus what the save
  // has to apply on top of it (deleted contacts, parents row).
  const [editLoading, setEditLoading] = useState(false)
  const [editPersonId, setEditPersonId] = useState(null)
  const [discardFormOpen, setDiscardFormOpen] = useState(false)
  const [formBaseline, setFormBaseline] = useState('')
  // Take the baseline once the form holds its initial data: immediately for a
  // new student, after the record loads for an existing one.
  useEffect(() => {
    if (showModal && !editLoading) setFormBaseline(studentFormSignature())
  }, [showModal, editLoading])

  // Live uniqueness check: a number already recorded for another student is
  // refused under its field, before the form is submitted.
  const { conflicts, checking, hasConflicts } = useIdentifierConflicts({
    userId: user?.id,
    personId: editPersonId || null,
    // person_id is checked too: it is unique across every person, and a
    // duplicate must be answered under the field before Save.
    values: { ...detail, ...combat, PERSON_ID: identity.personId },
    enabled: showModal && !!user?.id
  })
  const [hadParents, setHadParents] = useState(false)
  const [deletedContactIds, setDeletedContactIds] = useState([])

  const isAdmin = user?.roles?.includes('ADMIN')
  const isDirector = user?.roles?.includes('DIRECTOR')
  // Secretaries manage students too; other roles get read-only access.
  const canManage = isAdmin || user?.roles?.includes('SECRETARY')
  // Chasing incomplete files is the secretary's work, so the completion column
  // and its filter are theirs alone.
  const tracksCompletion = !!user?.roles?.includes('SECRETARY')
  // The two oversight roles may replace a photo from the record summary, without
  // opening the full edit form.

  // Teaching-category scope: a secretary only works inside the categories an
  // admin made them responsible for. The server re-checks this on every write;
  // here we only stop offering sections and students they cannot use.
  const inScopeCategory = (categoryId) =>
    !scope.restricted || scope.categoryIds.includes(Number(categoryId))
  const allowedCategories = scope.restricted
    ? teachingCategories.filter(c => inScopeCategory(c.TEACHING_CATEGORY_ID))
    : teachingCategories
  const allowedSections = scope.restricted
    ? sections.filter(s => inScopeCategory(s.TEACHING_CATEGORY_ID))
    : sections
  const noScopeAtAll = scope.restricted && scope.categoryIds.length === 0

  useEffect(() => {
    window.api.getMyTeachingScope(user?.id)
      .then(res => setScope({
        restricted: !!res?.restricted,
        categoryIds: res?.categoryIds || [],
        categories: res?.categories || []
      }))
      .catch(err => console.error('Failed to load teaching scope', err))
    loadStudents()
    if (canManage) {
      loadSections()
      loadTeachingCategories()
      loadCreateLookups()
      window.api.getGrades()
        .then(res => setGrades(res.data || []))
        .catch(err => console.error('Failed to load grades', err))
    }
  }, [canManage])

  const loadStudents = async () => {
    setLoading(true)
    setLoadError('')
    try {
      // Single batched query (students + their current section) instead of
      // one IPC round-trip per student.
      const result = await window.api.getStudentsWithSections(user?.id)
      const studentsData = (result.data || []).map(s => ({
        ...s,
        sectionData: s.SECTION_ID ? {
          SECTION_ID: s.SECTION_ID,
          SECTION_LABEL: s.SECTION_LABEL,
          SECTION_CODE: s.SECTION_CODE,
          TEACHING_CATEGORY_ID: s.TEACHING_CATEGORY_ID,
          TEACHING_CATEGORY_LABEL: s.TEACHING_CATEGORY_LABEL
        } : null
      }))
      setStudents(studentsData)
    } catch (err) {
      console.error('Failed to load students', err)
      setLoadError(err.message || '')
    } finally {
      setLoading(false)
    }
  }

  // Everything that narrows the roster, undone together.
  const resetView = () => {
    setPendingUndo({ searchTerm, sortKey, sortDir, categoryFilter, sectionFilter, infoFilter, page })
    setSearchTerm('')
    setSortKey('name')
    setSortDir('asc')
    setCategoryFilter('')
    setSectionFilter('')
    setInfoFilter('')
    setPage(1)
  }

  const loadSections = async () => {
    try {
      const result = await window.api.getSections()
      setSections(result.data || [])
    } catch (err) {
      console.error('Failed to load sections', err)
    }
  }

  const loadTeachingCategories = async () => {
    try {
      const result = await window.api.getTeachingCategories()
      setTeachingCategories(result.data || [])
    } catch (err) {
      console.error('Failed to load teaching categories', err)
    }
  }

  // Lookup lists for the full-information registration form.
  const loadCreateLookups = async () => {
    try {
      const result = await window.api.getProfileLookups()
      setLookups(result)
    } catch (err) {
      console.error('Failed to load profile lookups', err)
    }
    try {
      const res = await window.api.getProfileWilayas()
      setWilayas(res?.data || [])
    } catch (err) {
      console.error('Failed to load wilayas', err)
    }
    try {
      const res = await window.api.getUniformSizeOptions()
      const grouped = {}
      for (const row of res?.data || []) {
        const kind = row.UNIFORM_SIZE_KIND || row.uniform_size_kind
        if (!kind) continue
        if (!grouped[kind]) grouped[kind] = []
        grouped[kind].push(row)
      }
      setUniformSizeOptions(grouped)
    } catch (err) {
      console.error('Failed to load uniform sizes', err)
    }
  }

  const onWilayaChange = async (wilayaId) => {
    setGeoSel(g => ({ ...g, wilayaId, dairaId: '', communeId: '' }))
    setCommunes([])
    if (wilayaId) {
      const res = await window.api.getProfileDairas(parseInt(wilayaId, 10))
      setDairas(res?.data || [])
    } else {
      setDairas([])
    }
  }

  const onDairaChange = async (dairaId) => {
    setGeoSel(g => ({ ...g, dairaId, communeId: '' }))
    if (dairaId) {
      const res = await window.api.getProfileCommunes(parseInt(dairaId, 10))
      setCommunes(res?.data || [])
    } else {
      setCommunes([])
    }
  }

  // Personal-address cascade: same lookup endpoints, separate state so it does
  // not collide with the birth-place selects.
  const onAddrWilayaChange = async (wilayaId) => {
    setAddrSel(s => ({ ...s, wilayaId, dairaId: '', communeId: '' }))
    setAddrCommunes([])
    if (wilayaId) {
      const res = await window.api.getProfileDairas(parseInt(wilayaId, 10))
      setAddrDairas(res?.data || [])
    } else {
      setAddrDairas([])
    }
  }

  const onAddrDairaChange = async (dairaId) => {
    setAddrSel(s => ({ ...s, dairaId, communeId: '' }))
    if (dairaId) {
      const res = await window.api.getProfileCommunes(parseInt(dairaId, 10))
      setAddrCommunes(res?.data || [])
    } else {
      setAddrCommunes([])
    }
  }

  const loadStudentSections = async (personId) => {
    try {
      const result = await window.api.getStudentSections(user?.id, personId)
      setStudentSections(result.data || [])
    } catch (err) {
      console.error('Failed to load student sections', err)
    }
  }

  // Read-only: the teaching groups a student belongs to (per-major memberships).
  const loadStudentGroups = async (personId) => {
    try {
      const result = await window.api.getTeachingGroupsForStudent(user?.id, personId)
      setStudentGroups(result?.data || [])
    } catch (err) {
      console.error('Failed to load student teaching groups', err)
      setStudentGroups([])
    }
  }

  const handleOpenSectionModal = async (student) => {
    setSelectedStudent(student)
    setStudentGroups([])
    await loadStudentSections(student.PERSON_ID)
    await loadStudentGroups(student.PERSON_ID)
    // Set the selected category based on the student's current section
    if (studentSections.length > 0) {
      setSelectedCategory(studentSections[0].TEACHING_CATEGORY_ID)
    } else {
      setSelectedCategory(null)
    }
    setShowSectionModal(true)
  }

  const handleSectionSelect = async (sectionId) => {
    // Optimistic UI update - set only the selected section
    const section = sections.find(s => s.SECTION_ID === sectionId)
    if (section) {
      setStudentSections([section])
    }
    
    try {
      // Update to only this section (replace all existing)
      await window.api.updateStudentSections(user?.id, selectedStudent.PERSON_ID, [sectionId])
    } catch (err) {
      console.error('Failed to update student section', err)
      setNotice({ type: 'error', text: tr('Failed to update the student section: ') + (err.message || '') })
      // Revert on error
      await loadStudentSections(selectedStudent.PERSON_ID)
    }
  }

  const handleRemoveSection = async () => {
    // Optimistic UI update
    setStudentSections([])
    
    try {
      await window.api.updateStudentSections(user?.id, selectedStudent.PERSON_ID, [])
    } catch (err) {
      console.error('Failed to remove student section', err)
      setNotice({ type: 'error', text: tr('Failed to remove the student section: ') + (err.message || '') })
      // Revert on error
      await loadStudentSections(selectedStudent.PERSON_ID)
    }
  }

  // What the form currently holds, for deciding whether closing it would lose
  // work. The baseline is taken once the form is ready: immediately for a new
  // student, after the record has loaded for an existing one.
  const studentFormSignature = () => JSON.stringify({
    identity, detail, parents, contacts, hobbySel, geoSel,
    selectedSectionId, combat, parade, addr, addrSel,
    photo: photo.preview || photo.existing || ''
  })

  const requestCloseForm = () => {
    if (!editLoading && studentFormSignature() !== formBaseline) {
      setDiscardFormOpen(true)
      return
    }
    setShowModal(false)
  }

  const openCreateModal = () => {
    const blank = emptyStudentForm()
    setIdentity(blank.identity)
    setPhoto(EMPTY_PHOTO)
    setDetail(blank.detail)
    setParents(blank.parents)
    setContacts([])
    setNewContact({ CONTACT_FIRST_NAME_LA: '', CONTACT_LAST_NAME_LA: '', CONTACT_RELATION_ID: '', CONTACT_PHONE_NUMBER: '', CONSULATE_NUMBER: '' })
    setHobbySel([])
    setGeoSel({ wilayaId: '', dairaId: '', communeId: '' })
    setDairas([])
    setCommunes([])
    const blankUniforms = emptyUniforms()
    setCombat(blankUniforms.combat)
    setParade(blankUniforms.parade)
    setAddr(blankUniforms.addr)
    setAddrSel({ wilayaId: '', dairaId: '', communeId: '' })
    setAddrDairas([])
    setAddrCommunes([])
    setHadCombat(false)
    setHadParade(false)
    setHadAddress(false)
    setSelectedSectionId('')
    setSectionHistory([])
    setCreateTab('identity')
    setCurrentStudent({ PERSON_ID: null })
    // A previous edit must not exclude its person from this new registration's
    // uniqueness check.
    setEditPersonId(null)
    setShowModal(true)
  }

  // Opens the FULL student form for an existing student: every detail the
  // Student Records editor shows (identity, birth place, health, schooling,
  // family, hobbies, contacts) is loaded here and written back on save.
  const openEditModal = async (student) => {
    const personId = student.PERSON_ID || student.person_id
    setCurrentStudent({
      ...student,
      PERSON_BIRTHDATE: toDateInput(student.PERSON_BIRTHDATE || student.person_birthdate)
    })
    setEditLoading(true)
    setSaveError('')
    setShowModal(true)
    setCreateTab('identity')
    setDeletedContactIds([])
    setHadParents(false)
    // The Section tab edits the card's section (and therefore its category);
    // start from the section the student is in right now.
    setSelectedSectionId(student.sectionData?.SECTION_ID ? String(student.sectionData.SECTION_ID) : '')
    try {
      const [prof, history] = await Promise.all([
        window.api.getStudentProfile(user?.id, personId),
        window.api.getStudentSectionHistory(user?.id, personId)
      ])
      setSectionHistory(history?.data || [])
      const d = prof?.detail || null
      // Date columns come back as Date objects; <input type="date"> wants strings.
      const formDetail = d ? {
        ...d,
        STUDENT_BIRTH_DATE: toDateInput(d.STUDENT_BIRTH_DATE),
        STUDENT_SCHOOL_SUB_DATE: toDateInput(d.STUDENT_SCHOOL_SUB_DATE)
      } : {}
      setDetail(formDetail)
      setEditPersonId(d?.PERSON_ID || personId)
      setIdentity({
        // The stored id, which this form may also correct.
        personId: String(student.PERSON_ID || personId || ''),
        firstName: student.PERSON_FIRST_NAME_LA || student.PERSON_FIRST_NAME || student.person_first_name_la || student.person_first_name || '',
        firstNameAr: student.PERSON_FIRST_NAME_AR || student.person_first_name_ar || '',
        lastName: student.PERSON_LAST_NAME_LA || student.PERSON_LAST_NAME || student.person_last_name_la || student.person_last_name || '',
        lastNameAr: student.PERSON_LAST_NAME_AR || student.person_last_name_ar || '',
        birthdate: toDateInput(student.PERSON_BIRTHDATE || student.person_birthdate),
        sex: student.PERSON_SEX || student.person_sex || 'M',
        gradeId: student.PERSON_GRADE_ID || ''
      })
      // The stored photo is a path, so the preview is read from the file by the
      // main process; a missing file just leaves the field empty.
      setPhoto(EMPTY_PHOTO)
      const storedPhoto = prof?.detail?.PERSON_PHOTO || null
      if (storedPhoto) {
        try {
          const stored = await window.api.readPersonPhoto(storedPhoto)
          if (stored?.dataUrl) setPhoto({ ...EMPTY_PHOTO, preview: stored.dataUrl, existing: true })
        } catch (err) {
          console.warn('Could not read the stored student photo', err)
        }
      }
      const parentRow = prof?.parents || null
      setParents(parentRow || {})
      setHadParents(!!parentRow)
      setContacts(prof?.emergencyContacts || [])
      setHobbySel((prof?.hobbies || []).map(h => h.HOBBY_ID))

      // Uniforms + personal address, same shapes the Records editor restores.
      const co = prof?.combatOutfit || null
      const pu = prof?.paradeUniform || null
      const blankUniforms = emptyUniforms()
      setCombat(co ? {
        FIRST_OUTFIT_NUMBER: co.FIRST_OUTFIT_NUMBER || '',
        FIRST_OUTFIT_SIZE: co.FIRST_OUTFIT_SIZE || '',
        SECOND_OUTFIT_NUMBER: co.SECOND_OUTFIT_NUMBER || '',
        SECOND_OUTFIT_SIZE: co.SECOND_OUTFIT_SIZE || '',
        COMBAT_SHOE_SIZE: co.COMBAT_SHOE_SIZE || ''
      } : blankUniforms.combat)
      setParade(pu ? {
        SUMMER_JACKET_SIZE: pu.SUMMER_JACKET_SIZE || '',
        WINTER_JACKET_SIZE: pu.WINTER_JACKET_SIZE || '',
        SUMMER_TROUSERS_SIZE: pu.SUMMER_TROUSERS_SIZE || '',
        WINTER_TROUSERS_SIZE: pu.WINTER_TROUSERS_SIZE || '',
        SUMMER_SHIRT_SIZE: pu.SUMMER_SHIRT_SIZE || '',
        WINTER_SHIRT_SIZE: pu.WINTER_SHIRT_SIZE || '',
        SUMMER_HAT_SIZE: pu.SUMMER_HAT_SIZE || '',
        WINTER_HAT_SIZE: pu.WINTER_HAT_SIZE || '',
        SUMMER_SKIRT_SIZE: pu.SUMMER_SKIRT_SIZE || '',
        WINTER_SKIRT_SIZE: pu.WINTER_SKIRT_SIZE || ''
      } : blankUniforms.parade)
      setHadCombat(!!co)
      setHadParade(!!pu)

      // Personal address (street + commune cascade); foreign students have none.
      const pa = prof?.personalAddress || null
      setAddr(pa ? {
        ADDRESS_STREET_LA: pa.ADDRESS_STREET_LA || '',
        ADDRESS_STREET_AR: pa.ADDRESS_STREET_AR || ''
      } : blankUniforms.addr)
      setHadAddress(!!pa)
      if (pa?.WILAYA_ID) {
        setAddrSel({
          wilayaId: pa.WILAYA_ID,
          dairaId: pa.DAIRA_ID || '',
          communeId: pa.COMMUNE_ID || ''
        })
        const [addrDairasRes, addrCommunesRes] = await Promise.all([
          window.api.getProfileDairas(pa.WILAYA_ID),
          pa.DAIRA_ID ? window.api.getProfileCommunes(pa.DAIRA_ID) : Promise.resolve({ data: [] })
        ])
        setAddrDairas(addrDairasRes?.data || [])
        setAddrCommunes(addrCommunesRes?.data || [])
      } else {
        setAddrSel({ wilayaId: '', dairaId: '', communeId: '' })
        setAddrDairas([])
        setAddrCommunes([])
      }

      // Birth place: the three selects need the whole wilaya -> daira -> commune path.
      const bp = prof?.birthPlace
      if (bp?.WILAYA_ID) {
        setGeoSel({
          wilayaId: bp.WILAYA_ID,
          dairaId: bp.DAIRA_ID || '',
          communeId: d?.STUDENT_BIRTH_PLACE_ID || bp.COMMUNE_ID || ''
        })
        const [dairasRes, communesRes] = await Promise.all([
          window.api.getProfileDairas(bp.WILAYA_ID),
          bp.DAIRA_ID ? window.api.getProfileCommunes(bp.DAIRA_ID) : Promise.resolve({ data: [] })
        ])
        setDairas(dairasRes?.data || [])
        setCommunes(communesRes?.data || [])
      } else {
        setGeoSel({ wilayaId: '', dairaId: '', communeId: '' })
        setDairas([])
        setCommunes([])
      }
    } catch (err) {
      console.error('Failed to load student for editing', err)
      setSaveError('Could not load this student: ' + (err.message || ''))
    } finally {
      setEditLoading(false)
    }
  }

  // The form edits its contact list in place. In edit mode a removed contact is
  // an existing row, so remember it and delete it on save.
  const onContactsChange = (next) => {
    const idsIn = contacts.filter(c => c?.EMERGENCY_CONTACT_ID).map(c => c.EMERGENCY_CONTACT_ID)
    const idsOut = next.filter(c => c?.EMERGENCY_CONTACT_ID).map(c => c.EMERGENCY_CONTACT_ID)
    const removed = idsIn.filter(id => !idsOut.includes(id))
    if (removed.length > 0) setDeletedContactIds(prev => [...new Set([...prev, ...removed])])
    setContacts(next)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSaveError('')
    if (editLoading) return
    // Identity is mandatory for registration and for editing alike.
    if (!identity.firstName?.trim() || !identity.lastName?.trim()) {
      setSaveError(tr('First name and last name are required.'))
      return
    }
    // A restricted account keeps students inside its own categories only, so a
    // section inside that scope is required — when registering, and when moving
    // an existing student (a student with no section has no category and would
    // fall outside every secretary's scope).
    if (scope.restricted) {
      const chosen = allowedSections.find(s => String(s.SECTION_ID) === String(selectedSectionId))
      if (!chosen) {
        setSaveError(tr('Choose a section inside one of the teaching categories you are responsible for.'))
        return
      }
    }
    // The same rule the database enforces, answered while the field was typed.
    // While that answer is still on its way the form waits instead of saving.
    if (checking) return
    if (hasConflicts) {
      setSaveError(tr('Some numbers already belong to another student. Correct the highlighted fields first.'))
      return
    }
    // The family counts have to agree with each other. The fault is shown under
    // the field on the Family tab, which is also opened so it can be found.
    const familyProblem = firstFamilyCountError(detail)
    if (familyProblem) {
      setCreateTab('family')
      setSaveError(tr(familyProblem))
      return
    }
    try {
      // Uniforms and the personal address belong to registration as much as to
      // an existing record, so both payloads are computed once here and used by
      // whichever save path runs.
      const hasCombatValue = Object.values(combat).some(v => String(v ?? '').trim() !== '')
      // A male student has no skirt: those two sizes are cleared on save.
      const paradePayload = identity.sex === 'M'
        ? { ...parade, SUMMER_SKIRT_SIZE: '', WINTER_SKIRT_SIZE: '' }
        : parade
      const hasParadeValue = Object.values(paradePayload).some(v => String(v ?? '').trim() !== '')
      // Personal address — kept for every student, foreign included.
      const hasAddrValue = !!(addr.ADDRESS_STREET_LA || addr.ADDRESS_STREET_AR || addrSel.communeId)
      if (currentStudent.PERSON_ID) {
        const personId = currentStudent.PERSON_ID
        // The id can be corrected here, like any other identity field. It is
        // only checked when it actually changed, so a record that predates the
        // twelve-digit rule keeps its short id when the rest of the form is
        // saved.
        const typedId = String(identity.personId ?? '').trim()
        const idChanged = typedId !== String(personId)
        if (idChanged) {
          const problem = personIdError(typedId)
          if (problem) {
            setSaveError(tr(problem))
            return
          }
        }
        // Once the key changes, the rows written after it — photo, detail,
        // parents, contacts, uniforms, address — belong to the new number.
        const nextPersonId = idChanged ? personIdValue(typedId) : personId
        // Section first (and with it the teaching category shown on the card),
        // so a move the server refuses — e.g. to another secretary's category —
        // aborts the save before any other field is written. Only a real change
        // is sent; an empty choice unassigns the student for an admin, and the
        // validation above already requires one for a restricted account.
        const currentSectionId = currentStudent.sectionData?.SECTION_ID
        const nextSectionId = selectedSectionId ? parseInt(selectedSectionId, 10) : null
        if (nextSectionId !== (currentSectionId ? Number(currentSectionId) : null)) {
          await window.api.updateStudentSections(user?.id, personId, nextSectionId ? [nextSectionId] : [])
        }
        // 1. Identity, living on person. Roles are not sent here at all: they
        //    are rows of their own, changed through the role actions, so saving
        //    a student's file never adds or clears a role.
        await window.api.updatePerson(user?.id, personId, {
          ...(idChanged ? { PERSON_ID: nextPersonId } : {}),
          PERSON_FIRST_NAME_LA: identity.firstName.trim(),
          PERSON_FIRST_NAME_AR: identity.firstNameAr?.trim() || null,
          PERSON_LAST_NAME_LA: identity.lastName.trim(),
          PERSON_LAST_NAME_AR: identity.lastNameAr?.trim() || null,
          PERSON_BIRTHDATE: identity.birthdate || null,
          PERSON_SEX: identity.sex || 'M',
          PERSON_GRADE_ID: identity.gradeId || ''
        })
        // 1b. Photo: only when this session changed it, so saving an untouched
        //     form never rewrites the stored file.
        if (photo.sourcePath) {
          await window.api.setPersonPhoto(user?.id, nextPersonId, photo.sourcePath)
        } else if (photo.remove) {
          await window.api.setPersonPhoto(user?.id, nextPersonId, null)
        }
        // 2. The detail record: health, schooling, family, birth place, ... —
        //    the same fields the Student Records editor exposes (the service
        //    keeps only known columns, and re-checks the teaching-category scope).
        await window.api.updateStudentProfileDetail(user?.id, nextPersonId, {
          ...detail,
          STUDENT_BIRTH_PLACE_ID: geoSel.communeId || null
        })
        // 3. Parents: only when a row exists or something was filled in.
        const hasParentValues = Object.values(parents).some(v => v !== undefined && v !== null && v !== '')
        if (editPersonId && (hadParents || hasParentValues)) {
          await window.api.updateStudentProfileParents(user?.id, nextPersonId, parents)
        }
        // 4. Hobbies (replaces the set for this student).
        if (editPersonId) {
          await window.api.setStudentProfileHobbies(user?.id, nextPersonId, hobbySel)
          // 5. Emergency contacts. A foreign student keeps none — the server
          //    drops any existing rows when the foreign flag is saved;
          //    everyone else keeps their personal contacts.
          if (!detail.STUDENT_IS_FOREIGN) {
            // A consular row is not a personal contact: drop it when the
            // student is no longer foreign, since the form no longer edits it.
            for (const c of contacts.filter(x => x?.EMERGENCY_CONTACT_ID && (x.CONSULATE_NUMBER || x.CONSULATE_COUNTRY_ID))) {
              await window.api.deleteStudentEmergencyContact(user?.id, c.EMERGENCY_CONTACT_ID)
            }
            for (const c of contacts.filter(x => !x?.EMERGENCY_CONTACT_ID)) {
              await window.api.addStudentEmergencyContact(user?.id, nextPersonId, c)
            }
            for (const contactId of deletedContactIds) {
              await window.api.deleteStudentEmergencyContact(user?.id, contactId)
            }
          }
        }
        // 6. Uniforms — only when the record already had a row or something
        //    was filled in, so saving an untouched empty form creates nothing.
        if (editPersonId && (hadCombat || hasCombatValue)) {
          await window.api.updateStudentCombatOutfit(user?.id, nextPersonId, combat)
        }
        if (editPersonId && (hadParade || hasParadeValue)) {
          await window.api.updateStudentParadeUniform(user?.id, nextPersonId, paradePayload)
        }
        // 7. Personal address.
        if (hadAddress || hasAddrValue) {
          await window.api.updateStudentPersonalAddress(user?.id, nextPersonId, {
            ADDRESS_STREET_LA: addr.ADDRESS_STREET_LA,
            ADDRESS_STREET_AR: addr.ADDRESS_STREET_AR,
            COMMUNE_ID: addrSel.communeId || null
          })
        }
      } else {
        // Register with the COMPLETE student information in one transaction.
        // The twelve-digit id is typed in at registration: person_id is
        // supplied, not generated (11-person-id-manual.sql).
        const problem = personIdError(identity.personId)
        if (problem) {
          setSaveError(tr(problem))
          return
        }
        const created = await window.api.createStudentProfile(user?.id, {
          identity: { ...identity, personId: personIdValue(identity.personId) },
          detail: {
            ...detail,
            STUDENT_BIRTH_PLACE_ID: geoSel.communeId || null
          },
          parents,
          emergencyContacts: detail.STUDENT_IS_FOREIGN ? [] : contacts,
          hobbyIds: hobbySel,
          sectionIds: selectedSectionId ? [parseInt(selectedSectionId, 10)] : []
        })
        // The person row exists only now, so the photo, uniform rows and the
        // personal address are written against its id — the same blocks the
        // editor saves, so a registration and a later edit behave alike.
        if (created?.PERSON_ID) {
          if (photo.sourcePath) {
            await window.api.setPersonPhoto(user?.id, created.PERSON_ID, photo.sourcePath)
          }
          if (hasCombatValue) {
            await window.api.updateStudentCombatOutfit(user?.id, created.PERSON_ID, combat)
          }
          if (hasParadeValue) {
            await window.api.updateStudentParadeUniform(user?.id, created.PERSON_ID, paradePayload)
          }
          if (hasAddrValue) {
            await window.api.updateStudentPersonalAddress(user?.id, created.PERSON_ID, {
              ADDRESS_STREET_LA: addr.ADDRESS_STREET_LA,
              ADDRESS_STREET_AR: addr.ADDRESS_STREET_AR,
              COMMUNE_ID: addrSel.communeId || null
            })
          }
        }
      }
      setShowModal(false)
      await loadStudents()
    } catch (err) {
      console.error('Failed to save student', err)
      setSaveError(ipcErrorMessage(err, tr('Failed to save the student.')))
    }
  }

  const choosePhoto = async () => {
    setSaveError('')
    try {
      const res = await window.api.choosePersonPhoto()
      if (!res || res.canceled) return
      setPhoto({
        sourcePath: res.path || null,
        preview: res.dataUrl || null,
        name: res.name || '',
        existing: photo.existing,
        remove: false
      })
    } catch (err) {
      setSaveError(err.message || tr('That image could not be used.'))
    }
  }

  // Removing only clears the stored photo when the record already had one; a
  // photo chosen in this session but not saved yet simply disappears.
  const clearPhoto = () => {
    setSaveError('')
    setPhoto({ ...EMPTY_PHOTO, remove: photo.existing === true })
  }

  const handleAddContact = () => {
    if (!newContact.CONTACT_FIRST_NAME_LA && !newContact.CONTACT_PHONE_NUMBER) return
    setContacts([...contacts, newContact])
    setNewContact({ CONTACT_FIRST_NAME_LA: '', CONTACT_LAST_NAME_LA: '', CONTACT_RELATION_ID: '', CONTACT_PHONE_NUMBER: '', CONSULATE_NUMBER: '' })
  }

  const [confirmTarget, setConfirmTarget] = useState(null)
  const [notice, setNotice] = useState(null)

  // An Admin decides on the Settings page whether students may be deleted at
  // all. When denied, the delete actions are not offered; deletePerson refuses
  // the request too, so an older window cannot get around it.
  const [deletionAllowed, setDeletionAllowed] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.api.getSettings(user?.id)
      .then((res) => {
        if (cancelled) return
        const option = (res?.data || []).find((o) => o.OPTION_KEY === 'student_deletion_allowed')
        setDeletionAllowed(!option || option.OPTION_VALUE !== '0')
      })
      .catch(() => {
        // Settings unavailable: keep the server's decision as the gate.
      })
    return () => { cancelled = true }
  }, [user?.id])

  // Table interaction: selection, docked inspector, native context menu and
  // row keyboard traversal. The inspector is the same six-field summary used by
  // the full record screen, so opening a student never loses list context.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [inspectorId, setInspectorId] = useState(null)
  const [inspectorDetail, setInspectorDetail] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [reportStudent, setReportStudent] = useState(null)
  const searchRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // "Open Full Record" elsewhere in the application links here with ?student=:
  // the student is opened in the inspector, then the parameter is cleared so a
  // reload does not reopen it.
  const requestedStudentId = searchParams.get('student')
  useEffect(() => {
    if (!requestedStudentId) return
    const match = students.find((student) => Number(student.PERSON_ID) === Number(requestedStudentId))
    if (!match) return
    setInspectorId(Number(match.PERSON_ID))
    const next = new URLSearchParams(searchParams)
    next.delete('student')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedStudentId, students])

  const handleDelete = async (id) => {
    try {
      await window.api.deletePerson(user?.id, id)
      await loadStudents()
    } catch (err) {
      console.error('Failed to delete student', err)
      setNotice({ type: 'error', text: tr('Failed to delete student: ') + (err.message || '') })
    }
  }

  // --- Table pipeline: filter -> sort -> paginate ------------------------
  const studentName = (s) =>
    `${s.PERSON_FIRST_NAME || s.person_first_name || ''} ${s.PERSON_LAST_NAME || s.person_last_name || ''}`.toLowerCase()

  // Filter options derived from the roster itself (works for every role). A
  // secretary's filter lists only offer the categories they are responsible for.
  const categories = useMemo(() => {
    const set = new Set()
    students.forEach(s => {
      const l = s.sectionData?.TEACHING_CATEGORY_LABEL
      if (!l) return
      if (scope.restricted && !scope.categoryIds.includes(Number(s.sectionData?.TEACHING_CATEGORY_ID))) return
      set.add(l)
    })
    return [...set].sort()
  }, [students, scope])

  const sectionOptions = useMemo(() => {
    const set = new Set()
    students.forEach(s => {
      const l = s.sectionData?.SECTION_LABEL
      if (!l) return
      if (scope.restricted && !scope.categoryIds.includes(Number(s.sectionData?.TEACHING_CATEGORY_ID))) return
      if (!categoryFilter || s.sectionData?.TEACHING_CATEGORY_LABEL === categoryFilter) set.add(l)
    })
    return [...set].sort()
  }, [students, categoryFilter, scope])

  const hasActiveFilters = !!(searchTerm || categoryFilter || sectionFilter || (tracksCompletion && infoFilter))

  const filteredStudents = students.filter(s => {
    if (searchTerm && !studentName(s).includes(searchTerm.toLowerCase())) return false
    const cat = s.sectionData?.TEACHING_CATEGORY_LABEL
    const sec = s.sectionData?.SECTION_LABEL
    if (categoryFilter === '__none__') { if (cat) return false }
    else if (categoryFilter && cat !== categoryFilter) return false
    if (sectionFilter === '__none__') { if (sec) return false }
    else if (sectionFilter && sec !== sectionFilter) return false
    if (tracksCompletion && infoFilter) {
      // A row with no completion figures counts as incomplete: it is the one
      // the secretary has to look at.
      const missing = studentCompletion(s)?.missing ?? 1
      if (infoFilter === 'missing' ? missing === 0 : missing > 0) return false
    }
    return true
  })

  const sortedStudents = [...filteredStudents].sort((a, b) => {
    let va, vb
    switch (sortKey) {
      case 'id': va = a.PERSON_ID || a.person_id; vb = b.PERSON_ID || b.person_id; break
      case 'birthdate':
        va = Date.parse(a.PERSON_BIRTHDATE || a.person_birthdate) || 0
        vb = Date.parse(b.PERSON_BIRTHDATE || b.person_birthdate) || 0
        break
      case 'sex': va = (a.PERSON_SEX || a.person_sex) === 'M' ? 0 : 1; vb = (b.PERSON_SEX || b.person_sex) === 'M' ? 0 : 1; break
      case 'category': va = (a.sectionData?.TEACHING_CATEGORY_LABEL || '').toLowerCase(); vb = (b.sectionData?.TEACHING_CATEGORY_LABEL || '').toLowerCase(); break
      case 'section': va = (a.sectionData?.SECTION_LABEL || '').toLowerCase(); vb = (b.sectionData?.SECTION_LABEL || '').toLowerCase(); break
      default: va = studentName(a); vb = studentName(b)
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const totalPages = Math.max(1, Math.ceil(sortedStudents.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedStudents = sortedStudents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const inspectorStudent = useMemo(
    () => students.find((student) => Number(student.PERSON_ID) === Number(inspectorId)) || null,
    [students, inspectorId]
  )

  // Photos for the rows on screen and for the open record summary. The column
  // stores a path, so the main process turns each one into a data URL; results
  // are cached by person id, which keeps paging from re-reading the same file
  // and leaves a row whose file is gone showing its initials instead.
  const [photoCache, setPhotoCache] = useState({})
  const photosInFlight = useRef(new Set())
  useEffect(() => {
    const wanted = [...pagedStudents, inspectorStudent]
      .map((student) => student && {
        id: Number(student.PERSON_ID),
        path: student.PERSON_PHOTO || student.person_photo || null
      })
      .filter((entry) => entry && entry.path
        && !Object.prototype.hasOwnProperty.call(photoCache, entry.id)
        && !photosInFlight.current.has(entry.id))
    if (wanted.length === 0) return

    for (const entry of wanted) photosInFlight.current.add(entry.id)
    window.api.readPersonPhotos(wanted.map((entry) => entry.path))
      .then((res) => {
        const dataUrls = res?.dataUrls || []
        setPhotoCache((prev) => {
          const next = { ...prev }
          wanted.forEach((entry, index) => { next[entry.id] = dataUrls[index] || null })
          return next
        })
      })
      // A picture that cannot be read is not an error: the row keeps its initials.
      .catch(() => {})
      .finally(() => { for (const entry of wanted) photosInFlight.current.delete(entry.id) })
  }, [pagedStudents, inspectorStudent, photoCache])

  const inspectorPhoto = photoCache[Number(inspectorId)] || null
  // Lookup-backed facts in the summary, resolved in the interface language.
  const inspectorHealthStatus = (() => {
    const id = inspectorDetail?.detail?.STUDENT_HEALTH_STATUS_ID
    if (!id) return null
    const row = (inspectorDetail?.lookups?.healthStatuses || []).find(r => String(r.HEALTH_STATUS_ID) === String(id))
    return row ? localizedLabel(row, 'HEALTH_STATUS') : null
  })()
  const inspectorSpeciality = (() => {
    const id = inspectorDetail?.detail?.STUDENT_SPECIALITY_ID
    if (!id) return null
    const row = (inspectorDetail?.lookups?.specialities || []).find(r => String(r.STUDENT_SPECIALITY_ID) === String(id))
    return row ? localizedLabel(row, 'SPECIALITY_NAME') : null
  })()
  const canSetPhoto = isAdmin || isDirector
  const [photoSavingId, setPhotoSavingId] = useState(null)
  // Removing a photo deletes the image file, so it is never a one-click action.
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false)

  // Remove the open record's photo: the column is cleared, the managed file is
  // deleted by the main process, and the row falls back to its initials.
  const removeInspectorPhoto = async () => {
    if (!inspectorStudent || photoSavingId) return
    const id = Number(inspectorStudent.PERSON_ID)
    try {
      setPhotoSavingId(id)
      await window.api.setPersonPhoto(user?.id, id, null)
      setStudents((prev) => prev.map((student) => (
        Number(student.PERSON_ID) === id ? { ...student, PERSON_PHOTO: null } : student
      )))
      setPhotoCache((prev) => ({ ...prev, [id]: null }))
      setNotice({ type: 'success', text: tr('Photo removed.') })
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setPhotoSavingId(null)
    }
  }

  // Replace the open record's photo in place: pick a file, store it, then write
  // the new path into the row and its cached picture so the summary and the list
  // thumbnail update without reloading the roster.
  const replaceInspectorPhoto = async () => {
    if (!inspectorStudent || photoSavingId) return
    const id = Number(inspectorStudent.PERSON_ID)
    try {
      const picked = await window.api.choosePersonPhoto()
      if (!picked || picked.canceled || !picked.path) return
      setPhotoSavingId(id)
      const res = await window.api.setPersonPhoto(user?.id, id, picked.path)
      setStudents((prev) => prev.map((student) => (
        Number(student.PERSON_ID) === id ? { ...student, PERSON_PHOTO: res?.path || picked.path } : student
      )))
      setPhotoCache((prev) => ({ ...prev, [id]: res?.dataUrl || picked.dataUrl || null }))
      setNotice({ type: 'success', text: tr('Photo saved.') })
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setPhotoSavingId(null)
    }
  }

  const pageIds = useMemo(
    () => pagedStudents.map((student) => Number(student.PERSON_ID)),
    [pagedStudents]
  )
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const selectedStudents = useMemo(
    () => students.filter((student) => selectedIds.has(Number(student.PERSON_ID))),
    [students, selectedIds]
  )

  const openInspector = (student) => {
    if (!student) return
    setInspectorId(student.PERSON_ID)
    setFocusIndex(pagedStudents.findIndex((row) => row.PERSON_ID === student.PERSON_ID))
  }

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(Number(id))) next.delete(Number(id))
      else next.add(Number(id))
      return next
    })
  }

  const togglePage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allPageSelected) pageIds.forEach((id) => next.delete(id))
      else pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  const exportCsv = (rows, label) => {
    if (!rows.length) return
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const header = ['Reference', 'Last name', 'First name', 'Sex', 'Born', 'Category', 'Section', 'Insurance', 'Military card', 'Helmet']
    const lines = rows.map((student) =>
      [
        student.PERSON_ID,
        student.PERSON_LAST_NAME || student.person_last_name,
        student.PERSON_FIRST_NAME || student.person_first_name,
        student.PERSON_SEX || student.person_sex,
        toDateInput(student.PERSON_BIRTHDATE || student.person_birthdate),
        student.sectionData?.TEACHING_CATEGORY_LABEL || '',
        student.sectionData?.SECTION_LABEL || '',
        student.STUDENT_INSURANCE_CARD_NUMBER || '',
        student.STUDENT_MILITARY_CARD_NUMBER || '',
        student.STUDENT_MILITARY_HELMET_NUMBER || ''
      ]
        .map(escape)
        .join(',')
    )
    const blob = new Blob([[header.map(escape).join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `students-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setNotice({ type: 'success', text: `${rows.length} ${tr(rows.length === 1 ? 'row' : 'rows')} exported${label ? ` · ${label}` : ''}.` })
  }

  // Deep links from the command palette and the overview queue.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('filter') === 'unassigned') {
      setSectionFilter('__none__')
      setPage(1)
    }
    if (params.get('new') === '1' && canManage && !noScopeAtAll) {
      openCreateModal()
    }
    const person = params.get('person')
    if (person) setInspectorId(Number(person))
  }, [location.search])

  // Table keyboard model: / focuses search, j/k traverse, x selects, Enter opens.
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || event.target?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (event.key === 'Escape') {
        setContextMenu(null)
        if (inspectorId) setInspectorId(null)
        else if (selectedIds.size) setSelectedIds(new Set())
        return
      }
      if (!pagedStudents.length) return
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        setFocusIndex((current) => {
          if (event.key === 'j') return Math.min(pagedStudents.length - 1, current + 1)
          return Math.max(0, current <= 0 ? 0 : current - 1)
        })
      } else if (event.key === 'Enter' && focusIndex >= 0) {
        event.preventDefault()
        openInspector(pagedStudents[focusIndex])
      } else if (event.key === 'x' && focusIndex >= 0) {
        event.preventDefault()
        toggleSelected(pageIds[focusIndex])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pagedStudents, focusIndex, pageIds, inspectorId, selectedIds])

  useEffect(() => {
    if (focusIndex < 0) return
    document.querySelector(`[data-row-index="${focusIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusIndex])

  // Keep the inspector's placement block current without opening the modal.
  useEffect(() => {
    if (!inspectorStudent) return
    loadStudentSections(inspectorStudent.PERSON_ID)
    loadStudentGroups(inspectorStudent.PERSON_ID)
    let cancelled = false
    setInspectorDetail(null)
    Promise.allSettled([
      window.api.getStudentProfile(user?.id, inspectorStudent.PERSON_ID),
      window.api.getProfileLookups()
    ]).then(([profile, lookups]) => {
      if (cancelled) return
      setInspectorDetail({
        profile: profile.status === 'fulfilled' ? profile.value || null : null,
        detail: profile.status === 'fulfilled' ? profile.value?.detail || null : null,
        lookups: lookups.status === 'fulfilled' ? lookups.value || null : null
      })
    })
    return () => { cancelled = true }
  }, [inspectorStudent?.PERSON_ID])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <PageHeader
        kicker={tr('Student registry')}
        title={tr('Student directory')}
        meta={loading ? '—' : `${sortedStudents.length} ${tr(sortedStudents.length === 1 ? 'record' : 'records')}`}
        actions={
          <>
            <button
              type="button"
              onClick={() => exportCsv(sortedStudents)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] text-ink-2 hover:bg-surface-muted"
            >
              <Download size={12} strokeWidth={1.9} /> {tr('Export')}
            </button>
            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                disabled={noScopeAtAll}
                title={noScopeAtAll
                  ? tr('No teaching category has been assigned to you yet. Ask an administrator.')
                  : tr('Register a new student')}
                className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11.5px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: 'var(--color-on-jade)' }}
              >
                <UserPlus size={12} strokeWidth={2} /> {tr('Register student')}
              </button>
            )}
          </>
        }
      />

      {scope.restricted && (
        <div className="flex min-h-8 shrink-0 items-center gap-2 border-b border-line px-5 py-1.5 text-[11px] text-ink-2" style={{ background: 'var(--color-warning-bg)' }}>
          <Info size={12} strokeWidth={2} className="shrink-0" style={{ color: 'var(--color-warning-ink)' }} />
          <span style={{ color: 'var(--color-warning-ink)' }}>
            {noScopeAtAll
              ? tr('No teaching category has been assigned to you yet, so no student is listed.')
              : <>{tr('Your categories:')} <strong className="font-semibold">{scope.categories.map(c => c.TEACHING_CATEGORY_LABEL).join(', ')}</strong>{tr('. Only students in these categories are listed — students outside them are not accessible.')}</>}
          </span>
        </div>
      )}

      <SplitPane
        storageKey="enote-directory-split"
        initial={360}
        min={300}
        max={560}
        asideLabel={tr('Student record summary')}
        aside={
          inspectorStudent ? (
            <>
              <div className="shrink-0 border-b border-line px-3.5 py-3.5">
                <div className="flex items-start gap-3">
                  <div
                    className="serif grid h-[176px] w-[176px] shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line-strong bg-surface-muted text-[38px] text-ink-2"
                    aria-hidden="true"
                  >
                    {inspectorPhoto
                      ? <PhotoZoom src={inspectorPhoto} alt={personNameLastFirst(inspectorStudent.PERSON_LAST_NAME, inspectorStudent.PERSON_FIRST_NAME)} />
                      : `${inspectorStudent.PERSON_FIRST_NAME?.[0] || ''}${inspectorStudent.PERSON_LAST_NAME?.[0] || ''}`.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                      {personNameLastFirst(inspectorStudent.PERSON_LAST_NAME, inspectorStudent.PERSON_FIRST_NAME)}
                    </div>
                    <div className="mono mt-1 text-[10px] text-ink-3">
                      #{String(inspectorStudent.PERSON_ID).padStart(4, '0')}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {inspectorStudent.sectionData?.TEACHING_CATEGORY_LABEL && (
                        <span className="kicker rounded-[3px] border border-line-strong bg-selection px-1.5 py-0.5 text-[9px] text-ink-2">
                          {inspectorStudent.sectionData.TEACHING_CATEGORY_LABEL}
                        </span>
                      )}
                      <span className="kicker rounded-[3px] border border-line bg-surface-muted px-1.5 py-0.5 text-[9px] text-ink-3">
                        {inspectorStudent.sectionData?.SECTION_LABEL || tr('No section')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectorId(null)}
                    aria-label={tr('Close record')}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                  >
                    <X size={14} strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <dl className="px-3.5 py-1">
                  {[
                    [tr('Sex'), inspectorStudent.PERSON_SEX === 'M' ? tr('Male') : tr('Female')],
                    [tr('Born'), formatDate(inspectorStudent.PERSON_BIRTHDATE)],
                    [tr('Teaching category'), inspectorStudent.sectionData?.TEACHING_CATEGORY_LABEL || '—'],
                    [tr('Section'), inspectorStudent.sectionData?.SECTION_LABEL || '—'],
                    [tr('Section code'), inspectorStudent.sectionData?.SECTION_CODE || '—']
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-[7px] last:border-0">
                      <dt className="shrink-0 text-[11px] text-ink-3">{label}</dt>
                      <dd className="truncate text-end text-[12px] text-ink-2">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="kicker border-y border-line bg-surface-muted px-3.5 py-1.5">{tr('Contact')}</div>
                <dl className="px-3.5 py-1">
                  {[
                    [tr('Personal Phone'), inspectorDetail?.detail?.STUDENT_PERSONAL_PHONE, true],
                    [tr('Email'), inspectorStudent.PERSON_EMAIL],
                    [tr('Emergency contact'), inspectorDetail?.profile?.emergencyContacts?.[0]?.CONTACT_PHONE_NUMBER || inspectorDetail?.profile?.emergencyContacts?.[0]?.CONSULATE_NUMBER, true]
                  ].map(([label, value, mono]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-[7px] last:border-0">
                      <dt className="shrink-0 text-[11px] text-ink-3">{label}</dt>
                      <dd
                        className={`min-w-0 truncate text-end text-[11.5px] ${value ? (mono ? 'mono text-ink-2' : 'text-ink-2') : 'text-ink-3'}`}
                        title={typeof value === 'string' ? value : undefined}
                      >{value || '—'}</dd>
                    </div>
                  ))}
                </dl>

                <div className="kicker border-y border-line bg-surface-muted px-3.5 py-1.5">{tr('Access')}</div>
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <StateMark tone={inScopeCategory(inspectorStudent.sectionData?.TEACHING_CATEGORY_ID) ? 'good' : 'neutral'} className="text-[11.5px] text-ink-2">
                    {inScopeCategory(inspectorStudent.sectionData?.TEACHING_CATEGORY_ID)
                      ? tr('Editable by you')
                      : tr('Managed by another office')}
                  </StateMark>
                  <span className="mono text-[10px] text-ink-3">{tr('SCOPE')}</span>
                </div>

                <div className="kicker border-y border-line bg-surface-muted px-3.5 py-1.5">{tr('Academic & health')}</div>
                <dl className="px-3.5 py-1">
                  {[
                    [tr('Speciality'), inspectorSpeciality],
                    [tr('Health Status'), inspectorHealthStatus],
                    [tr('Blood Type'), inspectorDetail?.detail?.STUDENT_BLOOD_TYPE],
                    [tr('Foreign Student'), inspectorDetail?.detail?.STUDENT_IS_FOREIGN === true ? tr('Yes') : inspectorDetail?.detail?.STUDENT_IS_FOREIGN === false ? tr('No') : null]
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-[7px] last:border-0">
                      <dt className="shrink-0 text-[11px] text-ink-3">{label}</dt>
                      <dd className="min-w-0 truncate text-end text-[11.5px] text-ink-2" title={typeof value === 'string' ? value : undefined}>
                        {value || <span className="text-ink-3">—</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="shrink-0 border-t border-line bg-surface-muted p-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {canManage && inScopeCategory(inspectorStudent.sectionData?.TEACHING_CATEGORY_ID) && (
                    <button
                      type="button"
                      onClick={() => openEditModal(inspectorStudent)}
                      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110"
                      style={{ color: 'var(--color-on-jade)' }}
                    >
                      <Edit2 size={12} strokeWidth={2} /> {tr('Edit student')}
                    </button>
                  )}
                  {canSetPhoto && inScopeCategory(inspectorStudent.sectionData?.TEACHING_CATEGORY_ID) && (
                    <button
                      type="button"
                      onClick={replaceInspectorPhoto}
                      disabled={photoSavingId === Number(inspectorStudent.PERSON_ID)}
                      title={tr('Choose a photo for this student without opening the edit form')}
                      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] text-ink-2 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ImageIcon size={12} strokeWidth={1.9} />
                      {photoSavingId === Number(inspectorStudent.PERSON_ID) ? tr('Saving…') : tr('Photo')}
                    </button>
                  )}
                  {canSetPhoto && inScopeCategory(inspectorStudent.sectionData?.TEACHING_CATEGORY_ID) && inspectorStudent.PERSON_PHOTO && (
                    <button
                      type="button"
                      onClick={() => setConfirmRemovePhoto(true)}
                      disabled={photoSavingId === Number(inspectorStudent.PERSON_ID)}
                      title={tr('Remove this student photo')}
                      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] border px-2.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
                      style={{
                        borderColor: 'color-mix(in srgb, var(--color-danger) 35%, transparent)',
                        background: 'var(--color-danger-bg)',
                        color: 'var(--color-danger-ink)'
                      }}
                    >
                      <Trash2 size={12} strokeWidth={1.9} />
                      {photoSavingId === Number(inspectorStudent.PERSON_ID) ? tr('Saving…') : tr('Remove photo')}
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleOpenSectionModal(inspectorStudent)}
                      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] text-ink-2 hover:bg-surface-muted"
                    >
                      <Layers size={12} strokeWidth={1.9} /> {tr('Sections')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setReportStudent(inspectorStudent)}
                    className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] text-ink-2 hover:bg-surface-muted"
                  >
                    <FileDown size={12} strokeWidth={1.9} /> {tr('Report')}
                  </button>
                  {onOpenRecord && (
                    <button
                      type="button"
                      onClick={() => onOpenRecord(inspectorStudent)}
                      className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] text-ink-2 hover:bg-surface-muted"
                    >
                      <UserRound size={12} strokeWidth={1.9} /> {tr('Full record')}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-3.5">
                <span className="kicker">{tr('Record inspector')}</span>
                <span className="mono text-[10px] text-ink-3">{tr('CLOSED')}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
                <p className="serif text-[19px] leading-snug text-ink-2">{tr('Select a student to read their record.')}</p>
                <p className="mt-2 max-w-[240px] text-[11.5px] leading-relaxed text-ink-3">
                  {tr('The summary stays docked while you move through the list. Drag the seam to give it more room.')}
                </p>
                <div className="mt-5 space-y-1.5 border-t border-line pt-3 text-[11px] text-ink-3">
                  {[
                    ['/', tr('focus search')],
                    ['J / K', tr('move down the list')],
                    ['X', tr('select the focused row')],
                    ['↵', tr('open the record')],
                    ['ESC', tr('close and clear')]
                  ].map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span>{label}</span>
                      <span className="kbd">{key}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="shrink-0 border-t border-line px-3.5 py-2 text-[10px] uppercase tracking-[0.07em] text-ink-3">
                {tr('{count} records in view', { count: sortedStudents.length })}
              </div>
            </div>
          )
        }
      >
        <div className="flex min-h-0 flex-1 flex-col bg-surface">
          {selectedIds.size > 0 ? (
            <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-line bg-selection px-3">
              <span className="mono text-[11px] text-ink">{selectedIds.size} {tr(selectedIds.size === 1 ? 'selected' : 'selected')}</span>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[11px] text-ink-3 hover:text-ink">
                {tr('Clear')}
              </button>
              <div className="ms-auto flex items-center gap-1.5">
                {selectedIds.size === 1 && isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleOpenSectionModal(selectedStudents[0])}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted"
                  >
                    <Layers size={12} /> {tr('Assign section')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => exportCsv(selectedStudents, tr('selection'))}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-ink-2 hover:bg-surface-muted"
                >
                  <Download size={12} /> {tr('Export CSV')}
                </button>
                {selectedIds.size === 1 && canManage && deletionAllowed && (
                  <button
                    type="button"
                    onClick={() => setConfirmTarget(Number(selectedStudents[0].PERSON_ID))}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] text-danger-ink hover:bg-danger-bg"
                  >
                    <Trash2 size={12} /> {tr('Delete')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[46px] shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-2.5 py-1.5">
<FilterBar
            activeCount={[categoryFilter, sectionFilter, tracksCompletion ? infoFilter : ''].filter(Boolean).length}
            onClear={() => { setSearchTerm(''); setCategoryFilter(''); setSectionFilter(''); setInfoFilter(''); setPage(1) }}
            matchCount={sortedStudents.length}
            matchLabel="student"
            title={tr('Filter students')}
            search={searchTerm}
            onSearch={(value) => { setSearchTerm(value); setPage(1) }}
            searchPlaceholder={tr('Search name or reference')}
            searchLabel={tr('Search students')}
            searchInputRef={searchRef}
            searchShortcut="/"
            onReset={resetView}
            resetLabel={tr('Reset view')}
          >
            <FilterField label={tr('Category')}>
              <select
                className={filterInputCls}
                value={categoryFilter}
                onChange={(event) => { setCategoryFilter(event.target.value); setSectionFilter(''); setPage(1) }}
                aria-label={tr('Filter by teaching category')}
              >
                <option value="">{tr('All categories')}</option>
                <option value="__none__">{tr('Unassigned')}</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </FilterField>
            <FilterField label={tr('Section')}>
              <select
                className={filterInputCls}
                value={sectionFilter}
                onChange={(event) => { setSectionFilter(event.target.value); setPage(1) }}
                aria-label={tr('Filter by section')}
              >
                <option value="">{tr('All sections')}</option>
                <option value="__none__">{tr('Unassigned')}</option>
                {sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}
              </select>
            </FilterField>
            {tracksCompletion && (
              <FilterField label={tr('Information')}>
                <select
                  className={filterInputCls}
                  value={infoFilter}
                  onChange={(event) => { setInfoFilter(event.target.value); setPage(1) }}
                  aria-label={tr('Filter by information completeness')}
                >
                  <option value="">{tr('All students')}</option>
                  <option value="missing">{tr('Missing information')}</option>
                  <option value="complete">{tr('No missing information')}</option>
                </select>
              </FilterField>
            )}
            <FilterField label={tr('Sort by')}>
              <select
                className={filterInputCls}
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value)}
                aria-label={tr('Sort students by')}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr('Order')}>
              <select
                className={filterInputCls}
                value={sortDir}
                onChange={(event) => setSortDir(event.target.value)}
                aria-label={tr('Sort order')}
              >
                <option value="asc">{tr('Ascending')}</option>
                <option value="desc">{tr('Descending')}</option>
              </select>
            </FilterField>
          </FilterBar>
              <div className="ms-auto flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => exportCsv(sortedStudents)}
                  title={tr('Export filtered rows')}
                  aria-label={tr('Export filtered rows')}
                  className="grid h-7 w-7 place-items-center rounded-[3px] border border-line-strong text-ink-3 hover:bg-surface-muted hover:text-ink"
                >
                  <Download size={12} />
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={openCreateModal}
                    disabled={noScopeAtAll}
                    className="inline-flex h-7 items-center gap-1 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:opacity-40"
                    style={{ color: 'var(--color-on-jade)' }}
                  >
                    <Plus size={11} strokeWidth={2.4} /> {tr('New')}
                  </button>
                )}
              </div>

          {/* Placement filters and the ordering sit beside the search. */}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {loadError ? (
              <ListError label={tr('Could not load this list')} detail={loadError} onRetry={loadStudents} />
            ) : null}
            <UndoToast
              message={pendingUndo ? tr('Filters cleared') : null}
              onUndo={() => {
                if (!pendingUndo) return
                setSearchTerm(pendingUndo.searchTerm)
                setSortKey(pendingUndo.sortKey)
                setSortDir(pendingUndo.sortDir)
                setCategoryFilter(pendingUndo.categoryFilter)
                setSectionFilter(pendingUndo.sectionFilter)
                setInfoFilter(pendingUndo.infoFilter)
                setPage(pendingUndo.page)
              }}
              onClose={() => setPendingUndo(null)}
            />
            <DataTable
              className="data-table min-w-[560px]"
              label={tr('Students')}
              caption={tr('Registered students, with placement and record status')}
              colWidths={[32, 'auto', 40, 76, 104, 88, 88, tracksCompletion ? 124 : null, 40]}
              sort={{ key: sortKey, dir: sortDir }}
              columns={[
                { key: 'c0', className: "!px-0 text-center", header: <><input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={togglePage}
                      aria-label={tr('Select this page')}
                      className="h-4 w-4 cursor-pointer"
                      style={{ accentColor: 'var(--color-jade-solid)' }}
                    /></> },
                { key: 'c1', sortKey: 'name', header: <>{tr('Student')}</> },
                { key: 'c2', sortKey: 'sex', header: <>{tr('Sex')}</> },
                { key: 'c3', sortKey: 'birthdate', header: <>{tr('Born')}</> },
                { key: 'c4', sortKey: 'category', header: <>{tr('Category')}</> },
                { key: 'c5', sortKey: 'section', header: <>{tr('Section')}</> },
                { key: 'c6', header: <>{tr('Status')}</> },
                { key: 'c7', when: tracksCompletion, header: <>{tr('Information')}</> },
                { key: 'c8', className: "text-end", header: <><span className="sr-only">{tr('Actions')}</span></> },
              ]}
            >
                {loading ? (
                  Array.from({ length: 12 }, (_, index) => (
                    <tr key={`skeleton-${index}`} aria-hidden="true">
                      <td className="!px-0" />
                      <td><span className="block h-3 w-40 rounded-sm bg-surface-muted" /></td>
                      <td><span className="block h-3 w-4 rounded-sm bg-surface-muted" /></td>
                      <td><span className="block h-3 w-14 rounded-sm bg-surface-muted" /></td>
                      <td><span className="block h-3 w-16 rounded-sm bg-surface-muted" /></td>
                      <td><span className="block h-3 w-12 rounded-sm bg-surface-muted" /></td>
                      <td><span className="block h-3 w-12 rounded-sm bg-surface-muted" /></td>
                      {tracksCompletion && <td><span className="block h-3 w-20 rounded-sm bg-surface-muted" /></td>}
                      <td />
                    </tr>
                  ))
                ) : pagedStudents.length === 0 ? (
                  <tr>
                    <td colSpan={tracksCompletion ? 9 : 8} className="!h-40 text-center">
                      <div className="mx-auto max-w-[280px]">
                        <p className="text-[13px] font-medium text-ink-2">
                          {hasActiveFilters ? tr('No students match these filters.') : tr('No students registered yet.')}
                        </p>
                        <p className="mt-1 text-[11px] text-ink-3">
                          {hasActiveFilters
                            ? tr('Filters are shown above the table.')
                            : tr('Register a student to begin the register.')}
                        </p>
                        {hasActiveFilters ? (
                          <button
                            type="button"
                            onClick={() => { setSearchTerm(''); setCategoryFilter(''); setSectionFilter(''); setInfoFilter(''); setPage(1) }}
                            className="mt-2 text-[11px] font-medium text-jade-600 hover:text-jade-700"
                          >
                            {tr('Clear filters')}
                          </button>
                        ) : canManage ? (
                          <button type="button" onClick={openCreateModal} className="mt-2 text-[11px] font-medium text-jade-600 hover:text-jade-700">
                            {tr('Register student')}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedStudents.map((student, index) => {
                    const id = Number(student.PERSON_ID || student.person_id)
                    const sex = student.PERSON_SEX || student.person_sex
                    const firstName = student.PERSON_FIRST_NAME || student.person_first_name || ''
                    const lastName = student.PERSON_LAST_NAME || student.person_last_name || ''
                    const category = student.sectionData?.TEACHING_CATEGORY_LABEL
                    const section = student.sectionData?.SECTION_LABEL
                    const inScope = inScopeCategory(student.sectionData?.TEACHING_CATEGORY_ID)
                    const completion = studentCompletion(student)
                    const isOpen = Number(inspectorId) === id
                    return (
                      <tr
                        key={id}
                        data-row-index={index}
                        data-selected={selectedIds.has(id) || undefined}
                        data-open={isOpen || undefined}
                        {...activatableRowProps(() => openInspector(student))}
                        onClick={() => openInspector(student)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setContextMenu({ x: event.clientX, y: event.clientY, student })
                        }}
                        style={focusIndex === index ? { boxShadow: 'inset 0 0 0 2px var(--color-jade-500)' } : undefined}
                        className="cursor-default"
                      >
                        <td className="!px-0 text-center" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(id)}
                            onChange={() => toggleSelected(id)}
                            aria-label={`${tr('Select')} ${lastName} ${firstName}`}
                            className="h-4 w-4 cursor-pointer"
                            style={{ accentColor: 'var(--color-jade-solid)' }}
                          />
                        </td>
                        <td className="max-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="mono grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-line-strong text-[18px] leading-none text-ink-3"
                              aria-hidden="true"
                            >
                              {photoCache[id]
                                ? <PhotoZoom src={photoCache[id]} alt={personNameLastFirst(lastName, firstName)} />
                                : `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase()}
                            </span>
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="truncate font-medium text-ink">{personNameLastFirst(lastName, firstName)}</span>
                              <span className="mono shrink-0 text-[10px] text-ink-3">
                                № {String(id).padStart(4, '0')}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td>{sex === 'M' ? tr('M') : sex === 'F' ? tr('F') : '—'}</td>
                        <td className="mono text-[10.5px]">{formatDate(student.PERSON_BIRTHDATE || student.person_birthdate)}</td>
                        <td className="max-w-0 truncate" title={category || undefined}>{category || <span className="text-ink-3">—</span>}</td>
                        <td className="max-w-0 truncate" title={section || undefined}>
                          {section || (
                            <span className="inline-flex items-center gap-1 text-ink-3">
                              <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'var(--color-warning)' }} />
                              {tr('Unplaced')}
                            </span>
                          )}
                        </td>
                        <td>
                          {!inScope ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-ink-3">
                              <Lock size={10} strokeWidth={2} /> {tr('Read-only')}
                            </span>
                          ) : section ? (
                            <StateMark tone="good" className="text-[11px] text-ink-2">{tr('Active')}</StateMark>
                          ) : (
                            <StateMark tone="warn" className="text-[11px] text-ink-2">{tr('Unplaced')}</StateMark>
                          )}
                        </td>
                        {tracksCompletion && (
                          <td>
                            {!completion ? (
                              <span className="text-ink-3">—</span>
                            ) : completion.missing === 0 ? (
                              <StateMark tone="good" className="text-[11px] text-ink-2">{tr('Complete')}</StateMark>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1.5"
                                title={`${completion.missing} ${tr('missing')} · ${completion.percent}%`}
                              >
                                <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{
                                      width: `${completion.percent}%`,
                                      background: completion.percent >= 75 ? 'var(--color-warning)' : 'var(--color-danger)'
                                    }}
                                  />
                                </span>
                                <span className="mono whitespace-nowrap text-[10px] text-ink-2">
                                  {completion.missing} {tr('missing')}
                                </span>
                                <span className="mono text-[10px] text-ink-3">· {completion.percent}%</span>
                              </span>
                            )}
                          </td>
                        )}
                        <td className="!pe-1 text-end" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(event) => {
                              const rect = event.currentTarget.getBoundingClientRect()
                              setContextMenu({ x: rect.right - 4, y: rect.bottom + 2, student })
                            }}
                            aria-label={`${tr('Actions for')} ${lastName} ${firstName}`}
                            className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
            </DataTable>
          </div>

          <div className="flex h-10 shrink-0 items-center gap-3 border-t border-line bg-surface-muted px-3">
            <span className="mono text-[10px] text-ink-3">
              {pagedStudents.length ? (
                <>
                  {tr('Rows')} {(safePage - 1) * PAGE_SIZE + 1}–{(safePage - 1) * PAGE_SIZE + pagedStudents.length}
                  {' '}{tr('of')} {sortedStudents.length}
                </>
              ) : (
                tr('No rows')
              )}
            </span>
            <span className="hidden text-[10px] text-ink-3 lg:inline">
              {tr('Page')} {safePage}/{totalPages} · {PAGE_SIZE} {tr('per page')}
            </span>
            <div className="ms-auto flex items-center gap-1">
              <Pagination page={safePage} totalItems={sortedStudents.length} pageSize={PAGE_SIZE} onPageChange={setPage} compact />
            </div>
          </div>
        </div>
      </SplitPane>

      <ContextMenu
        open={!!contextMenu}
        x={contextMenu?.x || 0}
        y={contextMenu?.y || 0}
        onClose={() => setContextMenu(null)}
        items={
          contextMenu
            ? [
                {
                  label: tr('Open record'),
                  icon: UserRound,
                  onSelect: () => openInspector(contextMenu.student)
                },
                ...(onOpenRecord
                  ? [{ label: tr('Open full record'), icon: ClipboardListIcon, onSelect: () => onOpenRecord(contextMenu.student) }]
                  : []),
                {
                  label: tr('Copy reference'),
                  icon: Copy,
                  onSelect: () => navigator.clipboard?.writeText(`#${contextMenu.student.PERSON_ID}`)
                },
                { sep: true },
                {
                  label: tr('Edit student'),
                  icon: Edit2,
                  disabled: !canManage || !inScopeCategory(contextMenu.student.sectionData?.TEACHING_CATEGORY_ID),
                  onSelect: () => openEditModal(contextMenu.student)
                },
                {
                  label: tr('Assign section'),
                  icon: Layers,
                  disabled: !isAdmin,
                  onSelect: () => handleOpenSectionModal(contextMenu.student)
                },
                {
                  label: tr('Export report'),
                  icon: FileDown,
                  onSelect: () => setReportStudent(contextMenu.student)
                },
                ...(deletionAllowed
                  ? [
                      { sep: true },
                      {
                        label: tr('Delete student'),
                        icon: Trash2,
                        danger: true,
                        disabled: !canManage || !inScopeCategory(contextMenu.student.sectionData?.TEACHING_CATEGORY_ID),
                        onSelect: () => setConfirmTarget(Number(contextMenu.student.PERSON_ID))
                      }
                    ]
                  : [])
              ]
            : []
        }
      />

      <StudentReportDialog
        open={!!reportStudent}
        onClose={() => setReportStudent(null)}
        user={user}
        student={reportStudent}
      />

      <ConfirmDialog
        open={discardFormOpen}
        title={tr('Discard unsaved changes?')}
        message={tr('You have edits that have not been saved. Closing this form discards them.')}
        onCancel={() => setDiscardFormOpen(false)}
        onConfirm={() => { setDiscardFormOpen(false); setShowModal(false) }}
      />

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={currentStudent.PERSON_ID ? tr('Edit student details') : tr('Register new student')}
            className="my-auto w-full max-w-[880px] border border-line-strong bg-surface shadow-2xl"
          >
            <div className="flex h-11 items-center justify-between gap-3 border-b border-line bg-surface-muted px-4">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="kicker text-[9.5px] shrink-0">{tr('Student file')}</span>
                <h4 className="serif truncate text-[17px] leading-none text-ink">
                  {currentStudent.PERSON_ID ? tr('Edit student details') : tr('Register new student')}
                </h4>
              </div>
              <button
                type="button"
                onClick={requestCloseForm}
                aria-label={tr('Close')}
                className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 px-4 py-3">
              {saveError && (
                <div
                  className="border px-2.5 py-1.5 text-[11.5px]"
                  style={{
                    background: 'var(--color-danger-bg)',
                    borderColor: 'var(--color-danger)',
                    color: 'var(--color-danger-ink)'
                  }}
                >
                  {saveError}
                </div>
              )}
              {editLoading ? (
                <div className="flex items-center justify-center h-40 text-ink-3 text-sm font-medium">{tr("Loading student details…")}</div>
              ) : (
                <StudentCreateForm
                  identity={identity} setIdentity={setIdentity}
                  photo={photo} onChoosePhoto={choosePhoto} onClearPhoto={clearPhoto}
                  detail={detail} setDetail={setDetail}
                  conflicts={conflicts}
                  familyErrors={familyCountErrors(detail)}
                  grades={grades}
                  parents={parents} setParents={setParents}
                  contacts={contacts} setContacts={currentStudent.PERSON_ID ? onContactsChange : setContacts}
                  showEnrollment
                  isEditing={!!currentStudent.PERSON_ID}
                  newContact={newContact} setNewContact={setNewContact}
                  onAddContact={handleAddContact}
                  hobbySel={hobbySel} setHobbySel={setHobbySel}
                  geoSel={geoSel}
                  onWilayaChange={onWilayaChange}
                  onDairaChange={onDairaChange}
                  setGeoSel={setGeoSel}
                  wilayas={wilayas} dairas={dairas} communes={communes}
                  lookups={lookups}
                  sections={allowedSections}
                  restrictedScope={scope.restricted}
                  selectedSectionId={selectedSectionId}
                  setSelectedSectionId={setSelectedSectionId}
                  sectionHistory={sectionHistory}
                  // Uniforms and the personal address are collected at
                  // registration too, not only when an existing record is edited.
                  showUniforms
                  uniformSizeOptions={uniformSizeOptions}
                  combat={combat} setCombat={setCombat}
                  parade={parade} setParade={setParade}
                  addr={addr} setAddr={setAddr}
                  addrSel={addrSel} setAddrSel={setAddrSel}
                  addrDairas={addrDairas} addrCommunes={addrCommunes}
                  onAddrWilayaChange={onAddrWilayaChange}
                  onAddrDairaChange={onAddrDairaChange}
                  tab={createTab}
                  setTab={setCreateTab}
                />
              )}

              <div className="flex items-center justify-end gap-1.5 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={requestCloseForm}
                  className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted"
                >{tr('Cancel')}</button>
                <button
                  type="submit"
                  // Save waits until every unique number is confirmed free: a
                  // duplicate keeps the button disabled while it is corrected.
                  disabled={editLoading || checking || hasConflicts}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
                  style={{ color: 'var(--color-on-jade)' }}
                >
                  <Check size={13} strokeWidth={2.2} />
                  <span>{currentStudent.PERSON_ID ? tr('Save record') : tr('Register student')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSectionModal && selectedStudent && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tr('Manage sections')}
            className="my-auto w-full max-w-[460px] border border-line-strong bg-surface shadow-2xl"
          >
            <div className="flex h-11 items-center justify-between gap-3 border-b border-line bg-surface-muted px-4">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="kicker shrink-0 text-[9.5px]">{tr('Placement')}</span>
                <h4 className="serif truncate text-[16px] leading-none text-ink">
                  {personNameLastFirst(selectedStudent.PERSON_LAST_NAME, selectedStudent.PERSON_FIRST_NAME)}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setShowSectionModal(false)}
                aria-label={tr('Close')}
                className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface hover:text-ink"
              >
                <X size={14} />
              </button>
            </div>

            <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-3">
              {/* Teaching groups this student belongs to (read-only) */}
              <div className="border border-line bg-surface-muted/40 p-2.5">
                <div className="kicker mb-1.5 text-[9px]">{tr('Teaching groups')}</div>
                {studentGroups.length === 0 ? (
                  <p className="text-[11px] leading-relaxed text-ink-3">{tr('This student is not assigned to any teaching group. Assign groups per major and semester on the Sections page.')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {studentGroups.map((g) => (
                      <span
                        key={`${g.MAJOR_ID}-${g.STUDY_SEMESTER_ID}-${g.TEACHING_GROUP_ID}`}
                        className="inline-flex items-center gap-1 border border-line bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-2"
                        title={`${g.MAJOR_LABEL}${g.STUDY_SEMESTER_LABEL ? ' · ' + g.STUDY_SEMESTER_LABEL : ''}`}
                      >
                        {g.TEACHING_GROUP_LABEL}
                        <span className="text-ink-3">· {g.MAJOR_LABEL}{g.STUDY_SEMESTER_LABEL ? ` · ${g.STUDY_SEMESTER_LABEL}` : ''}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="field-label" htmlFor="section-category">{tr('Teaching category')}</label>
                <select
                  id="section-category"
                  value={selectedCategory || ''}
                  onChange={(e) => setSelectedCategory(e.target.value ? parseInt(e.target.value) : null)}
                  className="field"
                >
                  <option value="">{tr('Select a category')}</option>
                  {allowedCategories.map(category => (
                    <option key={category.TEACHING_CATEGORY_ID} value={category.TEACHING_CATEGORY_ID}>
                      {category.TEACHING_CATEGORY_LABEL}
                    </option>
                  ))}
                </select>
              </div>

              {selectedCategory ? (
                <div>
                  <div className="field-label">{tr('Section')}</div>
                  {allowedSections.filter(s => s.TEACHING_CATEGORY_ID === selectedCategory).length === 0 ? (
                    <p className="py-3 text-[11px] text-ink-3">{tr('No sections available in this category')}</p>
                  ) : (
                    <div className="border border-line">
                      {allowedSections.filter(s => s.TEACHING_CATEGORY_ID === selectedCategory).map(section => (
                        <label
                          key={section.SECTION_ID}
                          className="flex cursor-pointer items-center gap-2.5 border-b border-line px-2.5 py-1.5 last:border-b-0 hover:bg-surface-muted"
                        >
                          <input
                            type="radio"
                            name="section"
                            checked={studentSections.some(s => s.SECTION_ID === section.SECTION_ID)}
                            onChange={() => handleSectionSelect(section.SECTION_ID)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] text-ink">{section.SECTION_LABEL}</span>
                            {section.SECTION_CODE && (
                              <span className="mono block text-[9.5px] text-ink-3">{section.SECTION_CODE}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="py-3 text-center text-[11px] text-ink-3">{tr('Select a category to view sections')}</p>
              )}

              {studentSections.length > 0 && (
                <div className="border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={() => setConfirmRemoveSection(true)}
                    className="text-[11px] font-medium hover:underline"
                    style={{ color: 'var(--color-danger-ink)' }}
                  >{tr('Remove section assignment')}</button>
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-line px-4 py-2.5">
              <button
                type="button"
                onClick={() => setShowSectionModal(false)}
                className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted"
              >{tr('Done')}</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!confirmTarget}
        title={tr("Delete Student")}
        message={tr('Are you sure you want to delete this student? Their records will be permanently removed.')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => { const id = confirmTarget; setConfirmTarget(null); handleDelete(id) }}
      />
      <ConfirmDialog
        open={confirmRemovePhoto}
        title={tr('Remove photo')}
        message={tr('Remove this student photo? The image file is deleted from disk and cannot be recovered.')}
        confirmLabel={tr('Remove photo')}
        onCancel={() => setConfirmRemovePhoto(false)}
        onConfirm={() => { setConfirmRemovePhoto(false); removeInspectorPhoto() }}
      />
      <ConfirmDialog
        open={confirmRemoveSection}
        title={tr('Remove section assignment')}
        message={(() => {
          const name = selectedStudent
            ? `${selectedStudent.PERSON_FIRST_NAME || ''} ${selectedStudent.PERSON_LAST_NAME || ''}`.trim()
            : tr('This student')
          const current = studentSections.map(s => s.SECTION_LABEL).filter(Boolean).join(', ')
          return current
            ? tr('{name} will be left without a section until one is assigned again. Currently assigned to {section}.', { name, section: current })
            : tr('{name} will be left without a section until one is assigned again.', { name })
        })()}
        confirmLabel={tr('Remove section assignment')}
        onCancel={() => setConfirmRemoveSection(false)}
        onConfirm={() => { setConfirmRemoveSection(false); handleRemoveSection() }}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// Full-information registration form. Collects EVERY student-related field
// (identity, health & body, schooling/documents, family & parents, emergency
// contacts, hobbies, birth place, section) at insert time. All values live in
// the parent component; this component is purely presentational.
// ----------------------------------------------------------------------------
const StudentCreateForm = ({
  identity, setIdentity, photo, onChoosePhoto, onClearPhoto,
  detail, setDetail, parents, setParents, grades,
  // Duplicate-identifier answers from the parent's live check, per field.
  conflicts = {},
  familyErrors = {},
  contacts, setContacts, newContact, setNewContact, onAddContact,
  hobbySel, setHobbySel, geoSel, setGeoSel, onWilayaChange, onDairaChange,
  wilayas, dairas, communes, lookups, sections,
  selectedSectionId, setSelectedSectionId, sectionHistory = [], tab, setTab, restrictedScope, showEnrollment = true,
  showUniforms = false, isEditing = false,
  uniformSizeOptions = {},
  combat, setCombat, parade, setParade,
  addr, setAddr, addrSel, setAddrSel, addrDairas, addrCommunes,
  onAddrWilayaChange, onAddrDairaChange
}) => (
  <div className="space-y-4">
    {/* Tabs */}
    <div className="flex flex-wrap items-center gap-0.5 border-b border-line pb-0">
      {CREATE_TABS.filter(t => (showEnrollment || t.id !== 'enrollment') && (showUniforms || t.id !== 'uniforms') && !(t.id === 'contacts' && detail.STUDENT_IS_FOREIGN)).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          className={`-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 px-2.5 text-[11.5px] ${
            tab === id
              ? 'border-jade-500 text-ink'
              : 'border-transparent text-ink-3 hover:text-ink'
          }`}
        >
          <Icon size={12} strokeWidth={1.8} />
          {tr(label)}
        </button>
      ))}
    </div>

    {/* ---------------- IDENTITY ---------------- */}
    {tab === 'identity' && (
      <div className="space-y-4">
        <PhotoField photo={photo} onChoose={onChoosePhoto} onClear={onClearPhoto} />
        {/* person.person_id is typed in, not generated: twelve digits, the
            number the institution uses for the student. It is supplied at
            registration and can be corrected in the editor, where the change
            follows the student everywhere (11-person-id-manual.sql). */}
        <Field label={tr("Person ID")} error={conflictMessage(conflicts, 'PERSON_ID', tr)}>
          <input
            type="text"
            inputMode="numeric"
            maxLength={12}
            required
            className={formInputCls}
            placeholder={tr("12 digits")}
            value={identity.personId}
            onChange={e => setIdentity({ ...identity, personId: e.target.value.replace(/\D/g, '').slice(0, 12) })}
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={tr("First Name (Latin) *")}>
            <input type="text" required className={formInputCls} placeholder={tr("e.g. John")}
              value={identity.firstName}
              onChange={e => setIdentity({ ...identity, firstName: formatLatinFirstName(e.target.value) })} />
          </Field>
          <Field label={tr("First Name (Arabic)")}>
            <input type="text" dir="rtl" className={formInputCls} placeholder="مثال: محمد"
              value={identity.firstNameAr}
              onChange={e => setIdentity({ ...identity, firstNameAr: e.target.value })} />
          </Field>
          <Field label={tr("Last Name (Latin) *")}>
            <input type="text" required className={formInputCls} placeholder={tr("e.g. Doe")}
              value={identity.lastName}
              onChange={e => setIdentity({ ...identity, lastName: formatLatinLastName(e.target.value) })} />
          </Field>
          <Field label={tr("Last Name (Arabic)")}>
            <input type="text" dir="rtl" className={formInputCls} placeholder="مثال: بن علي"
              value={identity.lastNameAr}
              onChange={e => setIdentity({ ...identity, lastNameAr: e.target.value })} />
          </Field>
          <Field label={tr("Birthdate")}>
            <input type="date" className={formInputCls}
              value={identity.birthdate}
              onChange={e => setIdentity({ ...identity, birthdate: e.target.value })} />
          </Field>
          <Field label={tr("Sex")}>
            <div className="flex space-x-6 pt-1.5">
              {['M', 'F'].map(v => (
                <label key={v} className="flex items-center space-x-2 cursor-pointer text-sm font-semibold text-ink-2">
                  <input type="radio" name="create-sex" checked={identity.sex === v}
                    onChange={() => setIdentity({ ...identity, sex: v })}
                    className="w-4 h-4 text-blue-600" />
                  <span>{v === 'M' ? tr('Male') : tr('Female')}</span>
                </label>
              ))}
            </div>
          </Field>
          <Field label={tr("Military Grade")}>
            <select className={formInputCls} value={identity.gradeId}
              onChange={e => setIdentity({ ...identity, gradeId: e.target.value ? parseInt(e.target.value, 10) : '' })}>
              <option value="">{tr("None")}</option>
              {grades.map(g => (
                <option key={g.MILITARY_GRADE_ID} value={g.MILITARY_GRADE_ID}>
                  {localizedLabel(g, 'MILITARY_GRADE_NAME') || g.MILITARY_GRADE_NAME_EN}
                </option>
              ))}
            </select>
          </Field>
          <Field label={tr("Personal Phone")} error={conflictMessage(conflicts, 'STUDENT_PERSONAL_PHONE', tr)}>
            <input type="text" className={formInputCls} placeholder={tr("e.g. 0550 12 34 56")}
              value={detail.STUDENT_PERSONAL_PHONE || ''}
              onChange={e => setDetail({ ...detail, STUDENT_PERSONAL_PHONE: e.target.value })} />
          </Field>
          <Field label={tr("Foreign Student")}>
            <select className={formInputCls} value={detail.STUDENT_IS_FOREIGN ? 'Yes' : 'No'}
              onChange={e => setDetail({ ...detail, STUDENT_IS_FOREIGN: e.target.value === 'Yes' })}>
              {YES_NO.map(v => <option key={v} value={v}>{tr(v)}</option>)}
            </select>
          </Field>
        </div>

        <div className={formCardCls}>
          <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3">{tr("Birth Place")}</h6>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={tr("Wilaya")}>
              <select className={formInputCls} value={geoSel.wilayaId} onChange={e => onWilayaChange(e.target.value)}>
                <option value="">{tr("Select wilaya...")}</option>
                {wilayas.map(w => (
                  <option key={w.WILAYA_ID} value={w.WILAYA_ID}>{w.WILAYA_CODE} — {localizedLabel(w, 'WILAYA_NAME')}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("Daira")}>
              <select className={formInputCls} value={geoSel.dairaId} onChange={e => onDairaChange(e.target.value)} disabled={!geoSel.wilayaId}>
                <option value="">{tr("Select daira...")}</option>
                {dairas.map(dr => (
                  <option key={dr.DAIRA_ID} value={dr.DAIRA_ID}>{localizedLabel(dr, 'DAIRA_NAME')}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("Commune")}>
              <select className={formInputCls} value={geoSel.communeId}
                onChange={e => setGeoSel(g => ({ ...g, communeId: e.target.value }))}
                disabled={!geoSel.dairaId}>
                <option value="">{tr("Select commune...")}</option>
                {communes.map(cm => (
                  <option key={cm.COMMUNE_ID} value={cm.COMMUNE_ID}>{localizedLabel(cm, 'COMMUNE_NAME')}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </div>
    )}

    {/* ---------------- HEALTH & BODY ---------------- */}
    {tab === 'health' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Field label={tr("Blood Type")}>
          <select className={formInputCls} value={detail.STUDENT_BLOOD_TYPE || ''}
            onChange={e => setDetail({ ...detail, STUDENT_BLOOD_TYPE: e.target.value })}>
            <option value="">{tr("Unknown")}</option>
            {BLOOD_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label={tr("Health Status")}>
          <select className={formInputCls} value={detail.STUDENT_HEALTH_STATUS_ID || ''}
            onChange={e => setDetail({ ...detail, STUDENT_HEALTH_STATUS_ID: e.target.value })}>
            <option value="">{tr("Not specified")}</option>
            {(lookups?.healthStatuses || []).map(h => (
              <option key={h.HEALTH_STATUS_ID} value={h.HEALTH_STATUS_ID}>{localizedLabel(h, 'HEALTH_STATUS')}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("Height (cm)")}>
          <input type="number" step="0.01" min="140" max="240" placeholder="140 – 240"
            title={tr("Height must be between 140 and 240 cm")}
            className={formInputCls} value={detail.STUDENT_HEIGHT_CM || ''}
            onChange={e => setDetail({ ...detail, STUDENT_HEIGHT_CM: e.target.value })} />
        </Field>
        <Field label={tr("Weight (kg)")}>
          <input type="number" step="0.01" min="40" max="160" placeholder="40 – 160"
            title={tr("Weight must be between 40 and 160 kg")}
            className={formInputCls} value={detail.STUDENT_WEIGHT_KG || ''}
            onChange={e => setDetail({ ...detail, STUDENT_WEIGHT_KG: e.target.value })} />
        </Field>
        <Field label={tr("Military Necklace")}>
          <select className={formInputCls} value={detail.STUDENT_MILITARY_NECKLACE || 'No'}
            onChange={e => setDetail({ ...detail, STUDENT_MILITARY_NECKLACE: e.target.value })}>
            {YES_NO.map(v => <option key={v} value={v}>{tr(v)}</option>)}
          </select>
        </Field>
        <Field label={tr("Army / Force")}>
          <select className={formInputCls} value={detail.STUDENT_ARMY_ID || ''}
            onChange={e => setDetail({ ...detail, STUDENT_ARMY_ID: e.target.value })}>
            <option value="">{tr("Not specified")}</option>
            {(lookups?.armies || []).map(a => (
              <option key={a.ARMY_ID} value={a.ARMY_ID}>{localizedLabel(a, 'ARMY_LABEL') || localizedLabel(a, 'ARMY_NAME') || a.ARMY_ID}</option>
            ))}
          </select>
        </Field>
      </div>
    )}

    {/* ---------------- SCHOOLING & DOCUMENTS ---------------- */}
    {tab === 'schooling' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={tr("National Identification Number")} error={conflictMessage(conflicts, 'STUDENT_NATIONAL_IDENTIFICATION_NUMBER', tr)}>
          <input type="text" className={formInputCls} value={detail.STUDENT_NATIONAL_IDENTIFICATION_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_NATIONAL_IDENTIFICATION_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Birth Certificate Number")}>
          <input type="text" className={formInputCls} value={detail.STUDENT_BIRTHDATE_CERTIFICATE_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_BIRTHDATE_CERTIFICATE_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Postal Account Number")} error={conflictMessage(conflicts, 'STUDENT_POSTAL_ACCOUNT_NUMBER', tr)}>
          <input type="text" className={formInputCls} value={detail.STUDENT_POSTAL_ACCOUNT_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_POSTAL_ACCOUNT_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Laptop Serial Number")} error={conflictMessage(conflicts, 'STUDENT_LAPTOP_SERIAL_NUMBER', tr)}>
          <input type="text" className={formInputCls} value={detail.STUDENT_LAPTOP_SERIAL_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_LAPTOP_SERIAL_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Insurance Card Number")} error={conflictMessage(conflicts, 'STUDENT_INSURANCE_CARD_NUMBER', tr)}>
          <input type="text" maxLength={20} className={formInputCls} value={detail.STUDENT_INSURANCE_CARD_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_INSURANCE_CARD_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Military Card Number")} error={conflictMessage(conflicts, 'STUDENT_MILITARY_CARD_NUMBER', tr)}>
          <input type="text" maxLength={20} className={formInputCls} value={detail.STUDENT_MILITARY_CARD_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_MILITARY_CARD_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Military Helmet Number")} error={conflictMessage(conflicts, 'STUDENT_MILITARY_HELMET_NUMBER', tr)}>
          <input type="text" maxLength={14} className={formInputCls} value={detail.STUDENT_MILITARY_HELMET_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_MILITARY_HELMET_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Baccalaureate Sub Number")} error={conflictMessage(conflicts, 'STUDENT_BACCALAUREATE_SUB_NUMBER', tr)}>
          <input type="text" className={formInputCls} value={detail.STUDENT_BACCALAUREATE_SUB_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_BACCALAUREATE_SUB_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("School Submission Date")}>
          <input type="date" className={formInputCls} value={detail.STUDENT_SCHOOL_SUB_DATE || ''}
            onChange={e => setDetail({ ...detail, STUDENT_SCHOOL_SUB_DATE: e.target.value })} />
        </Field>
        <Field label={tr("School Submission Card Number")} error={conflictMessage(conflicts, 'STUDENT_SCHOOL_SUB_CARD_NUMBER', tr)}>
          <input type="text" className={formInputCls} value={detail.STUDENT_SCHOOL_SUB_CARD_NUMBER || ''}
            onChange={e => setDetail({ ...detail, STUDENT_SCHOOL_SUB_CARD_NUMBER: e.target.value })} />
        </Field>
        <Field label={tr("Educational Certificate")}>
          <select className={formInputCls} value={detail.EDUCATIONAL_CERTIFICATE_ID || ''}
            onChange={e => setDetail({ ...detail, EDUCATIONAL_CERTIFICATE_ID: e.target.value })}>
            <option value="">{tr("Not specified")}</option>
            {(lookups?.educationalCertificates || []).map(c => (
              <option key={c.EDUCATIONAL_CERTIFICATE_ID} value={c.EDUCATIONAL_CERTIFICATE_ID}>
                {localizedLabel(c, 'EDUCATIONAL_CERTIFICATE_LABEL') || c.EDUCATIONAL_CERTIFICATE_CODE}
              </option>
            ))}
          </select>
        </Field>
        <Field label={tr("Academic Level")}>
          <select className={formInputCls} value={detail.STUDENT_ACADEMIC_LEVEL_ID || ''}
            onChange={e => setDetail({ ...detail, STUDENT_ACADEMIC_LEVEL_ID: e.target.value })}>
            <option value="">{tr("Not specified")}</option>
            {(lookups?.academicLevels || []).map(l => (
              <option key={l.ACADEMIC_LEVEL_ID} value={l.ACADEMIC_LEVEL_ID}>{localizedLabel(l, 'ACADEMIC_LEVEL')}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("Speciality")}>
          <select className={formInputCls} value={detail.STUDENT_SPECIALITY_ID || ''}
            onChange={e => setDetail({ ...detail, STUDENT_SPECIALITY_ID: e.target.value })}>
            <option value="">{tr("Not specified")}</option>
            {(lookups?.specialities || []).map(s => (
              <option key={s.STUDENT_SPECIALITY_ID} value={s.STUDENT_SPECIALITY_ID}>{localizedLabel(s, 'SPECIALITY_NAME')}</option>
            ))}
          </select>
        </Field>
        <Field label={tr("Academic Average")}>
          <input type="number" step="0.01" min="0" max="20" className={formInputCls} value={detail.STUDENT_ACADEMIC_AVERAGE || ''}
            onChange={e => setDetail({ ...detail, STUDENT_ACADEMIC_AVERAGE: e.target.value })} />
        </Field>
        <Field label={tr("Recruitment Source")}>
          <select className={formInputCls} value={detail.STUDENT_RECRUITMENT_SOURCE_ID || ''}
            onChange={e => setDetail({ ...detail, STUDENT_RECRUITMENT_SOURCE_ID: e.target.value })}>
            <option value="">{tr("Not specified")}</option>
            {(lookups?.recruitmentSources || []).map(r => (
              <option key={r.RECRUITMENT_SOURCE_ID} value={r.RECRUITMENT_SOURCE_ID}>
                {localizedLabel(r, 'RECRUITMENT_SOURCE_LABEL')}
              </option>
            ))}
          </select>
        </Field>
      </div>
    )}

    {/* ---------------- FAMILY ---------------- */}
    {tab === 'family' && (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={tr("Siblings (total)")} error={familyErrors.STUDENT_NUMBER_OF_SIBLINGS}>
            <input type="number" min="0" className={formInputCls} value={detail.STUDENT_NUMBER_OF_SIBLINGS || ''}
              onChange={e => setDetail({ ...detail, STUDENT_NUMBER_OF_SIBLINGS: e.target.value })} />
          </Field>
          <Field label={tr("Sisters")} error={familyErrors.STUDENT_NUMBER_OF_SISTERS}>
            <input type="number" min="0" className={formInputCls} value={detail.STUDENT_NUMBER_OF_SISTERS || ''}
              onChange={e => setDetail({ ...detail, STUDENT_NUMBER_OF_SISTERS: e.target.value })} />
          </Field>
          <Field label={tr("Order Among Siblings")} error={familyErrors.STUDENT_ORDER_AMONG_SIBLINGS}>
            <input type="number" min="1" className={formInputCls} value={detail.STUDENT_ORDER_AMONG_SIBLINGS || ''}
              onChange={e => setDetail({ ...detail, STUDENT_ORDER_AMONG_SIBLINGS: e.target.value })} />
          </Field>
          <Field label={tr("Orphan Status")}>
            <select className={formInputCls} value={detail.STUDENT_ORPHAN_STATUS || 'None'}
              onChange={e => setDetail({ ...detail, STUDENT_ORPHAN_STATUS: e.target.value })}>
              {ORPHAN.map(v => <option key={v} value={v}>{tr(v)}</option>)}
            </select>
          </Field>
          <Field label={tr("Parents' Situation")}>
            <select className={formInputCls} value={detail.STUDENT_PARENTS_SITUATION || 'Married'}
              onChange={e => setDetail({ ...detail, STUDENT_PARENTS_SITUATION: e.target.value })}>
              {PARENTS_SIT.map(v => <option key={v} value={v}>{tr(v)}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={formCardCls}>
            <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3">{tr("Father")}</h6>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("First Name (LA)")}>
                <input type="text" className={formInputCls} value={parents.FATHER_FIRST_NAME_LA || ''}
                  onChange={e => setParents({ ...parents, FATHER_FIRST_NAME_LA: e.target.value })} />
              </Field>
              <Field label={tr("Last Name (LA)")}>
                <input type="text" className={formInputCls} value={parents.FATHER_LAST_NAME_LA || ''}
                  onChange={e => setParents({ ...parents, FATHER_LAST_NAME_LA: e.target.value })} />
              </Field>
              <Field label={tr("First Name (AR)")}>
                <input type="text" dir="rtl" className={formInputCls} value={parents.FATHER_FIRST_NAME_AR || ''}
                  onChange={e => setParents({ ...parents, FATHER_FIRST_NAME_AR: e.target.value })} />
              </Field>
              <Field label={tr("Last Name (AR)")}>
                <input type="text" dir="rtl" className={formInputCls} value={parents.FATHER_LAST_NAME_AR || ''}
                  onChange={e => setParents({ ...parents, FATHER_LAST_NAME_AR: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label={tr("Profession")}>
                  <select className={formInputCls} value={parents.FATHER_PROFESSION_ID || ''}
                    onChange={e => setParents({ ...parents, FATHER_PROFESSION_ID: e.target.value })}>
                    <option value="">{tr("Not specified")}</option>
                    {(lookups?.professions || []).map(p => (
                      <option key={p.PROFESSION_ID} value={p.PROFESSION_ID}>{localizedLabel(p, 'PROFESSION_NAME')}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </div>

          <div className={formCardCls}>
            <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3">{tr("Mother")}</h6>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("First Name (LA)")}>
                <input type="text" className={formInputCls} value={parents.MOTHER_FIRST_NAME_LA || ''}
                  onChange={e => setParents({ ...parents, MOTHER_FIRST_NAME_LA: e.target.value })} />
              </Field>
              <Field label={tr("Last Name (LA)")}>
                <input type="text" className={formInputCls} value={parents.MOTHER_LAST_NAME_LA || ''}
                  onChange={e => setParents({ ...parents, MOTHER_LAST_NAME_LA: e.target.value })} />
              </Field>
              <Field label={tr("First Name (AR)")}>
                <input type="text" dir="rtl" className={formInputCls} value={parents.MOTHER_FIRST_NAME_AR || ''}
                  onChange={e => setParents({ ...parents, MOTHER_FIRST_NAME_AR: e.target.value })} />
              </Field>
              <Field label={tr("Last Name (AR)")}>
                <input type="text" dir="rtl" className={formInputCls} value={parents.MOTHER_LAST_NAME_AR || ''}
                  onChange={e => setParents({ ...parents, MOTHER_LAST_NAME_AR: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label={tr("Profession")}>
                  <select className={formInputCls} value={parents.MOTHER_PROFESSION_ID || ''}
                    onChange={e => setParents({ ...parents, MOTHER_PROFESSION_ID: e.target.value })}>
                    <option value="">{tr("Not specified")}</option>
                    {(lookups?.professions || []).map(p => (
                      <option key={p.PROFESSION_ID} value={p.PROFESSION_ID}>{localizedLabel(p, 'PROFESSION_NAME')}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </div>
        </div>

      </div>
    )}

    {/* ---------------- HOBBIES ---------------- */}
    {/* Hobbies are independent ticks over a list long enough to scroll, so they
        get their own tab and a searchable picker instead of a row of chips at
        the foot of Family. */}
    {tab === 'hobbies' && (
      <div className={formCardCls}>
        <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3">{tr("Hobbies")}</h6>
        {(lookups?.hobbies || []).length === 0 ? (
          <span className="text-xs text-ink-3">{tr("No hobbies defined yet.")}</span>
        ) : (
          <MultiSelect
            values={hobbySel}
            onChange={setHobbySel}
            options={(lookups?.hobbies || []).map(h => ({ value: h.HOBBY_ID, label: localizedLabel(h, 'HOBBY_NAME') }))}
            placeholder={tr('Select hobbies')}
            emptyLabel={tr('No hobbies defined yet.')}
          />
        )}
      </div>
    )}

    {/* ---------------- EMERGENCY CONTACTS ---------------- */}
    {/* A foreign student keeps no emergency contacts, so the tab and its
        editor are hidden for them (see the tab list above). */}
    {tab === 'contacts' && !detail.STUDENT_IS_FOREIGN && (
      <div className="space-y-4">
        {contacts.filter(c => !(c.CONSULATE_NUMBER || c.CONSULATE_COUNTRY_ID)).length > 0 && (
          <div className="space-y-2">
            {contacts.filter(c => !(c.CONSULATE_NUMBER || c.CONSULATE_COUNTRY_ID)).map((c, idx) => (
              <div key={c.EMERGENCY_CONTACT_ID || `new-${idx}`} className="flex items-center justify-between bg-surface-muted/70 border border-line rounded-xl px-4 py-2.5">
                <div className="text-sm">
                  <span className="font-semibold text-ink">
                    {c.CONTACT_FIRST_NAME_LA} {c.CONTACT_LAST_NAME_LA}
                  </span>
                  {c.CONTACT_PHONE_NUMBER && <span className="text-ink-3"> · {c.CONTACT_PHONE_NUMBER}</span>}
                </div>
                <button type="button" onClick={() => setContacts(contacts.filter(x => x !== c))}
                  className="p-1.5 text-ink-3 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                  title={tr("Remove contact")}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={formCardCls}>
          <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3 inline-flex items-center gap-1.5">
            <Plus size={13} />{' '}{tr("Add Emergency Contact")}</h6>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label={tr("First Name")}>
              <input type="text" className={formInputCls} value={newContact.CONTACT_FIRST_NAME_LA}
                onChange={e => setNewContact({ ...newContact, CONTACT_FIRST_NAME_LA: e.target.value })} />
            </Field>
            <Field label={tr("Last Name")}>
              <input type="text" className={formInputCls} value={newContact.CONTACT_LAST_NAME_LA}
                onChange={e => setNewContact({ ...newContact, CONTACT_LAST_NAME_LA: e.target.value })} />
            </Field>
            <Field label={tr("Relation")}>
              <select className={formInputCls} value={newContact.CONTACT_RELATION_ID}
                onChange={e => setNewContact({ ...newContact, CONTACT_RELATION_ID: e.target.value })}>
                <option value="">{tr("Not specified")}</option>
                {(lookups?.relations || []).map(r => (
                  <option key={r.RELATION_ID} value={r.RELATION_ID}>{localizedLabel(r, 'RELATION_NAME')}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("Phone")}>
              <input type="text" className={formInputCls} value={newContact.CONTACT_PHONE_NUMBER}
                onChange={e => setNewContact({ ...newContact, CONTACT_PHONE_NUMBER: e.target.value })} />
            </Field>
            <Field label={tr("Consulate Number")}>
              <input type="text" className={formInputCls} value={newContact.CONSULATE_NUMBER}
                onChange={e => setNewContact({ ...newContact, CONSULATE_NUMBER: e.target.value })} />
            </Field>
          </div>
          <button type="button" onClick={onAddContact}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-500 transition-all cursor-pointer">
            <Plus size={13} />{' '}{tr("Add to list")}</button>
        </div>
      </div>
    )}

    {/* ---------------- UNIFORMS & ADDRESS ---------------- */}
    {tab === 'uniforms' && (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={formCardCls}>
            <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3">{tr("Combat Outfit")}</h6>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("1st Outfit Number")} error={conflictMessage(conflicts, 'FIRST_OUTFIT_NUMBER', tr)}>
                <input type="text" className={formInputCls} value={combat.FIRST_OUTFIT_NUMBER}
                  onChange={e => setCombat({ ...combat, FIRST_OUTFIT_NUMBER: e.target.value })} />
              </Field>
              <Field label={tr("1st Outfit Size")}>
                <UniformSizeSelect className={formInputCls}
                  options={uniformSizeOptions.COMBAT_OUTFIT_SIZE || []}
                  value={combat.FIRST_OUTFIT_SIZE}
                  onChange={size => setCombat({ ...combat, FIRST_OUTFIT_SIZE: size })} />
              </Field>
              <Field label={tr("2nd Outfit Number")} error={conflictMessage(conflicts, 'SECOND_OUTFIT_NUMBER', tr)}>
                <input type="text" className={formInputCls} value={combat.SECOND_OUTFIT_NUMBER}
                  onChange={e => setCombat({ ...combat, SECOND_OUTFIT_NUMBER: e.target.value })} />
              </Field>
              <Field label={tr("2nd Outfit Size")}>
                <UniformSizeSelect className={formInputCls}
                  options={uniformSizeOptions.COMBAT_OUTFIT_SIZE || []}
                  value={combat.SECOND_OUTFIT_SIZE}
                  onChange={size => setCombat({ ...combat, SECOND_OUTFIT_SIZE: size })} />
              </Field>
              <Field label={tr("Combat Shoe Size")}>
                <UniformSizeSelect className={formInputCls}
                  options={uniformSizeOptions.COMBAT_SHOE_SIZE || []}
                  value={combat.COMBAT_SHOE_SIZE}
                  onChange={size => setCombat({ ...combat, COMBAT_SHOE_SIZE: size })} />
              </Field>
            </div>
          </div>

          <div className={formCardCls}>
            <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3">{tr("Parade Uniform Sizes")}</h6>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PARADE_UNIFORM_FIELDS
                .filter(field => !(identity.sex === 'M' && FEMALE_ONLY_UNIFORM_KEYS.includes(field.key)))
                .map(field => (
                  <Field key={field.key} label={tr(field.label)}>
                    <UniformSizeSelect className={formInputCls}
                      options={uniformSizeOptions[field.kind] || []}
                      value={parade[field.key]}
                      onChange={size => setParade({ ...parade, [field.key]: size })} />
                  </Field>
                ))}
            </div>
            {identity.sex === 'M' ? (
              <p className="mt-2 text-[10px] text-ink-3 font-medium">
                {tr('A male student has no skirt sizes.')}
              </p>
            ) : null}
            {Object.keys(uniformSizeOptions).length === 0 ? (
              <p className="mt-2 text-[10px] text-amber-600 font-medium">
                {tr('No uniform sizes are defined yet. An administrator adds them in Settings → Registers → Uniform sizes.')}
              </p>
            ) : null}
          </div>
        </div>

        <div className={formCardCls}>
          <h6 className="text-xs font-bold text-ink-2 uppercase tracking-wider mb-3">{tr("Personal Address")}</h6>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={tr("Street (Latin)")}>
              <input type="text" className={formInputCls} placeholder={tr("e.g. 12 Rue des Freres...")}
                value={addr.ADDRESS_STREET_LA}
                onChange={e => setAddr({ ...addr, ADDRESS_STREET_LA: e.target.value })} />
            </Field>
            <Field label={tr("Street (Arabic)")}>
              <input type="text" dir="rtl" className={formInputCls} placeholder="مثال: 12 شارع الإخوة..."
                value={addr.ADDRESS_STREET_AR}
                onChange={e => setAddr({ ...addr, ADDRESS_STREET_AR: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <Field label={tr("Wilaya")}>
              <select className={formInputCls} value={addrSel.wilayaId} onChange={e => onAddrWilayaChange(e.target.value)}>
                <option value="">{tr("Select wilaya...")}</option>
                {wilayas.map(w => (
                  <option key={w.WILAYA_ID} value={w.WILAYA_ID}>{w.WILAYA_CODE} — {localizedLabel(w, 'WILAYA_NAME')}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("Daira")}>
              <select className={formInputCls} value={addrSel.dairaId} onChange={e => onAddrDairaChange(e.target.value)} disabled={!addrSel.wilayaId}>
                <option value="">{tr("Select daira...")}</option>
                {addrDairas.map(dr => (
                  <option key={dr.DAIRA_ID} value={dr.DAIRA_ID}>{localizedLabel(dr, 'DAIRA_NAME')}</option>
                ))}
              </select>
            </Field>
            <Field label={tr("Commune")}>
              <select className={formInputCls} value={addrSel.communeId}
                onChange={e => setAddrSel(s => ({ ...s, communeId: e.target.value }))} disabled={!addrSel.dairaId}>
                <option value="">{tr("Select commune...")}</option>
                {addrCommunes.map(cm => (
                  <option key={cm.COMMUNE_ID} value={cm.COMMUNE_ID}>{localizedLabel(cm, 'COMMUNE_NAME')}</option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-[10px] text-ink-3 mt-2 font-medium">{tr("Leave every field empty and save to remove the address. The street is stored in the address table together with the selected commune.")}</p>
        </div>
      </div>
    )}

    {/* ---------------- SECTION / ENROLLMENT ---------------- */}
    {tab === 'enrollment' && (
      <div className="space-y-3">
        <p className="text-xs text-ink-3 font-medium">
          {restrictedScope
            ? tr('Pick a section inside one of the teaching categories you are responsible for. It is required: the section is what places the student in your category.')
            : isEditing
              ? 'The section shown on this student’s card. Choosing another one moves the student; the teaching category follows the section. Clear the selection to leave the student unassigned.'
              : tr('Optionally assign the new student to a section. You can change this later by editing the student.')}
        </p>
        {sections.length === 0 ? (
          <p className="text-ink-3 text-sm py-4">
            {restrictedScope
              ? tr('No section is available in the teaching categories you are responsible for. Ask an administrator.')
              : tr('No sections available')}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
            {sections.map(section => (
              <label
                key={section.SECTION_ID}
                className={`flex items-center space-x-3 p-3 rounded-xl cursor-pointer transition-all border ${
                  String(selectedSectionId) === String(section.SECTION_ID)
                    ? 'bg-blue-50/70 border-blue-300'
                    : 'bg-surface-muted/50 hover:bg-surface-muted border-line'
                }`}
              >
                <input
                  type="radio"
                  name="create-section"
                  checked={String(selectedSectionId) === String(section.SECTION_ID)}
                  onChange={() => setSelectedSectionId(section.SECTION_ID)}
                  className="w-4 h-4 text-blue-600 border-line-strong focus:ring-blue-500/20 cursor-pointer"
                />
                <div className="cursor-pointer">
                  <div className="font-semibold text-ink text-sm">{section.SECTION_LABEL}</div>
                  {section.SECTION_CODE && (
                    <div className="text-xs text-ink-3">{section.SECTION_CODE}</div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
        {selectedSectionId && (
          <button type="button" onClick={() => setSelectedSectionId('')}
            className="text-red-600 hover:text-red-700 text-sm font-semibold hover:underline cursor-pointer">{tr("Clear selection")}</button>
        )}

        {/* Belonging is recorded, not overwritten: the open row is where the
            student is now, the rows below are the sections they came from. */}
        {isEditing && sectionHistory.length > 0 && (
          <div className={`${formCardCls} !p-0`}>
            <div className="flex items-baseline justify-between px-3 py-2 border-b border-line">
              <h6 className="serif text-[13.5px] leading-none text-ink">{tr('Section history')}</h6>
              <span className="kicker text-[9px]">{tr('Placements')}</span>
            </div>
            <ul className="divide-y divide-line">
              {sectionHistory.map(row => {
                const current = !row.ENDED_AT
                return (
                  <li key={row.STUDENT_SECTION_HISTORY_ID} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3 py-2">
                    <span className="mono w-[82px] shrink-0 text-[10.5px] tabular-nums text-ink-3">{formatDate(row.STARTED_AT)}</span>
                    <ChevronRight size={10} strokeWidth={2} className="shrink-0 text-ink-3" aria-hidden="true" />
                    <span className="mono w-[82px] shrink-0 text-[10.5px] tabular-nums text-ink-3">
                      {current ? tr('now') : formatDate(row.ENDED_AT)}
                    </span>
                    <span className={`text-[12.5px] ${current ? 'font-medium text-ink' : 'text-ink-2'}`}>
                      {row.SECTION_LABEL || row.SECTION_CODE || '—'}
                    </span>
                    {row.SECTION_CODE && <span className="mono text-[10px] text-ink-3">{row.SECTION_CODE}</span>}
                    <span className="ms-auto flex items-center gap-2 text-[10.5px] text-ink-3">
                      {row.TEACHING_CATEGORY_LABEL}
                      {current && <StateMark tone="good" className="text-[10px] text-success-ink">{tr('Current')}</StateMark>}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    )}
  </div>
)

export default StudentDirectory
