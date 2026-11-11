import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  X, Check, Save, UserRound, HeartPulse, FileText, Users, Phone,
  Shirt, AlertCircle, Plus, Trash2, ChevronRight, IdCard, List, ClipboardEdit, FileDown, Sparkles
} from 'lucide-react'
import FilterBar, { FilterField, FilterSearchField, filterInputCls } from './ui/FilterBar'
import StudentDirectory from './StudentDirectory'
import StudentReportDialog from './StudentReportDialog'
import { PageHeader, Panel, PanelHeader } from './ui/PageHeader'
import Button from './ui/Button'
import MultiSelect from './ui/MultiSelect'
import { formatLatinFirstName, formatLatinLastName } from '../../shared/personNames'
import { personIdError, personIdValue } from '../../shared/personId'
import { familyCountErrors, firstFamilyCountError } from '../../shared/studentDetailRules'
import { PARADE_UNIFORM_FIELDS, FEMALE_ONLY_UNIFORM_KEYS } from '../../shared/uniformSizes'
import UniformSizeSelect from './ui/UniformSizeSelect'
import { localizedLabel, tr } from '../i18n'
import { useDraft } from '../useDraft'

// Helpers --------------------------------------------------------------------

const toDateInput = (value) => {
  if (!value) return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const inputCls = 'h-9 w-full rounded-[4px] border border-line-strong bg-surface px-2.5 text-[12px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-jade-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-jade-500)_16%,transparent)] disabled:bg-surface-muted disabled:text-ink-3'
const labelCls = 'field-label'
const cardCls = 'rounded-[4px] border border-line bg-surface p-3.5'

import { useIdentifierConflicts, conflictMessage } from '../studentIdentifiers'
import { ipcErrorMessage } from '../ipcError'

// A duplicate identifier is refused under the field that holds it, before the
// user presses Save; the database constraint is the backstop.
const Field = ({ label, children, error }) => (
  <div>
    <label className={labelCls}>{label}</label>
    {children}
    {error ? (
      <p className="mt-1 text-[10.5px] leading-snug" style={{ color: 'var(--color-danger-ink)' }}>{error}</p>
    ) : null}
  </div>
)

const TABS = [
  { id: 'identity', label: 'Identity', icon: UserRound },
  { id: 'health', label: 'Health & Body', icon: HeartPulse },
  { id: 'documents', label: 'Documents & Schooling', icon: FileText },
  { id: 'family', label: 'Family', icon: Users },
  { id: 'hobbies', label: 'Hobbies', icon: Sparkles },
  { id: 'contacts', label: 'Emergency Contacts', icon: Phone },
  { id: 'uniforms', label: 'Uniforms', icon: Shirt }
]

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const YES_NO = ['Yes', 'No']
const ORPHAN = ['None', 'Father', 'Mother', 'Both']
const PARENTS_SIT = ['Married', 'Divorced', 'Separated', 'Widowed']

const StudentProfile = ({ user }) => {
  // Student selection
  const [students, setStudents] = useState([])
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')

  // Picker filters
  const [filterWilayas, setFilterWilayas] = useState([])
  const [filters, setFilters] = useState({
    sex: '', wilayaId: '', specialityId: '', academicLevelId: '', bloodType: ''
  })
  const activeFilterCount = Object.values(filters).filter(Boolean).length
  // Name search counts toward the Filters badge too.
  const recordFilterCount = activeFilterCount + (studentSearch ? 1 : 0)

  // Data
  const [lookups, setLookups] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState('')

  const [activeTab, setActiveTab] = useState('identity')

  // Top-level view: embedded Student Directory (from the old Students page)
  // or the full profile editor.
  const [view, setView] = useState('directory')
  // Director-only: printable report for the selected student.
  const [reportOpen, setReportOpen] = useState(false)

  // Draft state for the editable forms
  const [identity, setIdentity] = useState({ personId: '', firstName: '', lastName: '', birthdate: '', sex: 'M', gradeId: '' })
  const [detail, setDetail] = useState({})
  const [parents, setParents] = useState({})
  const [contacts, setContacts] = useState([])
  const [hobbySel, setHobbySel] = useState([])
  const [combat, setCombat] = useState({})
  const [parade, setParade] = useState({})
  // The sizes an administrator defined per uniform item, grouped by kind.
  const [uniformSizeOptions, setUniformSizeOptions] = useState({})

  // Live uniqueness check on every identifier the roster keeps unique.
  const { conflicts, checking } = useIdentifierConflicts({
    userId: user?.id,
    personId: selectedId ? parseInt(selectedId, 10) : null,
    // person_id is the record's key; a corrected one is checked against every
    // person, exactly like the registration and directory forms.
    values: { ...detail, ...combat, PERSON_ID: identity.personId },
    enabled: !!selectedId && !!user?.id
  })
  // A tab's save waits while its identifiers are being checked, and stays
  // disabled while one of them is still recorded for another student.
  const detailConflict = Object.keys(conflicts).some((key) => key.startsWith('STUDENT_'))
  const outfitConflict = !!(conflicts.FIRST_OUTFIT_NUMBER || conflicts.SECOND_OUTFIT_NUMBER)
  const personIdConflict = conflictMessage(conflicts, 'PERSON_ID', tr)
  const personIdChecking = checking && String(identity.personId ?? '').trim() !== String(selectedId)
  // The family counts have to agree with each other; each fault is shown under
  // the field that holds it on the Family tab.
  const familyErrors = familyCountErrors(detail)

  // Geo cascade for birth place
  const [wilayas, setWilayas] = useState([])
  const [dairas, setDairas] = useState([])
  const [communes, setCommunes] = useState([])
  const [geoSel, setGeoSel] = useState({ countryId: '', wilayaId: '', dairaId: '', communeId: '' })

  // Personal address (address table, referenced by
  // student_detail.student_personal_address_id). Has its own commune cascade.
  const [addr, setAddr] = useState({ ADDRESS_STREET_LA: '', ADDRESS_STREET_AR: '' })
  const [addrSel, setAddrSel] = useState({ wilayaId: '', dairaId: '', communeId: '' })
  const [addrDairas, setAddrDairas] = useState([])
  const [addrCommunes, setAddrCommunes] = useState([])

  // New-contact form
  const [newContact, setNewContact] = useState({
    CONTACT_FIRST_NAME_LA: '', CONTACT_LAST_NAME_LA: '', CONTACT_RELATION_ID: '',
    CONTACT_PHONE_NUMBER: '', CONSULATE_NUMBER: ''
  })

  useEffect(() => {
    loadInitial()
  }, [])

  const loadInitial = async () => {
    setLoading(true)
    try {
      const [optionsRes, lookupsRes, wilayasRes, sizesRes] = await Promise.all([
        window.api.getStudentRecordOptions(),
        window.api.getProfileLookups(),
        window.api.getProfileWilayas(),
        window.api.getUniformSizeOptions()
      ])
      // Enriched rows: person + student_detail + birth-place wilaya, students only
      setStudents(optionsRes?.data || [])
      setLookups(lookupsRes)
      setFilterWilayas(wilayasRes?.data || [])
      const grouped = {}
      for (const row of sizesRes?.data || []) {
        const kind = row.UNIFORM_SIZE_KIND || row.uniform_size_kind
        if (!kind) continue
        if (!grouped[kind]) grouped[kind] = []
        grouped[kind].push(row)
      }
      setUniformSizeOptions(grouped)
    } catch (err) {
      console.error('Failed to load initial data', err)
      setError(ipcErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const loadProfile = async (personId) => {
    if (!personId) {
      setProfile(null)
      return
    }
    setLoading(true)
    setError('')
    try {
      const prof = await window.api.getStudentProfile(user?.id, parseInt(personId, 10))
      setProfile(prof)

      const d = prof.detail || {}
      setIdentity({
        // The id lives on person and is edited with the rest of the identity.
        personId: String(d.PERSON_ID || personId || ''),
        firstName: d.PERSON_FIRST_NAME || '',
        lastName: d.PERSON_LAST_NAME || '',
        birthdate: toDateInput(d.PERSON_BIRTHDATE),
        sex: d.PERSON_SEX || 'M',
        gradeId: d.PERSON_GRADE_ID || ''
      })
      setDetail({
        STUDENT_BIRTH_DATE: toDateInput(d.STUDENT_BIRTH_DATE),
        STUDENT_BLOOD_TYPE: d.STUDENT_BLOOD_TYPE || '',
        STUDENT_PERSONAL_PHONE: d.STUDENT_PERSONAL_PHONE || '',
        STUDENT_HEIGHT_CM: d.STUDENT_HEIGHT_CM ?? '',
        STUDENT_WEIGHT_KG: d.STUDENT_WEIGHT_KG ?? '',
        STUDENT_IS_FOREIGN: d.STUDENT_IS_FOREIGN === true,
        STUDENT_ACADEMIC_AVERAGE: d.STUDENT_ACADEMIC_AVERAGE ?? '',
        STUDENT_SPECIALITY_ID: d.STUDENT_SPECIALITY_ID || '',
        STUDENT_ACADEMIC_LEVEL_ID: d.STUDENT_ACADEMIC_LEVEL_ID || '',
        STUDENT_BACCALAUREATE_SUB_NUMBER: d.STUDENT_BACCALAUREATE_SUB_NUMBER || '',
        STUDENT_SCHOOL_SUB_DATE: toDateInput(d.STUDENT_SCHOOL_SUB_DATE),
        STUDENT_SCHOOL_SUB_CARD_NUMBER: d.STUDENT_SCHOOL_SUB_CARD_NUMBER || '',
        STUDENT_LAPTOP_SERIAL_NUMBER: d.STUDENT_LAPTOP_SERIAL_NUMBER || '',
        STUDENT_BIRTHDATE_CERTIFICATE_NUMBER: d.STUDENT_BIRTHDATE_CERTIFICATE_NUMBER || '',
        STUDENT_NATIONAL_IDENTIFICATION_NUMBER: d.STUDENT_NATIONAL_IDENTIFICATION_NUMBER || '',
        STUDENT_POSTAL_ACCOUNT_NUMBER: d.STUDENT_POSTAL_ACCOUNT_NUMBER || '',
        STUDENT_INSURANCE_CARD_NUMBER: d.STUDENT_INSURANCE_CARD_NUMBER || '',
        STUDENT_MILITARY_CARD_NUMBER: d.STUDENT_MILITARY_CARD_NUMBER || '',
        STUDENT_MILITARY_HELMET_NUMBER: d.STUDENT_MILITARY_HELMET_NUMBER || '',
        STUDENT_HEALTH_STATUS_ID: d.STUDENT_HEALTH_STATUS_ID || '',
        STUDENT_MILITARY_NECKLACE: d.STUDENT_MILITARY_NECKLACE || tr('No'),
        STUDENT_NUMBER_OF_SIBLINGS: d.STUDENT_NUMBER_OF_SIBLINGS ?? '',
        STUDENT_NUMBER_OF_SISTERS: d.STUDENT_NUMBER_OF_SISTERS ?? '',
        STUDENT_ORDER_AMONG_SIBLINGS: d.STUDENT_ORDER_AMONG_SIBLINGS ?? '',
        STUDENT_ARMY_ID: d.STUDENT_ARMY_ID || '',
        STUDENT_ORPHAN_STATUS: d.STUDENT_ORPHAN_STATUS || tr('None'),
        STUDENT_PARENTS_SITUATION: d.STUDENT_PARENTS_SITUATION || tr('Married'),
        STUDENT_BIRTH_PLACE_ID: d.STUDENT_BIRTH_PLACE_ID || '',
        STUDENT_RECRUITMENT_SOURCE_ID: d.STUDENT_RECRUITMENT_SOURCE_ID ?? '',
        EDUCATIONAL_CERTIFICATE_ID: d.EDUCATIONAL_CERTIFICATE_ID || ''
      })
      setParents({
        FATHER_FIRST_NAME_LA: prof.parents?.FATHER_FIRST_NAME_LA || '',
        FATHER_LAST_NAME_LA: prof.parents?.FATHER_LAST_NAME_LA || '',
        FATHER_FIRST_NAME_AR: prof.parents?.FATHER_FIRST_NAME_AR || '',
        FATHER_LAST_NAME_AR: prof.parents?.FATHER_LAST_NAME_AR || '',
        FATHER_PROFESSION_ID: prof.parents?.FATHER_PROFESSION_ID || '',
        MOTHER_FIRST_NAME_LA: prof.parents?.MOTHER_FIRST_NAME_LA || '',
        MOTHER_LAST_NAME_LA: prof.parents?.MOTHER_LAST_NAME_LA || '',
        MOTHER_FIRST_NAME_AR: prof.parents?.MOTHER_FIRST_NAME_AR || '',
        MOTHER_LAST_NAME_AR: prof.parents?.MOTHER_LAST_NAME_AR || '',
        MOTHER_PROFESSION_ID: prof.parents?.MOTHER_PROFESSION_ID || ''
      })
      setContacts(prof.emergencyContacts || [])
      setHobbySel((prof.hobbies || []).map(h => h.HOBBY_ID))
      setCombat({
        FIRST_OUTFIT_NUMBER: prof.combatOutfit?.FIRST_OUTFIT_NUMBER || '',
        FIRST_OUTFIT_SIZE: prof.combatOutfit?.FIRST_OUTFIT_SIZE || '',
        SECOND_OUTFIT_NUMBER: prof.combatOutfit?.SECOND_OUTFIT_NUMBER || '',
        SECOND_OUTFIT_SIZE: prof.combatOutfit?.SECOND_OUTFIT_SIZE || '',
        COMBAT_SHOE_SIZE: prof.combatOutfit?.COMBAT_SHOE_SIZE || ''
      })
      setParade({
        SUMMER_JACKET_SIZE: prof.paradeUniform?.SUMMER_JACKET_SIZE || '',
        WINTER_JACKET_SIZE: prof.paradeUniform?.WINTER_JACKET_SIZE || '',
        SUMMER_TROUSERS_SIZE: prof.paradeUniform?.SUMMER_TROUSERS_SIZE || '',
        WINTER_TROUSERS_SIZE: prof.paradeUniform?.WINTER_TROUSERS_SIZE || '',
        SUMMER_SHIRT_SIZE: prof.paradeUniform?.SUMMER_SHIRT_SIZE || '',
        WINTER_SHIRT_SIZE: prof.paradeUniform?.WINTER_SHIRT_SIZE || '',
        SUMMER_HAT_SIZE: prof.paradeUniform?.SUMMER_HAT_SIZE || '',
        WINTER_HAT_SIZE: prof.paradeUniform?.WINTER_HAT_SIZE || '',
        SUMMER_SKIRT_SIZE: prof.paradeUniform?.SUMMER_SKIRT_SIZE || '',
        WINTER_SKIRT_SIZE: prof.paradeUniform?.WINTER_SKIRT_SIZE || ''
      })

      // Geo cascade: fetch all wilayas, then restore the saved birth place
      // (commune -> daira -> wilaya) into the dropdowns.
      setWilayas((await window.api.getProfileWilayas())?.data || [])
      const bp = prof.birthPlace
      if (bp?.COMMUNE_ID) {
        await onWilayaChange(String(bp.WILAYA_ID))
        await onDairaChange(String(bp.DAIRA_ID))
        setGeoSel(g => ({ ...g, communeId: String(bp.COMMUNE_ID) }))
      } else {
        setDairas([])
        setCommunes([])
        setGeoSel({ countryId: '', wilayaId: '', dairaId: '', communeId: '' })
      }

      // Restore the saved personal address (street + commune cascade).
      const pa = prof.personalAddress
      setAddr({
        ADDRESS_STREET_LA: pa?.ADDRESS_STREET_LA || '',
        ADDRESS_STREET_AR: pa?.ADDRESS_STREET_AR || ''
      })
      if (pa?.COMMUNE_ID) {
        await onAddrWilayaChange(String(pa.WILAYA_ID || ''))
        await onAddrDairaChange(String(pa.DAIRA_ID || ''))
        setAddrSel(s => ({ ...s, communeId: String(pa.COMMUNE_ID) }))
      } else {
        setAddrDairas([])
        setAddrCommunes([])
        setAddrSel({ wilayaId: '', dairaId: '', communeId: '' })
      }
      // The record as the server returned it. Anything the form holds that
      // differs from this signature is unsaved work worth keeping; waiting two
      // frames lets the updates above paint first.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        draftBaseline.current = latestDraftSignature.current
      }))
    } catch (err) {
      console.error('Failed to load profile', err)
      setError(ipcErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedId) loadProfile(selectedId)
  }, [selectedId])

  // A record being edited is kept on this computer as well: a refresh, a crash
  // or an outage at save time must not cost a page of typed details. Only what
  // differs from the record on the server is stored, and nothing is applied
  // without the user asking for it.
  const draftValue = { identity, detail, parents, addr, addrSel, geoSel, combat, parade }
  const draftSignature = useMemo(
    () => JSON.stringify(draftValue),
    [identity, detail, parents, addr, addrSel, geoSel, combat, parade]
  )
  // Signature of the record as loaded (or last saved); null until there is one.
  const draftBaseline = useRef(null)
  const latestDraftSignature = useRef(draftSignature)
  latestDraftSignature.current = draftSignature
  const {
    draft: profileDraft,
    restore: restoreProfileDraft,
    discard: discardProfileDraft,
    clear: clearProfileDraft
  } = useDraft({
    key: `student-profile:${selectedId || 'none'}`,
    userId: user?.id,
    value: draftValue,
    enabled: !!selectedId && draftBaseline.current !== null && draftSignature !== draftBaseline.current,
    reloadOn: selectedId,
    onRestore: (value) => {
      if (!value) return
      if (value.identity) setIdentity(value.identity)
      if (value.detail) setDetail(value.detail)
      if (value.parents) setParents(value.parents)
      if (value.addr) setAddr(value.addr)
      if (value.addrSel) setAddrSel(value.addrSel)
      if (value.geoSel) setGeoSel(value.geoSel)
      if (value.combat) setCombat(value.combat)
      if (value.parade) setParade(value.parade)
    }
  })

  const flashSaved = () => {
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1800)
    // What was just written is the server's record now, so the kept draft only
    // needs to hold whatever is still unsaved.
    draftBaseline.current = latestDraftSignature.current
    clearProfileDraft()
  }

  const selectedStudent = students.find(s => s.PERSON_ID === parseInt(selectedId, 10))
  const filteredStudentOptions = useMemo(() => {
    return students.filter(s => {
      if (studentSearch) {
        const name = `${s.PERSON_FIRST_NAME} ${s.PERSON_LAST_NAME}`.toLowerCase()
        if (!name.includes(studentSearch.toLowerCase())) return false
      }
      if (filters.sex && (s.PERSON_SEX || '') !== filters.sex) return false
      if (filters.wilayaId && String(s.BIRTH_WILAYA_ID || '') !== filters.wilayaId) return false
      if (filters.specialityId && String(s.STUDENT_SPECIALITY_ID || '') !== filters.specialityId) return false
      if (filters.academicLevelId && String(s.STUDENT_ACADEMIC_LEVEL_ID || '') !== filters.academicLevelId) return false
      if (filters.bloodType && (s.STUDENT_BLOOD_TYPE || '') !== filters.bloodType) return false
      return true
    })
  }, [students, studentSearch, filters])

  const studentPersonId = profile?.detail?.PERSON_ID || (selectedId ? Number(selectedId) : null)
  // Foreign students keep no emergency contacts, so their tab is hidden.
  const isForeignStudent = detail.STUDENT_IS_FOREIGN === true
  const initials = `${(identity.firstName || '?').charAt(0)}${(identity.lastName || '').charAt(0)}`.toUpperCase()

  // The selected student can change the visible tabs; never sit on a hidden one.
  useEffect(() => {
    if (isForeignStudent && activeTab === 'contacts') setActiveTab('identity')
  }, [isForeignStudent, activeTab])

  // ---- Save handlers -------------------------------------------------------

  const handleSaveAddress = async () => {
    if (!selectedId) return
    setSaving(true)
    try {
      await window.api.updateStudentPersonalAddress(user?.id, parseInt(selectedId, 10), {
        ADDRESS_STREET_LA: addr.ADDRESS_STREET_LA,
        ADDRESS_STREET_AR: addr.ADDRESS_STREET_AR,
        COMMUNE_ID: addrSel.communeId || null
      })
      flashSaved()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveIdentity = async () => {
    // person_id is typed in, so it can be corrected here: twelve digits, the
    // same rule the registration form applies.
    const typedId = String(identity.personId ?? '').trim()
    const idChanged = typedId !== String(selectedId)
    if (idChanged) {
      const problem = personIdError(typedId)
      if (problem) {
        setError(tr(problem))
        return
      }
      if (personIdChecking) return
      if (personIdConflict) {
        setError(personIdConflict)
        return
      }
    }
    setSaving(true)
    try {
      const res = await window.api.updateStudentProfileIdentity(user?.id, parseInt(selectedId, 10), {
        ...(idChanged ? { personId: personIdValue(typedId) } : {}),
        firstName: identity.firstName, lastName: identity.lastName,
        birthdate: identity.birthdate, sex: identity.sex, gradeId: identity.gradeId
      })
      // A corrected id is the record's new key, so the rest of this save and
      // the record loaded afterwards belong to it.
      const nextId = res?.PERSON_ID ?? (idChanged ? personIdValue(typedId) : selectedId)
      if (String(nextId) !== String(selectedId)) setSelectedId(String(nextId))
      await window.api.updateStudentProfileDetail(user?.id, parseInt(nextId, 10), {
        STUDENT_IS_FOREIGN: detail.STUDENT_IS_FOREIGN,
        STUDENT_BIRTH_PLACE_ID: geoSel.communeId || null
      })
      flashSaved()
      await loadProfile(nextId)
      // The picker lists the roster by id, so a corrected one has to be read
      // again — otherwise the list would keep pointing at the old number.
      if (idChanged) await loadInitial()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally { setSaving(false) }
  }

  const handleSaveDetail = async () => {
    // These buttons save without submitting a form, so the ranges the database
    // enforces are checked here as well.
    const outOfRange = (value, min, max) =>
      value !== '' && value !== null && value !== undefined &&
      (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max)
    const familyProblem = firstFamilyCountError(detail)
    if (familyProblem) {
      setError(tr(familyProblem))
      return
    }
    if (outOfRange(detail.STUDENT_HEIGHT_CM, 140, 240)) {
      setError(tr('Height must be between 140 and 240 cm.'))
      return
    }
    if (outOfRange(detail.STUDENT_WEIGHT_KG, 40, 160)) {
      setError(tr('Weight must be between 40 and 160 kg.'))
      return
    }
    // Only the identifiers this form writes; the outfit numbers are saved
    // from the Uniforms tab and its own save is what refuses them. The live
    // check also has to have answered before a save is allowed through.
    if (checking) return
    if (detailConflict) {
      setError(tr('Some numbers already belong to another student. Correct the highlighted fields first.'))
      return
    }
    setSaving(true)
    try {
      await window.api.updateStudentProfileDetail(user?.id, parseInt(selectedId, 10), {
        STUDENT_BIRTH_DATE: detail.STUDENT_BIRTH_DATE,
        STUDENT_BLOOD_TYPE: detail.STUDENT_BLOOD_TYPE,
        STUDENT_PERSONAL_PHONE: detail.STUDENT_PERSONAL_PHONE,
        STUDENT_HEIGHT_CM: detail.STUDENT_HEIGHT_CM,
        STUDENT_WEIGHT_KG: detail.STUDENT_WEIGHT_KG,
        STUDENT_IS_FOREIGN: detail.STUDENT_IS_FOREIGN,
        STUDENT_ACADEMIC_AVERAGE: detail.STUDENT_ACADEMIC_AVERAGE,
        STUDENT_SPECIALITY_ID: detail.STUDENT_SPECIALITY_ID,
        STUDENT_ACADEMIC_LEVEL_ID: detail.STUDENT_ACADEMIC_LEVEL_ID,
        STUDENT_BACCALAUREATE_SUB_NUMBER: detail.STUDENT_BACCALAUREATE_SUB_NUMBER,
        STUDENT_SCHOOL_SUB_DATE: detail.STUDENT_SCHOOL_SUB_DATE,
        STUDENT_SCHOOL_SUB_CARD_NUMBER: detail.STUDENT_SCHOOL_SUB_CARD_NUMBER,
        STUDENT_LAPTOP_SERIAL_NUMBER: detail.STUDENT_LAPTOP_SERIAL_NUMBER,
        STUDENT_BIRTHDATE_CERTIFICATE_NUMBER: detail.STUDENT_BIRTHDATE_CERTIFICATE_NUMBER,
        STUDENT_NATIONAL_IDENTIFICATION_NUMBER: detail.STUDENT_NATIONAL_IDENTIFICATION_NUMBER,
        STUDENT_POSTAL_ACCOUNT_NUMBER: detail.STUDENT_POSTAL_ACCOUNT_NUMBER,
        STUDENT_INSURANCE_CARD_NUMBER: detail.STUDENT_INSURANCE_CARD_NUMBER,
        STUDENT_MILITARY_CARD_NUMBER: detail.STUDENT_MILITARY_CARD_NUMBER,
        STUDENT_MILITARY_HELMET_NUMBER: detail.STUDENT_MILITARY_HELMET_NUMBER,
        STUDENT_HEALTH_STATUS_ID: detail.STUDENT_HEALTH_STATUS_ID,
        STUDENT_MILITARY_NECKLACE: detail.STUDENT_MILITARY_NECKLACE,
        STUDENT_NUMBER_OF_SIBLINGS: detail.STUDENT_NUMBER_OF_SIBLINGS,
        STUDENT_NUMBER_OF_SISTERS: detail.STUDENT_NUMBER_OF_SISTERS,
        STUDENT_ORDER_AMONG_SIBLINGS: detail.STUDENT_ORDER_AMONG_SIBLINGS,
        STUDENT_ARMY_ID: detail.STUDENT_ARMY_ID,
        STUDENT_ORPHAN_STATUS: detail.STUDENT_ORPHAN_STATUS,
        STUDENT_PARENTS_SITUATION: detail.STUDENT_PARENTS_SITUATION,
        STUDENT_BIRTH_PLACE_ID: geoSel.communeId || detail.STUDENT_BIRTH_PLACE_ID,
        STUDENT_RECRUITMENT_SOURCE_ID: detail.STUDENT_RECRUITMENT_SOURCE_ID || null,
        EDUCATIONAL_CERTIFICATE_ID: detail.EDUCATIONAL_CERTIFICATE_ID
      })
      flashSaved()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally { setSaving(false) }
  }

  const handleSaveParents = async () => {
    if (!studentPersonId) return
    setSaving(true)
    try {
      await window.api.updateStudentProfileParents(user?.id, studentPersonId, parents)
      flashSaved()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally { setSaving(false) }
  }

  const handleSaveHobbies = async (ids) => {
    if (!studentPersonId) return
    setHobbySel(ids)
    try {
      await window.api.setStudentProfileHobbies(user?.id, studentPersonId, ids)
      flashSaved()
    } catch (err) {
      setError(ipcErrorMessage(err))
    }
  }

  const handleSaveCombat = async () => {
    if (!studentPersonId) return
    // The two outfit numbers are unique across the roster: wait for the live
    // check, and refuse a duplicate the way the server would.
    if (checking) return
    if (outfitConflict) {
      setError(tr('Some numbers already belong to another student. Correct the highlighted fields first.'))
      return
    }
    setSaving(true)
    try {
      await window.api.updateStudentCombatOutfit(user?.id, studentPersonId, combat)
      flashSaved()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally { setSaving(false) }
  }

  const handleSaveParade = async () => {
    if (!studentPersonId) return
    // A male student has no skirt: those two sizes are cleared on save.
    const payload = identity.sex === 'M'
      ? { ...parade, SUMMER_SKIRT_SIZE: '', WINTER_SKIRT_SIZE: '' }
      : parade
    setSaving(true)
    try {
      await window.api.updateStudentParadeUniform(user?.id, studentPersonId, payload)
      flashSaved()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally { setSaving(false) }
  }

  const handleAddContact = async () => {
    if (!studentPersonId || !newContact.CONTACT_FIRST_NAME_LA) return
    setSaving(true)
    try {
      await window.api.addStudentEmergencyContact(user?.id, studentPersonId, newContact)
      setNewContact({ CONTACT_FIRST_NAME_LA: '', CONTACT_LAST_NAME_LA: '', CONTACT_RELATION_ID: '', CONTACT_PHONE_NUMBER: '', CONSULATE_NUMBER: '' })
      await loadProfile(selectedId)
      flashSaved()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally { setSaving(false) }
  }

  const handleDeleteContact = async (cid) => {
    try {
      await window.api.deleteStudentEmergencyContact(user?.id, cid)
      await loadProfile(selectedId)
    } catch (err) {
      setError(ipcErrorMessage(err))
    }
  }

  // Geo cascade handlers
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

  // Personal-address commune cascade (independent of the birth-place one).
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

  // Access rules for the Records tab:
  // - ADMIN: full editing
  // - DIRECTOR: read-only consultation
  // - Everyone else (incl. TEACHER, SECRETARY): no access to the Records tab
  const isAdmin = user?.roles?.includes('ADMIN')
  const isDirector = user?.roles?.includes('DIRECTOR')
  const canAccessRecords = isAdmin || isDirector
  const canEdit = isAdmin

  if (view !== 'directory' && loading && !profile) {
    return (
      <Panel>
        <div role="status" aria-live="polite" className="space-y-2 p-3.5">
          <span className="sr-only">{tr("Loading student profiles...")}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-8 rounded-[3px] bg-surface-muted" aria-hidden="true" />
          ))}
        </div>
      </Panel>
    )
  }

  // The directory owns its own masthead and fills the workspace. The full
  // record editor is a deeper view reached from the inspector.
  if (view === 'directory') {
    return (
      <StudentDirectory
        user={user}
        onOpenRecord={(student) => {
          setSelectedId(String(student.PERSON_ID))
          setView('records')
          loadProfile(student.PERSON_ID)
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        kicker={tr('Student file')}
        title={tr('Student record')}
        meta={selectedStudent ? `#${String(selectedStudent.PERSON_ID).padStart(4, '0')}` : undefined}
        actions={
          <>
            {savedFlash && (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-success/30 bg-success-bg px-2.5 text-[11px] text-success-ink">
                <Check size={12} /> {tr('All changes saved')}
              </span>
            )}
            {isDirector && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => setReportOpen(true)}
                disabled={!selectedStudent}
              >
                <FileDown size={12} /> {tr('Export report')}
              </Button>
            )}
            <Button size="md" onClick={() => setView('directory')}>
              <List size={12} /> {tr('Back to directory')}
            </Button>
          </>
        }
      />


      {view === 'records' && canAccessRecords && profileDraft && (
        <div className="flex flex-wrap items-center gap-3 rounded-[4px] border border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
          <span>
            {tr('Unsaved edits from {when} are saved on this computer.', {
              when: new Date(profileDraft.savedAt).toLocaleString()
            })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={restoreProfileDraft}
              className="rounded-[3px] border border-amber-400 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100"
            >
              {tr('Restore')}
            </button>
            <button
              type="button"
              onClick={discardProfileDraft}
              className="rounded-[3px] px-2 py-0.5 underline-offset-2 hover:underline"
            >
              {tr('Discard')}
            </button>
          </div>
        </div>
      )}

      {view === 'records' && canAccessRecords && error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[4px] border border-line px-3 py-2.5 text-[11.5px] leading-relaxed"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }}
        >
          <AlertCircle size={13} strokeWidth={1.9} className="mt-px shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {view === 'records' && canAccessRecords && (<>

      {/* Student picker */}
      <Panel>
        <PanelHeader
          title={tr('Student')}
          meta={tr('{count} available', { count: filteredStudentOptions.length })}
        />
        <div className="p-3.5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label className={labelCls}>{tr("Student")}</label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className={inputCls}
              >
                <option value="">{tr("-- Choose a student --")}</option>
                {filteredStudentOptions.map(s => (
                  <option key={s.PERSON_ID} value={s.PERSON_ID}>
                    {s.PERSON_FIRST_NAME} {s.PERSON_LAST_NAME}
                  </option>
                ))}
              </select>
            </div>
            <FilterBar
              activeCount={recordFilterCount}
              onClear={() => {
                setFilters({ sex: '', wilayaId: '', specialityId: '', academicLevelId: '', bloodType: '' })
                setStudentSearch('')
              }}
              matchCount={filteredStudentOptions.length}
              matchLabel="student"
              title={tr("Filter Students")}
            >
              <FilterSearchField
                placeholder={tr("Search by name...")}
                value={studentSearch}
                onChange={(v) => setStudentSearch(v)}
              />
              <FilterField label={tr("Sex")}>
                <select className={filterInputCls} value={filters.sex}
                  onChange={e => setFilters(f => ({ ...f, sex: e.target.value }))}>
                  <option value="">{tr("All")}</option>
                  <option value="M">{tr("Male")}</option>
                  <option value="F">{tr("Female")}</option>
                </select>
              </FilterField>
              <FilterField label={tr("Birth Wilaya")}>
                <select className={filterInputCls} value={filters.wilayaId}
                  onChange={e => setFilters(f => ({ ...f, wilayaId: e.target.value }))}>
                  <option value="">{tr("All")}</option>
                  {filterWilayas.map(w => (
                    <option key={w.WILAYA_ID} value={w.WILAYA_ID}>{w.WILAYA_CODE} — {localizedLabel(w, 'WILAYA_NAME')}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label={tr("Speciality")}>
                <select className={filterInputCls} value={filters.specialityId}
                  onChange={e => setFilters(f => ({ ...f, specialityId: e.target.value }))}>
                  <option value="">{tr("All")}</option>
                  {(lookups?.specialities || []).map(s => (
                    <option key={s.STUDENT_SPECIALITY_ID} value={s.STUDENT_SPECIALITY_ID}>
                      {localizedLabel(s, 'SPECIALITY_NAME')}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label={tr("Academic Level")}>
                <select className={filterInputCls} value={filters.academicLevelId}
                  onChange={e => setFilters(f => ({ ...f, academicLevelId: e.target.value }))}>
                  <option value="">{tr("All")}</option>
                  {(lookups?.academicLevels || []).map(l => (
                    <option key={l.ACADEMIC_LEVEL_ID} value={l.ACADEMIC_LEVEL_ID}>{localizedLabel(l, 'ACADEMIC_LEVEL')}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label={tr("Blood Type")}>
                <select className={filterInputCls} value={filters.bloodType}
                  onChange={e => setFilters(f => ({ ...f, bloodType: e.target.value }))}>
                  <option value="">{tr("All")}</option>
                  {BLOOD_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </FilterField>
            </FilterBar>
          </div>

          <p className="mt-2 text-[10.5px] text-ink-3">
            {tr('{count} students available — use the Filters button to refine the list.', { count: filteredStudentOptions.length })}
          </p>
        </div>
      </Panel>

      {!selectedStudent ? (
        <Panel>
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <IdCard size={22} strokeWidth={1.8} className="text-ink-3" aria-hidden="true" />
            <h2 className="serif mt-3 text-[20px] leading-tight text-ink">{tr("Select a Student")}</h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-ink-3">{tr("Choose a student above to view and edit their complete personal record.")}</p>
          </div>
        </Panel>
      ) : (
        <>
          {/* Identity strip: the facts a reader needs before touching a field. */}
          <Panel className="flex flex-col gap-3 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="grid h-16 w-16 shrink-0 place-items-center rounded-[3px] border border-line-strong bg-surface-muted text-[18px] font-semibold text-ink-2"
                aria-hidden="true"
              >
                {initials}
              </div>
              <div className="min-w-0">
                <div className="mono text-[9.5px] text-ink-3">
                  {profile?.detail?.PERSON_ID ? `№ ${String(profile.detail.PERSON_ID).padStart(4, '0')}` : tr('No person id')}
                </div>
                <h2 className="serif truncate text-[22px] leading-[26px] text-ink">
                  {identity.firstName} {identity.lastName}
                </h2>
              </div>
            </div>
            <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 sm:justify-end">
              <div>
                <dt className="kicker text-[9px]">{tr("Sex")}</dt>
                <dd className="mt-0.5 text-[12px] text-ink">{identity.sex === 'F' ? tr('Female') : tr('Male')}</dd>
              </div>
              <div>
                <dt className="kicker text-[9px]">{tr("Birthdate")}</dt>
                <dd className="mono mt-0.5 text-[11.5px] text-ink">{identity.birthdate || '—'}</dd>
              </div>
              <div>
                <dt className="kicker text-[9px]">{tr("Blood")}</dt>
                <dd className="mt-0.5 text-[12px] text-ink">{detail.STUDENT_BLOOD_TYPE || '—'}</dd>
              </div>
            </dl>
          </Panel>

          {/* Tabs and the plate they switch between */}
          <Panel>
          <div role="tablist" aria-label={tr('Sections')} className="flex gap-1 overflow-x-auto border-b border-line bg-surface-muted px-1.5">
            {TABS.filter(t => !(t.id === 'contacts' && isForeignStudent)).map(({ id, label, icon: Icon }) => {
              const active = activeTab === id
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(id)}
                  className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-[11.5px] font-medium transition-colors ${
                    active ? 'border-jade-500 text-ink' : 'border-transparent text-ink-3 hover:text-ink'
                  }`}
                >
                  <Icon size={13} strokeWidth={1.8} aria-hidden="true" />
                  {tr(label)}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <div className="p-3.5">
            {!canEdit ? (
              <div className="flex items-start gap-2 rounded-[4px] border border-line bg-surface px-3 py-3 text-[11.5px] leading-relaxed text-ink-2">
                <AlertCircle size={14} strokeWidth={1.8} className="mt-px shrink-0 text-ink-3" aria-hidden="true" />
                <span>{tr("You do not have permission to edit student records.")}</span>
              </div>
            ) : (
              <>
                {/* ---------------- IDENTITY ---------------- */}
                {activeTab === 'identity' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label={tr("Person ID")} error={personIdConflict}>
                        <input type="text" inputMode="numeric" maxLength={12} className={inputCls}
                          placeholder={tr("12 digits")} value={identity.personId}
                          aria-invalid={!!personIdConflict}
                          onChange={e => setIdentity({ ...identity, personId: e.target.value.replace(/\D/g, '').slice(0, 12) })} />
                      </Field>
                      <Field label={tr("First Name")}>
                        <input type="text" className={inputCls} value={identity.firstName}
                          onChange={e => setIdentity({ ...identity, firstName: formatLatinFirstName(e.target.value) })} />
                      </Field>
                      <Field label={tr("Last Name")}>
                        <input type="text" className={inputCls} value={identity.lastName}
                          onChange={e => setIdentity({ ...identity, lastName: formatLatinLastName(e.target.value) })} />
                      </Field>
                      <Field label={tr("Birthdate")}>
                        <input type="date" className={inputCls} value={identity.birthdate}
                          onChange={e => setIdentity({ ...identity, birthdate: e.target.value })} />
                      </Field>
                      <Field label={tr("Sex")}>
                        <div className="flex space-x-6 pt-1.5">
                          {['M', 'F'].map(v => (
                            <label key={v} className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-2">
                              <input type="radio" name="sex" checked={identity.sex === v}
                                onChange={() => setIdentity({ ...identity, sex: v })}
                                className="h-3.5 w-3.5 accent-[var(--color-jade-600)]" />
                              <span>{v === 'M' ? tr('Male') : tr('Female')}</span>
                            </label>
                          ))}
                        </div>
                      </Field>
                      <Field label={tr("Military Grade")}>
                        <select className={inputCls} value={identity.gradeId || ''}
                          onChange={e => setIdentity({ ...identity, gradeId: e.target.value ? parseInt(e.target.value, 10) : '' })}>
                          <option value="">{tr("None")}</option>
                          {(lookups?.grades || []).map(g => (
                            <option key={g.MILITARY_GRADE_ID} value={g.MILITARY_GRADE_ID}>
                              {localizedLabel(g, 'MILITARY_GRADE_NAME') || g.MILITARY_GRADE_NAME_EN}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={tr("Personal Phone")} error={conflictMessage(conflicts, 'STUDENT_PERSONAL_PHONE', tr)}>
                        <input type="text" className={inputCls} value={detail.STUDENT_PERSONAL_PHONE}
                          onChange={e => setDetail({ ...detail, STUDENT_PERSONAL_PHONE: e.target.value })} placeholder={tr("e.g. 0550 12 34 56")} />
                      </Field>
                      <Field label={tr("Foreign Student")}>
                        <select className={inputCls} value={detail.STUDENT_IS_FOREIGN ? 'Yes' : 'No'}
                          onChange={e => setDetail({ ...detail, STUDENT_IS_FOREIGN: e.target.value === 'Yes' })}>
                          {YES_NO.map(v => <option key={v} value={v}>{tr(v)}</option>)}
                        </select>
                      </Field>
                    </div>

                    <div className={cardCls}>
                      <h3 className="kicker mb-3 text-[9px]">{tr("Birth Place")}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Field label={tr("Wilaya")}>
                          <select className={inputCls} value={geoSel.wilayaId} onChange={e => onWilayaChange(e.target.value)}>
                            <option value="">{tr("Select wilaya...")}</option>
                            {wilayas.map(w => (
                              <option key={w.WILAYA_ID} value={w.WILAYA_ID}>{w.WILAYA_CODE} — {localizedLabel(w, 'WILAYA_NAME')}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr("Daira")}>
                          <select className={inputCls} value={geoSel.dairaId} onChange={e => onDairaChange(e.target.value)} disabled={!geoSel.wilayaId}>
                            <option value="">{tr("Select daira...")}</option>
                            {dairas.map(d => (
                              <option key={d.DAIRA_ID} value={d.DAIRA_ID}>{localizedLabel(d, 'DAIRA_NAME')}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr("Commune")}>
                          <select className={inputCls} value={geoSel.communeId}
                            onChange={e => setGeoSel(g => ({ ...g, communeId: e.target.value }))}
                            disabled={!geoSel.dairaId}>
                            <option value="">{tr("Select commune...")}</option>
                            {communes.map(c => (
                              <option key={c.COMMUNE_ID} value={c.COMMUNE_ID}>{localizedLabel(c, 'COMMUNE_NAME')}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">{tr("Daira/commune reference data is administered in the database; currently seeded wilayas are selectable. Save stores the selected commune as birth place.")}</p>
                    </div>

                    {/* Personal address (address table) */}
                    <div className={cardCls}>
                      <h3 className="kicker mb-3 text-[9px]">{tr("Personal Address")}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field label={tr("Street (Latin)")}>
                          <input type="text" className={inputCls} placeholder={tr("e.g. 12 Rue des Frères...")}
                            value={addr.ADDRESS_STREET_LA} readOnly={!canEdit}
                            onChange={e => setAddr({ ...addr, ADDRESS_STREET_LA: e.target.value })} />
                        </Field>
                        <Field label={tr("Street (Arabic)")}>
                          <input type="text" dir="rtl" className={inputCls} placeholder="مثال: 12 شارع الإخوة..."
                            value={addr.ADDRESS_STREET_AR} readOnly={!canEdit}
                            onChange={e => setAddr({ ...addr, ADDRESS_STREET_AR: e.target.value })} />
                        </Field>
                        <Field label={tr("Wilaya")}>
                          <select className={inputCls} value={addrSel.wilayaId}
                            onChange={e => onAddrWilayaChange(e.target.value)} disabled={!canEdit}>
                            <option value="">{tr("Select wilaya...")}</option>
                            {wilayas.map(w => (
                              <option key={w.WILAYA_ID} value={w.WILAYA_ID}>{w.WILAYA_CODE} — {localizedLabel(w, 'WILAYA_NAME')}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr("Daira")}>
                          <select className={inputCls} value={addrSel.dairaId}
                            onChange={e => onAddrDairaChange(e.target.value)} disabled={!canEdit || !addrSel.wilayaId}>
                            <option value="">{tr("Select daira...")}</option>
                            {addrDairas.map(d => (
                              <option key={d.DAIRA_ID} value={d.DAIRA_ID}>{localizedLabel(d, 'DAIRA_NAME')}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr("Commune")}>
                          <select className={inputCls} value={addrSel.communeId}
                            onChange={e => setAddrSel(s => ({ ...s, communeId: e.target.value }))}
                            disabled={!canEdit || !addrSel.dairaId}>
                            <option value="">{tr("Select commune...")}</option>
                            {addrCommunes.map(c => (
                              <option key={c.COMMUNE_ID} value={c.COMMUNE_ID}>{localizedLabel(c, 'COMMUNE_NAME')}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <p className="mt-2 text-[10px] leading-relaxed text-ink-3">{tr("Leave every field empty and save to remove the address. The street is stored in the address table together with the selected commune.")}</p>
                    </div>

                    {canEdit && (
                      <div className="flex flex-wrap justify-end gap-2">
                        <SaveButton onClick={handleSaveAddress} saving={saving} label={tr('Save address')} />
                        <SaveButton onClick={handleSaveIdentity} saving={saving} disabled={personIdChecking || !!personIdConflict} label={tr('Save identity')} />
                      </div>
                    )}
                  </div>
                )}

                {/* ---------------- HEALTH ---------------- */}
                {activeTab === 'health' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <Field label={tr("Blood Type")}>
                        <select className={inputCls} value={detail.STUDENT_BLOOD_TYPE}
                          onChange={e => setDetail({ ...detail, STUDENT_BLOOD_TYPE: e.target.value })}>
                          <option value="">{tr("Unknown")}</option>
                          {BLOOD_TYPES.map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </Field>
                      <Field label={tr("Health Status")}>
                        <select className={inputCls} value={detail.STUDENT_HEALTH_STATUS_ID}
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
                          className={inputCls} value={detail.STUDENT_HEIGHT_CM}
                          onChange={e => setDetail({ ...detail, STUDENT_HEIGHT_CM: e.target.value })} />
                      </Field>
                      <Field label={tr("Weight (kg)")}>
                        <input type="number" step="0.01" min="40" max="160" placeholder="40 – 160"
                          title={tr("Weight must be between 40 and 160 kg")}
                          className={inputCls} value={detail.STUDENT_WEIGHT_KG}
                          onChange={e => setDetail({ ...detail, STUDENT_WEIGHT_KG: e.target.value })} />
                      </Field>
                      <Field label={tr("Military Necklace")}>
                        <select className={inputCls} value={detail.STUDENT_MILITARY_NECKLACE}
                          onChange={e => setDetail({ ...detail, STUDENT_MILITARY_NECKLACE: e.target.value })}>
                          {YES_NO.map(v => <option key={v} value={v}>{tr(v)}</option>)}
                        </select>
                      </Field>
                      <Field label={tr("Army / Force")}>
                        <select className={inputCls} value={detail.STUDENT_ARMY_ID}
                          onChange={e => setDetail({ ...detail, STUDENT_ARMY_ID: e.target.value })}>
                          <option value="">{tr("Not specified")}</option>
                          {(lookups?.armies || []).map(a => (
                            <option key={a.ARMY_ID} value={a.ARMY_ID}>{localizedLabel(a, 'ARMY_LABEL') || localizedLabel(a, 'ARMY_NAME') || a.ARMY_ID}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    {canEdit && <SaveButton onClick={handleSaveDetail} saving={saving} disabled={checking || detailConflict} />}
                  </div>
                )}

                {/* ---------------- DOCUMENTS ---------------- */}
                {activeTab === 'documents' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label={tr("National Identification Number")} error={conflictMessage(conflicts, 'STUDENT_NATIONAL_IDENTIFICATION_NUMBER', tr)}>
                        <input type="text" className={inputCls} value={detail.STUDENT_NATIONAL_IDENTIFICATION_NUMBER}
                          onChange={e => setDetail({ ...detail, STUDENT_NATIONAL_IDENTIFICATION_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Birth Certificate Number")}>
                        <input type="text" className={inputCls} value={detail.STUDENT_BIRTHDATE_CERTIFICATE_NUMBER}
                          onChange={e => setDetail({ ...detail, STUDENT_BIRTHDATE_CERTIFICATE_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Postal Account Number")} error={conflictMessage(conflicts, 'STUDENT_POSTAL_ACCOUNT_NUMBER', tr)}>
                        <input type="text" className={inputCls} value={detail.STUDENT_POSTAL_ACCOUNT_NUMBER}
                          onChange={e => setDetail({ ...detail, STUDENT_POSTAL_ACCOUNT_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Laptop Serial Number")} error={conflictMessage(conflicts, 'STUDENT_LAPTOP_SERIAL_NUMBER', tr)}>
                        <input type="text" className={inputCls} value={detail.STUDENT_LAPTOP_SERIAL_NUMBER}
                          onChange={e => setDetail({ ...detail, STUDENT_LAPTOP_SERIAL_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Insurance Card Number")} error={conflictMessage(conflicts, 'STUDENT_INSURANCE_CARD_NUMBER', tr)}>
                        <input type="text" maxLength={20} className={inputCls} value={detail.STUDENT_INSURANCE_CARD_NUMBER || ''}
                          onChange={e => setDetail({ ...detail, STUDENT_INSURANCE_CARD_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Military Card Number")} error={conflictMessage(conflicts, 'STUDENT_MILITARY_CARD_NUMBER', tr)}>
                        <input type="text" maxLength={20} className={inputCls} value={detail.STUDENT_MILITARY_CARD_NUMBER || ''}
                          onChange={e => setDetail({ ...detail, STUDENT_MILITARY_CARD_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Military Helmet Number")} error={conflictMessage(conflicts, 'STUDENT_MILITARY_HELMET_NUMBER', tr)}>
                        <input type="text" maxLength={14} className={inputCls} value={detail.STUDENT_MILITARY_HELMET_NUMBER || ''}
                          onChange={e => setDetail({ ...detail, STUDENT_MILITARY_HELMET_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Baccalaureate Sub Number")} error={conflictMessage(conflicts, 'STUDENT_BACCALAUREATE_SUB_NUMBER', tr)}>
                        <input type="text" className={inputCls} value={detail.STUDENT_BACCALAUREATE_SUB_NUMBER}
                          onChange={e => setDetail({ ...detail, STUDENT_BACCALAUREATE_SUB_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("School Submission Date")}>
                        <input type="date" className={inputCls} value={detail.STUDENT_SCHOOL_SUB_DATE}
                          onChange={e => setDetail({ ...detail, STUDENT_SCHOOL_SUB_DATE: e.target.value })} />
                      </Field>
                      <Field label={tr("School Submission Card Number")} error={conflictMessage(conflicts, 'STUDENT_SCHOOL_SUB_CARD_NUMBER', tr)}>
                        <input type="text" className={inputCls} value={detail.STUDENT_SCHOOL_SUB_CARD_NUMBER}
                          onChange={e => setDetail({ ...detail, STUDENT_SCHOOL_SUB_CARD_NUMBER: e.target.value })} />
                      </Field>
                      <Field label={tr("Educational Certificate")}>
                        <select className={inputCls} value={detail.EDUCATIONAL_CERTIFICATE_ID}
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
                        <select className={inputCls} value={detail.STUDENT_ACADEMIC_LEVEL_ID}
                          onChange={e => setDetail({ ...detail, STUDENT_ACADEMIC_LEVEL_ID: e.target.value })}>
                          <option value="">{tr("Not specified")}</option>
                          {(lookups?.academicLevels || []).map(l => (
                            <option key={l.ACADEMIC_LEVEL_ID} value={l.ACADEMIC_LEVEL_ID}>
                              {localizedLabel(l, 'ACADEMIC_LEVEL')}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={tr("Speciality")}>
                        <select className={inputCls} value={detail.STUDENT_SPECIALITY_ID}
                          onChange={e => setDetail({ ...detail, STUDENT_SPECIALITY_ID: e.target.value })}>
                          <option value="">{tr("Not specified")}</option>
                          {(lookups?.specialities || []).map(s => (
                            <option key={s.STUDENT_SPECIALITY_ID} value={s.STUDENT_SPECIALITY_ID}>
                              {localizedLabel(s, 'SPECIALITY_NAME')}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={tr("Academic Average")}>
                        <input type="number" step="0.01" min="0" max="20" className={inputCls}
                          value={detail.STUDENT_ACADEMIC_AVERAGE}
                          onChange={e => setDetail({ ...detail, STUDENT_ACADEMIC_AVERAGE: e.target.value })} />
                      </Field>
                      <Field label={tr("Recruitment Source")}>
                        <select className={inputCls} value={detail.STUDENT_RECRUITMENT_SOURCE_ID || ''}
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
                    {canEdit && <SaveButton onClick={handleSaveDetail} saving={saving} disabled={checking || detailConflict} />}
                  </div>
                )}

                {/* ---------------- FAMILY ---------------- */}
                {activeTab === 'family' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Field label={tr("Siblings (total)")} error={familyErrors.STUDENT_NUMBER_OF_SIBLINGS}>
                        <input type="number" min="0" className={inputCls} value={detail.STUDENT_NUMBER_OF_SIBLINGS}
                          onChange={e => setDetail({ ...detail, STUDENT_NUMBER_OF_SIBLINGS: e.target.value })} />
                      </Field>
                      <Field label={tr("Sisters")} error={familyErrors.STUDENT_NUMBER_OF_SISTERS}>
                        <input type="number" min="0" className={inputCls} value={detail.STUDENT_NUMBER_OF_SISTERS}
                          onChange={e => setDetail({ ...detail, STUDENT_NUMBER_OF_SISTERS: e.target.value })} />
                      </Field>
                      <Field label={tr("Order Among Siblings")} error={familyErrors.STUDENT_ORDER_AMONG_SIBLINGS}>
                        <input type="number" min="1" className={inputCls} value={detail.STUDENT_ORDER_AMONG_SIBLINGS}
                          onChange={e => setDetail({ ...detail, STUDENT_ORDER_AMONG_SIBLINGS: e.target.value })} />
                      </Field>
                      <Field label={tr("Orphan Status")}>
                        <select className={inputCls} value={detail.STUDENT_ORPHAN_STATUS}
                          onChange={e => setDetail({ ...detail, STUDENT_ORPHAN_STATUS: e.target.value })}>
                          {ORPHAN.map(v => <option key={v} value={v}>{tr(v)}</option>)}
                        </select>
                      </Field>
                      <Field label={tr("Parents' Situation")}>
                        <select className={inputCls} value={detail.STUDENT_PARENTS_SITUATION}
                          onChange={e => setDetail({ ...detail, STUDENT_PARENTS_SITUATION: e.target.value })}>
                          {PARENTS_SIT.map(v => <option key={v} value={v}>{tr(v)}</option>)}
                        </select>
                      </Field>
                    </div>

                    {/* Parents */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      <div className={cardCls}>
                        <h3 className="kicker mb-3 text-[9px]">{tr("Father")}</h3>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label={tr("First Name (LA)")}>
                            <input type="text" className={inputCls} value={parents.FATHER_FIRST_NAME_LA}
                              onChange={e => setParents({ ...parents, FATHER_FIRST_NAME_LA: e.target.value })} />
                          </Field>
                          <Field label={tr("Last Name (LA)")}>
                            <input type="text" className={inputCls} value={parents.FATHER_LAST_NAME_LA}
                              onChange={e => setParents({ ...parents, FATHER_LAST_NAME_LA: e.target.value })} />
                          </Field>
                          <Field label={tr("First Name (AR)")}>
                            <input type="text" dir="rtl" className={inputCls} value={parents.FATHER_FIRST_NAME_AR}
                              onChange={e => setParents({ ...parents, FATHER_FIRST_NAME_AR: e.target.value })} />
                          </Field>
                          <Field label={tr("Last Name (AR)")}>
                            <input type="text" dir="rtl" className={inputCls} value={parents.FATHER_LAST_NAME_AR}
                              onChange={e => setParents({ ...parents, FATHER_LAST_NAME_AR: e.target.value })} />
                          </Field>
                          <div className="col-span-2">
                            <Field label={tr("Profession")}>
                              <select className={inputCls} value={parents.FATHER_PROFESSION_ID}
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

                      <div className={cardCls}>
                        <h3 className="kicker mb-3 text-[9px]">{tr("Mother")}</h3>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label={tr("First Name (LA)")}>
                            <input type="text" className={inputCls} value={parents.MOTHER_FIRST_NAME_LA}
                              onChange={e => setParents({ ...parents, MOTHER_FIRST_NAME_LA: e.target.value })} />
                          </Field>
                          <Field label={tr("Last Name (LA)")}>
                            <input type="text" className={inputCls} value={parents.MOTHER_LAST_NAME_LA}
                              onChange={e => setParents({ ...parents, MOTHER_LAST_NAME_LA: e.target.value })} />
                          </Field>
                          <Field label={tr("First Name (AR)")}>
                            <input type="text" dir="rtl" className={inputCls} value={parents.MOTHER_FIRST_NAME_AR}
                              onChange={e => setParents({ ...parents, MOTHER_FIRST_NAME_AR: e.target.value })} />
                          </Field>
                          <Field label={tr("Last Name (AR)")}>
                            <input type="text" dir="rtl" className={inputCls} value={parents.MOTHER_LAST_NAME_AR}
                              onChange={e => setParents({ ...parents, MOTHER_LAST_NAME_AR: e.target.value })} />
                          </Field>
                          <div className="col-span-2">
                            <Field label={tr("Profession")}>
                              <select className={inputCls} value={parents.MOTHER_PROFESSION_ID}
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

                    {canEdit && <SaveButton onClick={async () => { await handleSaveDetail(); await handleSaveParents() }} saving={saving} />}
                  </div>
                )}

                {/* ---------------- HOBBIES ---------------- */}
                {/* Hobbies are independent ticks over a list long enough to
                    scroll, so they have their own tab and a searchable picker
                    instead of a row of chips at the foot of Family. */}
                {activeTab === 'hobbies' && (
                  <div className="space-y-4">
                    <div className={cardCls}>
                      <h3 className="kicker mb-3 text-[9px]">{tr("Hobbies")}</h3>
                      {(lookups?.hobbies || []).length === 0 ? (
                        <span className="text-[11px] text-ink-3">{tr("No hobbies defined yet.")}</span>
                      ) : (
                        <MultiSelect
                          values={hobbySel}
                          onChange={handleSaveHobbies}
                          options={(lookups?.hobbies || []).map(h => ({ value: h.HOBBY_ID, label: localizedLabel(h, 'HOBBY_NAME') }))}
                          placeholder={tr('Select hobbies')}
                          emptyLabel={tr('No hobbies defined yet.')}
                        />
                      )}
                      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
                        {tr("Every change is saved to the student record straight away.")}
                      </p>
                    </div>
                  </div>
                )}

                {/* ---------------- CONTACTS ---------------- */}
                {activeTab === 'contacts' && (
                  <div className="space-y-5">
                    {/* Existing contacts */}
                    {contacts.length === 0 ? (
                      <p className="text-[11.5px] text-ink-3">{tr("No emergency contacts recorded yet.")}</p>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {contacts.map(c => (
                          <div key={c.EMERGENCY_CONTACT_ID} className={cardCls}>
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <div className="text-[12.5px] font-semibold text-ink">
                                  {c.CONTACT_FIRST_NAME_LA} {c.CONTACT_LAST_NAME_LA}
                                </div>
                                <div className="text-[10.5px] text-ink-3">
                                  {c.CONTACT_RELATION_NAME || c.CONSULATE_NUMBER || tr('Contact')}
                                </div>
                              </div>
                              {canEdit && (
                                <button
                                  onClick={() => handleDeleteContact(c.EMERGENCY_CONTACT_ID)}
                                  className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 transition-colors hover:bg-surface-muted hover:text-[color:var(--color-danger-ink)]"
                                  title={tr("Delete contact")}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <Field label={tr("Phone")}>
                                <input type="text" className={inputCls} defaultValue={c.CONTACT_PHONE_NUMBER || ''} readOnly={!canEdit}
                                  onBlur={e => canEdit && window.api.updateStudentEmergencyContact(user?.id, c.EMERGENCY_CONTACT_ID, { CONTACT_PHONE_NUMBER: e.target.value }).then(flashSaved)} />
                              </Field>
                              <Field label={tr("Consulate Number")}>
                                <input type="text" className={inputCls} defaultValue={c.CONSULATE_NUMBER || ''} readOnly={!canEdit}
                                  onBlur={e => canEdit && window.api.updateStudentEmergencyContact(user?.id, c.EMERGENCY_CONTACT_ID, { CONSULATE_NUMBER: e.target.value }).then(flashSaved)} />
                              </Field>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add new */}
                    <div className={cardCls}>
                      <h3 className="kicker mb-3 inline-flex items-center gap-1.5 text-[9px]">
                        <Plus size={13} />{' '}{tr("Add Emergency Contact")}</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <Field label={tr("First Name")}>
                          <input type="text" className={inputCls} value={newContact.CONTACT_FIRST_NAME_LA}
                            onChange={e => setNewContact({ ...newContact, CONTACT_FIRST_NAME_LA: e.target.value })} />
                        </Field>
                        <Field label={tr("Last Name")}>
                          <input type="text" className={inputCls} value={newContact.CONTACT_LAST_NAME_LA}
                            onChange={e => setNewContact({ ...newContact, CONTACT_LAST_NAME_LA: e.target.value })} />
                        </Field>
                        <Field label={tr("Relation")}>
                          <select className={inputCls} value={newContact.CONTACT_RELATION_ID}
                            onChange={e => setNewContact({ ...newContact, CONTACT_RELATION_ID: e.target.value })}>
                            <option value="">{tr("Not specified")}</option>
                            {(lookups?.relations || []).map(r => (
                              <option key={r.RELATION_ID} value={r.RELATION_ID}>{localizedLabel(r, 'RELATION_NAME')}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={tr("Phone")}>
                          <input type="text" className={inputCls} value={newContact.CONTACT_PHONE_NUMBER}
                            onChange={e => setNewContact({ ...newContact, CONTACT_PHONE_NUMBER: e.target.value })} />
                        </Field>
                        <Field label={tr("Consulate Number")}>
                          <input type="text" className={inputCls} value={newContact.CONSULATE_NUMBER}
                            onChange={e => setNewContact({ ...newContact, CONSULATE_NUMBER: e.target.value })} />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            size="lg"
                            className="w-full"
                            onClick={handleAddContact}
                            disabled={!canEdit || !newContact.CONTACT_FIRST_NAME_LA}
                            loading={saving}
                          >
                            <Plus size={15} />{' '}{tr("Add Contact")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ---------------- UNIFORMS ---------------- */}
                {activeTab === 'uniforms' && (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      <div className={cardCls}>
                        <h3 className="kicker mb-3 text-[9px]">{tr("Combat Outfit")}</h3>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label={tr("1st Outfit Number")} error={conflictMessage(conflicts, 'FIRST_OUTFIT_NUMBER', tr)}>
                            <input type="text" className={inputCls} value={combat.FIRST_OUTFIT_NUMBER}
                              onChange={e => setCombat({ ...combat, FIRST_OUTFIT_NUMBER: e.target.value })} />
                          </Field>
                          <Field label={tr("1st Outfit Size")}>
                            <UniformSizeSelect className={inputCls}
                              options={uniformSizeOptions.COMBAT_OUTFIT_SIZE || []}
                              value={combat.FIRST_OUTFIT_SIZE}
                              onChange={size => setCombat({ ...combat, FIRST_OUTFIT_SIZE: size })} />
                          </Field>
                          <Field label={tr("2nd Outfit Number")} error={conflictMessage(conflicts, 'SECOND_OUTFIT_NUMBER', tr)}>
                            <input type="text" className={inputCls} value={combat.SECOND_OUTFIT_NUMBER}
                              onChange={e => setCombat({ ...combat, SECOND_OUTFIT_NUMBER: e.target.value })} />
                          </Field>
                          <Field label={tr("2nd Outfit Size")}>
                            <UniformSizeSelect className={inputCls}
                              options={uniformSizeOptions.COMBAT_OUTFIT_SIZE || []}
                              value={combat.SECOND_OUTFIT_SIZE}
                              onChange={size => setCombat({ ...combat, SECOND_OUTFIT_SIZE: size })} />
                          </Field>
                          <Field label={tr("Combat Shoe Size")}>
                            <UniformSizeSelect className={inputCls}
                              options={uniformSizeOptions.COMBAT_SHOE_SIZE || []}
                              value={combat.COMBAT_SHOE_SIZE}
                              onChange={size => setCombat({ ...combat, COMBAT_SHOE_SIZE: size })} />
                          </Field>
                        </div>
                        <div className="mt-4">
                          {canEdit && <SaveButton onClick={handleSaveCombat} saving={saving} disabled={checking || outfitConflict} />}
                        </div>
                      </div>

                      <div className={cardCls}>
                        <h3 className="kicker mb-3 text-[9px]">{tr("Parade Uniform Sizes")}</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {PARADE_UNIFORM_FIELDS
                            .filter(field => !(identity.sex === 'M' && FEMALE_ONLY_UNIFORM_KEYS.includes(field.key)))
                            .map(field => (
                              <Field key={field.key} label={tr(field.label)}>
                                <UniformSizeSelect className={inputCls}
                                  options={uniformSizeOptions[field.kind] || []}
                                  value={parade[field.key]}
                                  onChange={size => setParade({ ...parade, [field.key]: size })} />
                              </Field>
                            ))}
                        </div>
                        {identity.sex === 'M' ? (
                          <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                            {tr('A male student has no skirt sizes.')}
                          </p>
                        ) : null}
                        {Object.keys(uniformSizeOptions).length === 0 ? (
                          <p className="mt-2 text-[10px] leading-relaxed text-amber-600">
                            {tr('No uniform sizes are defined yet. An administrator adds them in Settings → Registers → Uniform sizes.')}
                          </p>
                        ) : null}
                        <div className="mt-4">
                          {canEdit && <SaveButton onClick={handleSaveParade} saving={saving} />}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          </Panel>
        </>
      )}
      </>)}

      <StudentReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        user={user}
        student={selectedStudent}
      />
    </div>
  )
}

const SaveButton = ({ onClick, saving, label, disabled = false }) => (
  <div className="flex justify-end">
    <Button size="md" onClick={onClick} loading={saving} disabled={disabled}>
      <Save size={13} strokeWidth={1.9} aria-hidden="true" />
      {saving ? tr('Saving...') : (label || tr('Save Changes'))}
    </Button>
  </div>
)

export default StudentProfile
