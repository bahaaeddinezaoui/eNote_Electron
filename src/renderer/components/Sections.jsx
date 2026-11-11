import React, { useEffect, useState } from 'react'
import { AlertCircle, Check, Edit2, Plus, Save, Search, Trash2, Users } from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import DataTable from './ui/DataTable'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Notice from './ui/Notice'
import TableEmptyState from './ui/TableEmptyState'
import LocalizedInput, { hasLocalizedValue } from './ui/LocalizedInput'
import { PageIntro, Panel, PanelHeader } from './ui/PageHeader'
import { pickCurrentYearId, pickCurrentSemesterId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'
import { tr } from '../i18n'

// Reference data: the sections a student can sit in, and the teaching groups a
// major/semester splits its students into. Both lists are read in tables; every
// write happens in a dialog, so a list is never replaced by a form. One dialog
// per record type serves both directions — `id` is null for a new row and the
// row's id when editing.
//
// The roster is the one exception: it is a working set (checked students) that
// opens under its group, because it needs the filters and the full student list
// beside it. Nothing is written until "Save Roster".

const emptySectionForm = () => ({
  SECTION_CODE: '',
  SECTION_LABEL_EN: '',
  SECTION_LABEL_AR: '',
  SECTION_LABEL_FR: '',
  SECTION_DESCRIPTION_EN: '',
  SECTION_DESCRIPTION_AR: '',
  SECTION_DESCRIPTION_FR: '',
  TEACHING_CATEGORY_ID: '',
  PROMOTION_ID: ''
})

// Rows arrive localized in SECTION_LABEL/SECTION_DESCRIPTION, so the _EN columns
// are read first and only fall back to the translated value.
const sectionFormFromRow = (section) => ({
  SECTION_CODE: section.SECTION_CODE || '',
  SECTION_LABEL_EN: section.SECTION_LABEL_EN ?? section.SECTION_LABEL ?? '',
  SECTION_LABEL_AR: section.SECTION_LABEL_AR ?? '',
  SECTION_LABEL_FR: section.SECTION_LABEL_FR ?? '',
  SECTION_DESCRIPTION_EN: section.SECTION_DESCRIPTION_EN ?? section.SECTION_DESCRIPTION ?? '',
  SECTION_DESCRIPTION_AR: section.SECTION_DESCRIPTION_AR ?? '',
  SECTION_DESCRIPTION_FR: section.SECTION_DESCRIPTION_FR ?? '',
  TEACHING_CATEGORY_ID: section.TEACHING_CATEGORY_ID || '',
  PROMOTION_ID: section.PROMOTION_ID || ''
})

const sectionPayloadFrom = (form) => ({
  SECTION_CODE: form.SECTION_CODE.trim(),
  SECTION_LABEL_EN: form.SECTION_LABEL_EN,
  SECTION_LABEL_AR: form.SECTION_LABEL_AR,
  SECTION_LABEL_FR: form.SECTION_LABEL_FR,
  SECTION_DESCRIPTION_EN: form.SECTION_DESCRIPTION_EN,
  SECTION_DESCRIPTION_AR: form.SECTION_DESCRIPTION_AR,
  SECTION_DESCRIPTION_FR: form.SECTION_DESCRIPTION_FR,
  ...(form.TEACHING_CATEGORY_ID && { TEACHING_CATEGORY_ID: Number(form.TEACHING_CATEGORY_ID) }),
  ...(form.PROMOTION_ID && { PROMOTION_ID: Number(form.PROMOTION_ID) })
})

const emptyGroupForm = () => ({
  TEACHING_GROUP_CODE: '',
  TEACHING_GROUP_LABEL_EN: '',
  TEACHING_GROUP_LABEL_AR: '',
  TEACHING_GROUP_LABEL_FR: '',
  TEACHING_CATEGORY_ID: ''
})

const groupFormFromRow = (group) => ({
  TEACHING_GROUP_CODE: group.TEACHING_GROUP_CODE || '',
  TEACHING_GROUP_LABEL_EN: group.TEACHING_GROUP_LABEL_EN ?? group.TEACHING_GROUP_LABEL ?? '',
  TEACHING_GROUP_LABEL_AR: group.TEACHING_GROUP_LABEL_AR ?? '',
  TEACHING_GROUP_LABEL_FR: group.TEACHING_GROUP_LABEL_FR ?? '',
  TEACHING_CATEGORY_ID: group.TEACHING_CATEGORY_ID ? String(group.TEACHING_CATEGORY_ID) : ''
})

const groupPayloadFrom = (form) => ({
  TEACHING_GROUP_CODE: form.TEACHING_GROUP_CODE.trim(),
  TEACHING_GROUP_LABEL_EN: form.TEACHING_GROUP_LABEL_EN,
  TEACHING_GROUP_LABEL_AR: form.TEACHING_GROUP_LABEL_AR,
  TEACHING_GROUP_LABEL_FR: form.TEACHING_GROUP_LABEL_FR,
  // The category ties the group (and every session in it) to a scheduler scope.
  ...(form.TEACHING_CATEGORY_ID && { TEACHING_CATEGORY_ID: Number(form.TEACHING_CATEGORY_ID) })
})

// A code as it is stored: mono, tabular, boxed — the same chip the account and
// register tables use for identifiers.
const CodeChip = ({ children }) => (
  <span className="mono inline-flex items-center rounded-[3px] border border-line bg-surface-muted px-1.5 py-0.5 text-[10.5px] uppercase tracking-[0.04em] text-ink-2">
    {children || '—'}
  </span>
)

const FieldError = ({ children }) => (
  <div className="flex items-start gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-2.5 py-2 text-[11.5px] text-danger-ink">
    <AlertCircle size={13} className="mt-px shrink-0" /> {children}
  </div>
)

const IconAction = ({ label, onClick, danger = false, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    aria-label={label}
    className={`grid h-6 w-6 place-items-center rounded-[3px] ${
      danger ? 'text-ink-3 hover:bg-danger-bg hover:text-danger-ink' : 'text-ink-3 hover:bg-surface-muted hover:text-ink'
    }`}
  >
    {children}
  </button>
)

const Sections = ({ user }) => {
  const [sections, setSections] = useState([])
  const [majors, setMajors] = useState([])
  const [groups, setGroups] = useState([])
  const [categories, setCategories] = useState([])
  const [promotions, setPromotions] = useState([])
  const [studyYears, setStudyYears] = useState([])
  const [semesters, setSemesters] = useState([])
  const [selectedMajor, setSelectedMajor] = useState('')
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedSemester, setSelectedSemester] = useState('')
  // One panel at a time, like Majors: sections on the left tab, the dynamic
  // teaching groups (scoped by major and semester) on the right.
  const [showGroups, setShowGroups] = useState(false)

  // The teaching-group panel stays on the current year/semester.
  useCurrentPeriodSync([
    { rows: studyYears, pickId: pickCurrentYearId, selectedId: selectedYear, setSelectedId: setSelectedYear },
    { rows: semesters, pickId: pickCurrentSemesterId, selectedId: selectedSemester, setSelectedId: setSelectedSemester }
  ])

  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState(null)

  // Roster management: per-group membership editor.
  // membersExpanded[groupId] opens the roster panel for a group.
  // membersByGroup[groupId] = { personId: row } from getStudentsInTeachingGroup.
  // pendingChecks is the working copy of the checked set, saved via
  // updateTeachingGroupRoster.
  const [membersExpanded, setMembersExpanded] = useState({})
  const [membersByGroup, setMembersByGroup] = useState({})
  const [pendingChecks, setPendingChecks] = useState({})
  const [allStudents, setAllStudents] = useState([])
  const [memberFilter, setMemberFilter] = useState({ promotion: '', section: '', text: '' })
  const [savingRoster, setSavingRoster] = useState(null)

  // null = closed, otherwise the dialog's draft. `id` is null for a new row.
  const [sectionEditor, setSectionEditor] = useState(null)
  const [sectionError, setSectionError] = useState('')
  const [savingSection, setSavingSection] = useState(false)
  const [groupEditor, setGroupEditor] = useState(null)
  const [groupCategories, setGroupCategories] = useState([])
  const [groupError, setGroupError] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)

  const [confirmTarget, setConfirmTarget] = useState(null)

  useEffect(() => {
    fetchData()
  }, [])

  // Load study years up front so the teaching-group panel can be scoped to a
  // (major, semester) pair. A teaching group belongs to a major AND a study
  // semester, so the list reloads when either selection changes.
  useEffect(() => {
    if (!selectedYear) {
      setSemesters([])
      setSelectedSemester('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const result = await window.api.getStudySemesters(selectedYear)
        if (cancelled) return
        const data = result?.data || []
        setSemesters(data)
        setSelectedSemester(data.length > 0 ? pickCurrentSemesterId(data) : '')
      } catch (err) {
        console.error('Failed to load semesters', err)
        if (!cancelled) {
          setSemesters([])
          setSelectedSemester('')
        }
      }
    })()
    return () => { cancelled = true }
  }, [selectedYear])

  useEffect(() => {
    if (selectedMajor && selectedSemester) {
      fetchGroups(selectedMajor, selectedSemester)
    } else {
      setGroups([])
    }
  }, [selectedMajor, selectedSemester])

  const showMessage = (type, text) => setNotice({ type, text })

  const fetchData = async () => {
    setLoading(true)
    try {
      const [sectionsRes, majorsRes, categoriesRes, promotionsRes, personsRes, yearsRes] = await Promise.all([
        window.api.getSections(),
        window.api.getMajors(),
        window.api.getTeachingCategories(),
        window.api.getPromotions(),
        window.api.getPersons(),
        window.api.getStudyYears()
      ])

      const fetchedMajors = majorsRes?.data || []
      const fetchedSections = sectionsRes?.data || []
      const fetchedYears = yearsRes?.data || []
      setSections(fetchedSections)
      setMajors(fetchedMajors)
      setCategories(categoriesRes?.data || [])
      setPromotions(promotionsRes?.data || [])
      setStudyYears(fetchedYears)

      // Build personId -> home-section label by querying each section's students
      // once. (There is no single "all student_section rows" API; sections is a
      // small list, so this is bounded.)
      const sectionLabelByPerson = {}
      for (const sec of fetchedSections) {
        try {
          const res = await window.api.getSectionStudents(sec.SECTION_ID)
          for (const p of res?.data || []) {
            sectionLabelByPerson[p.PERSON_ID] = sec.SECTION_LABEL
          }
        } catch (err) {
          console.error('Failed to load section students', err)
        }
      }

      // Candidate pool for roster assignment: every student, enriched with their
      // home section so each row can show where they're coming from.
      const studentPool = (personsRes?.data || [])
        .filter(p => p.IS_STUDENT)
        .map(p => ({
          ...p,
          SECTION_LABEL: sectionLabelByPerson[p.PERSON_ID] || '—'
        }))
      setAllStudents(studentPool)

      if (fetchedMajors.length > 0 && !selectedMajor) {
        setSelectedMajor(fetchedMajors[0].MAJOR_ID)
      }
      if (fetchedYears.length > 0 && !selectedYear) {
        setSelectedYear(pickCurrentYearId(fetchedYears))
      }
    } catch (error) {
      console.error(error)
      showMessage('error', tr('Unable to load section or major data'))
    }
    setLoading(false)
  }

  const fetchGroups = async (majorId, semesterId) => {
    if (!majorId || !semesterId) {
      setGroups([])
      return
    }
    setLoading(true)
    try {
      const result = await window.api.getTeachingGroupsByMajor(majorId, semesterId)
      setGroups(result?.data || [])
      // Reset any open roster panels when the major/semester changes
      setMembersExpanded({})
      setMembersByGroup({})
      setPendingChecks({})
    } catch (error) {
      console.error(error)
      setGroups([])
      showMessage('error', tr('Unable to load teaching groups'))
    }
    setLoading(false)
  }

  // --- Teaching-group roster (memberships) ---
  // Memberships are scoped per (major, semester), so every roster call also
  // needs selectedSemester alongside selectedMajor.
  const loadGroupMembers = async (majorId, semesterId, groupId) => {
    try {
      const result = await window.api.getStudentsInTeachingGroup(majorId, semesterId, groupId)
      const rows = result?.data || []
      const byId = {}
      for (const row of rows) {
        byId[row.PERSON_ID] = row
      }
      setMembersByGroup(prev => ({ ...prev, [groupId]: byId }))
      // Seed the working checked set from the current membership
      setPendingChecks(prev => ({ ...prev, [groupId]: rows.map(r => r.PERSON_ID) }))
    } catch (error) {
      console.error(error)
      showMessage('error', tr('Unable to load group members'))
      setMembersByGroup(prev => ({ ...prev, [groupId]: {} }))
      setPendingChecks(prev => ({ ...prev, [groupId]: [] }))
    }
  }

  const toggleMember = (groupId, personId) => {
    setPendingChecks(prev => {
      const current = prev[groupId] || []
      return {
        ...prev,
        [groupId]: current.includes(personId)
          ? current.filter(id => id !== personId)
          : [...current, personId]
      }
    })
  }

  const toggleMembersPanel = (groupId) => {
    const willOpen = !membersExpanded[groupId]
    setMembersExpanded(prev => ({ ...prev, [groupId]: willOpen }))
    if (willOpen && selectedMajor && selectedSemester) {
      loadGroupMembers(selectedMajor, selectedSemester, groupId)
    }
  }

  const handleSaveRoster = async (groupId) => {
    if (!selectedMajor || !selectedSemester) return
    setSavingRoster(groupId)
    try {
      const personIds = pendingChecks[groupId] || []
      await window.api.updateTeachingGroupRoster(selectedMajor, selectedSemester, groupId, personIds)
      await loadGroupMembers(selectedMajor, selectedSemester, groupId)
      showMessage('success', `${tr('Roster saved')} (${personIds.length})`)
    } catch (error) {
      console.error(error)
      showMessage('error', tr('Failed to save roster'))
    }
    setSavingRoster(null)
  }

  // --- Sections ---
  const openSectionEditor = (section = null) => {
    setSectionError('')
    setSectionEditor(
      section
        ? { id: section.SECTION_ID, form: sectionFormFromRow(section) }
        : { id: null, form: emptySectionForm() }
    )
  }

  const closeSectionEditor = () => {
    if (savingSection) return
    setSectionEditor(null)
    setSectionError('')
  }

  const setSectionForm = (next) =>
    setSectionEditor(current => (current ? { ...current, form: next } : current))

  const saveSection = async (event) => {
    event.preventDefault()
    if (!sectionEditor) return

    const form = sectionEditor.form
    if (!form.SECTION_CODE.trim() || !hasLocalizedValue(form, 'SECTION_LABEL')) {
      setSectionError(tr('Section code and English label are required'))
      return
    }

    const wasEditing = !!sectionEditor.id
    setSavingSection(true)
    setSectionError('')
    try {
      if (wasEditing) await window.api.updateSection(sectionEditor.id, sectionPayloadFrom(form))
      else await window.api.createSection(sectionPayloadFrom(form))
      setSectionEditor(null)
      await fetchData()
      showMessage('success', tr(wasEditing ? 'Section updated' : 'Section added'))
    } catch (error) {
      console.error(error)
      setSectionError(error.message || tr(wasEditing ? 'Failed to update section' : 'Failed to add section'))
    } finally {
      setSavingSection(false)
    }
  }

  const handleDeleteSection = async (id) => {
    setLoading(true)
    try {
      await window.api.deleteSection(id)
      fetchData()
      showMessage('success', tr('Section deleted'))
    } catch (error) {
      console.error(error)
      showMessage('error', tr('Failed to delete section'))
    }
    setLoading(false)
  }

  // --- Teaching groups ---
  const openGroupEditor = (group = null) => {
    setGroupError('')
    setGroupEditor(
      group
        ? { id: group.TEACHING_GROUP_ID, form: groupFormFromRow(group) }
        : { id: null, form: emptyGroupForm() }
    )
    if (groupCategories.length === 0) {
      window.api.getTeachingCategories()
        .then((res) => setGroupCategories(res?.data || []))
        .catch(() => {})
    }
  }

  const closeGroupEditor = () => {
    if (savingGroup) return
    setGroupEditor(null)
    setGroupError('')
  }

  const setGroupForm = (next) =>
    setGroupEditor(current => (current ? { ...current, form: next } : current))

  const saveGroup = async (event) => {
    event.preventDefault()
    if (!groupEditor) return

    if (!selectedMajor) {
      setGroupError(tr('Select a major first'))
      return
    }
    if (!selectedSemester) {
      setGroupError(tr('Select a study semester first'))
      return
    }

    const form = groupEditor.form
    if (!form.TEACHING_GROUP_CODE.trim() || !hasLocalizedValue(form, 'TEACHING_GROUP_LABEL')) {
      setGroupError(tr('Group code and English label are required'))
      return
    }

    const wasEditing = !!groupEditor.id
    setSavingGroup(true)
    setGroupError('')
    try {
      if (wasEditing) await window.api.updateTeachingGroup(groupEditor.id, groupPayloadFrom(form))
      else
        await window.api.createTeachingGroup(user?.id, {
          ...groupPayloadFrom(form),
          MAJOR_ID: selectedMajor,
          STUDY_SEMESTER_ID: selectedSemester
        })
      setGroupEditor(null)
      await fetchGroups(selectedMajor, selectedSemester)
      showMessage('success', tr(wasEditing ? 'Teaching group updated' : 'Dynamic teaching group added'))
    } catch (error) {
      console.error(error)
      setGroupError(error.message || tr(wasEditing ? 'Failed to update teaching group' : 'Failed to add teaching group'))
    } finally {
      setSavingGroup(false)
    }
  }

  const handleDeleteGroup = async (id) => {
    setLoading(true)
    try {
      await window.api.deleteTeachingGroup(id)
      fetchGroups(selectedMajor, selectedSemester)
      showMessage('success', tr('Teaching group deleted'))
    } catch (error) {
      console.error(error)
      showMessage('error', tr('Failed to delete teaching group'))
    }
    setLoading(false)
  }

  const selectedMajorRow = majors.find(m => String(m.MAJOR_ID) === String(selectedMajor))
  const selectedSemesterRow = semesters.find(s => String(s.STUDY_SEMESTER_ID) === String(selectedSemester))
  const scopeLabel = [selectedMajorRow?.MAJOR_LABEL || selectedMajorRow?.MAJOR_CODE, selectedSemesterRow?.STUDY_SEMESTER_LABEL || selectedSemesterRow?.STUDY_SEMESTER_CODE]
    .filter(Boolean)
    .join(' · ')
  const selectedPromotion = sectionEditor?.form.PROMOTION_ID
    ? promotions.find(p => String(p.PROMOTION_ID) === String(sectionEditor.form.PROMOTION_ID))
    : null
  const sectionCategoryId = sectionEditor?.form.TEACHING_CATEGORY_ID
  const promotionCategoryId = selectedPromotion?.TEACHING_CATEGORY_ID
  const hasPromotionCategoryMismatch = Boolean(
    sectionCategoryId && promotionCategoryId && String(sectionCategoryId) !== String(promotionCategoryId)
  )

  return (
    <div className="space-y-4">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageIntro
        kicker={tr('Reference data')}
        title={tr('Sections & teaching groups')}
        meta={`${sections.length} ${sections.length === 1 ? tr('section') : tr('sections')} · ${groups.length} ${groups.length === 1 ? tr('group') : tr('groups')}`}
        actions={
          <>
            <div
              role="tablist"
              aria-label={tr('Sections & teaching groups')}
              className="inline-flex items-center gap-0.5 rounded-[4px] border border-line-strong bg-surface p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!showGroups}
                onClick={() => setShowGroups(false)}
                className={`inline-flex h-7 items-center rounded-[3px] px-2.5 text-[11.5px] font-medium transition-colors ${
                  !showGroups
                    ? 'bg-jade-solid text-on-jade'
                    : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
                }`}
              >
                {tr('Sections')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={showGroups}
                onClick={() => setShowGroups(true)}
                className={`inline-flex h-7 items-center rounded-[3px] px-2.5 text-[11.5px] font-medium transition-colors ${
                  showGroups
                    ? 'bg-jade-solid text-on-jade'
                    : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
                }`}
              >
                {tr('Dynamic Teaching Groups')}
              </button>
            </div>
            {showGroups ? (
              <Button
                size="md"
                disabled={!selectedMajor || !selectedSemester}
                onClick={() => openGroupEditor()}
              >
                <Plus size={13} strokeWidth={2} /> {tr('Add Group')}
              </Button>
            ) : (
              <Button size="md" onClick={() => openSectionEditor()}>
                <Plus size={13} strokeWidth={2} /> {tr('Add Section')}
              </Button>
            )}
          </>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr("Admin-only page to create and maintain sections, define teaching groups per major, and manage each group's student roster.")}
        </p>
      </PageIntro>

      {/* Sections: one row per section, every write in the dialog. */}
      {!showGroups && (
      <Panel>
        <PanelHeader
          title={tr('Sections')}
          meta={sections.length}
          actions={
            <Button variant="ghost" size="sm" onClick={() => openSectionEditor()}>
              <Plus size={11} strokeWidth={2} /> {tr('Add Section')}
            </Button>
          }
        />

        <div className="overflow-x-auto">
          <DataTable
            className="data-table"
            label={tr('Sections')}
            columns={[
              { key: 'c0', width: 120, header: <>{tr('Code')}</> },
              { key: 'c1', header: <>{tr('Section')}</> },
              { key: 'c2', width: 190, header: <>{tr('Teaching Category')}</> },
              { key: 'c3', width: 160, header: <>{tr('Promotion')}</> },
              { key: 'c4', width: 76 },
            ]}
          >
              {loading && sections.length === 0 ? (
                <TableEmptyState colSpan={5} loading loadingLabel={tr('Loading sections…')} />
              ) : sections.length === 0 ? (
                <TableEmptyState
                  colSpan={5}
                  emptyLabel={tr('No sections defined yet.')}
                  hint={tr('Add the first section with the button in the header.')}
                  action={
                    <Button size="sm" onClick={() => openSectionEditor()}>
                      <Plus size={12} /> {tr('Add Section')}
                    </Button>
                  }
                />
              ) : (
                sections.map(section => (
                  <tr key={section.SECTION_ID}>
                    <td>
                      <CodeChip>{section.SECTION_CODE}</CodeChip>
                    </td>
                    <td>
                      <div className="font-medium text-ink">{section.SECTION_LABEL || '—'}</div>
                      {section.SECTION_DESCRIPTION && (
                        <div className="max-w-[560px] truncate text-[11px] text-ink-3">
                          {section.SECTION_DESCRIPTION}
                        </div>
                      )}
                    </td>
                    <td className="text-ink-2">{section.TEACHING_CATEGORY_LABEL || '—'}</td>
                    <td className="text-ink-2">{section.PROMOTION_LABEL || '—'}</td>
                    <td className="!pe-2 text-end">
                      <span className="inline-flex items-center gap-0.5">
                        <IconAction label={`${tr('Edit')} ${section.SECTION_CODE}`} onClick={() => openSectionEditor(section)}>
                          <Edit2 size={11} />
                        </IconAction>
                        <IconAction
                          danger
                          label={`${tr('Delete')} ${section.SECTION_CODE}`}
                          onClick={() => setConfirmTarget({ kind: 'section', id: section.SECTION_ID })}
                        >
                          <Trash2 size={11} />
                        </IconAction>
                      </span>
                    </td>
                  </tr>
                ))
              )}
          </DataTable>
        </div>
      </Panel>
      )}

      {/* Teaching groups: scoped by major + semester, with the roster under its row. */}
      {showGroups && (
      <Panel>
        <PanelHeader
          title={tr('Dynamic Teaching Groups')}
          meta={groups.length}
          actions={
            <Button
              variant="ghost"
              size="sm"
              disabled={!selectedMajor || !selectedSemester}
              onClick={() => openGroupEditor()}
            >
              <Plus size={11} strokeWidth={2} /> {tr('Add Group')}
            </Button>
          }
        />

        <div className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-2">
          <label className="block w-full sm:w-[230px]">
            <span className="kicker mb-1 block text-[9px]">{tr('Major')}</span>
            <select
              className="field h-7 text-[11.5px]"
              value={selectedMajor}
              onChange={(e) => setSelectedMajor(Number(e.target.value))}
              aria-label={tr('Major')}
            >
              {majors.map((major) => (
                <option key={major.MAJOR_ID} value={major.MAJOR_ID}>
                  {major.MAJOR_LABEL || major.MAJOR_CODE}
                </option>
              ))}
            </select>
          </label>

          <label className="block w-full sm:w-[170px]">
            <span className="kicker mb-1 block text-[9px]">{tr('Study Year')}</span>
            <select
              className="field h-7 text-[11.5px]"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : '')}
              aria-label={tr('Study Year')}
            >
              <option value="">{tr('-- Select Year --')}</option>
              {studyYears.map((y) => (
                <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>
                  {y.STUDY_YEAR_LABEL || y.STUDY_YEAR_CODE}
                </option>
              ))}
            </select>
          </label>

          <label className="block w-full sm:w-[200px]">
            <span className="kicker mb-1 block text-[9px]">{tr('Semester')}</span>
            <select
              className="field h-7 text-[11.5px]"
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value ? Number(e.target.value) : '')}
              disabled={!selectedYear}
              aria-label={tr('Semester')}
            >
              <option value="">{tr('-- Select Semester --')}</option>
              {semesters.map((s) => (
                <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>
                  {s.STUDY_SEMESTER_LABEL || s.STUDY_SEMESTER_CODE}
                </option>
              ))}
            </select>
          </label>

          <p className="ms-auto hidden max-w-md pb-1 text-[11px] leading-snug text-ink-3 lg:block">
            {tr('Teaching groups are scoped by major')}{' '}
            {tr('and')}{' '}
            {tr('study semester. Pick the major and the semester to define groups for that period.')}
          </p>
        </div>

        <div className="overflow-x-auto">
          <DataTable
            className="data-table"
            label={tr('Dynamic Teaching Groups')}
            columns={[
              { key: 'c0', width: 120, header: <>{tr('Code')}</> },
              { key: 'c1', header: <>{tr('Teaching Group')}</> },
              { key: 'c2', width: 90, header: <>{tr('Members')}</> },
              { key: 'c3', width: 250 },
            ]}
          >
              {!selectedMajor || !selectedSemester ? (
                <TableEmptyState
                  colSpan={4}
                  emptyLabel={tr('Select a major and a semester to see its teaching groups.')}
                />
              ) : loading && groups.length === 0 ? (
                <TableEmptyState colSpan={4} loading loadingLabel={tr('Loading teaching groups…')} />
              ) : groups.length === 0 ? (
                <TableEmptyState
                  colSpan={4}
                  emptyLabel={tr('No teaching groups are defined for this major in the selected semester.')}
                  hint={tr('Add a group for this period, then assign its students from the roster.')}
                  action={
                    <Button size="sm" onClick={() => openGroupEditor()}>
                      <Plus size={12} /> {tr('Add Group')}
                    </Button>
                  }
                />
              ) : (
                groups.map((group) => {
                  const expanded = !!membersExpanded[group.TEACHING_GROUP_ID]
                  const members = membersByGroup[group.TEACHING_GROUP_ID]
                  const checked = pendingChecks[group.TEACHING_GROUP_ID]
                  const memberCount = members ? Object.keys(members).length : null
                  const pendingCount = checked ? checked.length : 0
                  const hasPending = members && checked && (
                    memberCount !== pendingCount ||
                    Object.keys(members).some(id => !checked.includes(Number(id))) ||
                    checked.some(id => !members[id])
                  )
                  // Candidate list, optionally filtered by promotion/section/text so
                  // admins can find students to add to a cross-section group.
                  const filteredStudents = allStudents.filter((s) => {
                    if (memberFilter.promotion && String(s.PROMOTION_ID) !== String(memberFilter.promotion)) return false
                    if (memberFilter.section && s.SECTION_LABEL !== memberFilter.section) return false
                    if (memberFilter.text) {
                      const q = memberFilter.text.toLowerCase()
                      const full = `${s.PERSON_FIRST_NAME || ''} ${s.PERSON_LAST_NAME || ''}`.toLowerCase()
                      if (!full.includes(q)) return false
                    }
                    return true
                  })

                  return (
                    <React.Fragment key={group.TEACHING_GROUP_ID}>
                      <tr data-open={expanded ? 'true' : undefined}>
                        <td>
                          <CodeChip>{group.TEACHING_GROUP_CODE}</CodeChip>
                        </td>
                        <td>
                          <div className="font-medium text-ink">{group.TEACHING_GROUP_LABEL || '—'}</div>
                        </td>
                        <td className="num">{memberCount !== null ? memberCount : '—'}</td>
                        <td className="!pe-2 text-end">
                          <span className="inline-flex items-center gap-0.5">
                            <Button
                              variant={expanded ? 'secondary' : 'ghost'}
                              size="sm"
                              onClick={() => toggleMembersPanel(group.TEACHING_GROUP_ID)}
                              aria-expanded={expanded}
                            >
                              <Users size={11} /> {expanded ? tr('Close') : tr('Manage Members')}
                            </Button>
                            <IconAction
                              label={`${tr('Edit')} ${group.TEACHING_GROUP_CODE}`}
                              onClick={() => openGroupEditor(group)}
                            >
                              <Edit2 size={11} />
                            </IconAction>
                            <IconAction
                              danger
                              label={`${tr('Delete')} ${group.TEACHING_GROUP_CODE}`}
                              onClick={() => setConfirmTarget({ kind: 'group', id: group.TEACHING_GROUP_ID })}
                            >
                              <Trash2 size={11} />
                            </IconAction>
                          </span>
                        </td>
                      </tr>

                      {expanded && (
                        <tr>
                          <td colSpan={4} className="roster-cell">
                            <div className="space-y-2.5 bg-surface-muted px-3 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="kicker text-[9px]">{tr('Roster')}</span>
                                <CodeChip>{group.TEACHING_GROUP_CODE}</CodeChip>
                                <span className="mono text-[10.5px] text-ink-3">
                                  {pendingCount} {tr('selected')}
                                </span>
                                {hasPending && (
                                  <span className="mono rounded-[2px] border border-line-strong bg-surface px-1 py-px text-[9.5px] uppercase tracking-[0.06em] text-ink-2">
                                    {tr('Unsaved changes')}
                                  </span>
                                )}
                                <Button
                                  size="sm"
                                  className="ms-auto"
                                  loading={savingRoster === group.TEACHING_GROUP_ID}
                                  onClick={() => handleSaveRoster(group.TEACHING_GROUP_ID)}
                                >
                                  <Check size={11} strokeWidth={2} /> {tr('Save Roster')}
                                </Button>
                              </div>

                              {/* Filters for finding candidate students */}
                              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_170px]">
                                <div className="relative">
                                  <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                                  <input
                                    type="text"
                                    placeholder={tr('Search by name')}
                                    aria-label={tr('Search by name')}
                                    value={memberFilter.text}
                                    onChange={(e) => setMemberFilter({ ...memberFilter, text: e.target.value })}
                                    className="field h-7 ps-6 text-[11.5px]"
                                  />
                                </div>
                                <select
                                  value={memberFilter.section}
                                  onChange={(e) => setMemberFilter({ ...memberFilter, section: e.target.value })}
                                  className="field h-7 text-[11.5px]"
                                  aria-label={tr('All sections')}
                                >
                                  <option value="">{tr('All sections')}</option>
                                  {sections.map((s) => (
                                    <option key={s.SECTION_ID} value={s.SECTION_LABEL}>{s.SECTION_LABEL}</option>
                                  ))}
                                </select>
                                <select
                                  value={memberFilter.promotion}
                                  onChange={(e) => setMemberFilter({ ...memberFilter, promotion: e.target.value })}
                                  className="field h-7 text-[11.5px]"
                                  aria-label={tr('All promotions')}
                                >
                                  <option value="">{tr('All promotions')}</option>
                                  {promotions.map((p) => (
                                    <option key={p.PROMOTION_ID} value={p.PROMOTION_ID}>{p.PROMOTION_LABEL}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="max-h-56 overflow-y-auto rounded-[4px] border border-line bg-surface">
                                {filteredStudents.length === 0 ? (
                                  <p className="px-3 py-5 text-center text-[11px] text-ink-3">
                                    {tr('No students match the filter.')}
                                  </p>
                                ) : (
                                  filteredStudents.map((student) => {
                                    const isChecked = (checked || []).includes(student.PERSON_ID)
                                    return (
                                      <label
                                        key={student.PERSON_ID}
                                        className="flex cursor-pointer items-center gap-2 border-b border-line px-2.5 py-1.5 last:border-b-0 hover:bg-surface-muted"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => toggleMember(group.TEACHING_GROUP_ID, student.PERSON_ID)}
                                          className="h-3.5 w-3.5 accent-[var(--color-jade-solid)]"
                                        />
                                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                                          {student.PERSON_FIRST_NAME} {student.PERSON_LAST_NAME}
                                        </span>
                                        <span className="mono shrink-0 text-[10px] text-ink-3">
                                          {student.SECTION_LABEL}
                                        </span>
                                      </label>
                                    )
                                  })
                                )}
                              </div>

                              <p className="text-[10.5px] leading-snug text-ink-3">
                                {tr('Checked students become members of this group for the selected semester. A student can belong to one group per major per semester, so checking them here moves them if they were in another group for this semester — memberships in other semesters are left untouched.')}
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })
              )}
          </DataTable>
        </div>
      </Panel>
      )}

      {/* Add / edit section — one dialog, the same shell as every other modal. */}
      <Modal
        open={!!sectionEditor}
        onClose={closeSectionEditor}
        title={sectionEditor?.id ? tr('Edit Section') : tr('Add Section')}
        maxWidth="max-w-[640px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[10px] text-ink-3">
              {sectionEditor?.id ? `#${sectionEditor.id}` : tr('New record')}
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={closeSectionEditor} disabled={savingSection}>
                {tr('Cancel')}
              </Button>
              <Button type="submit" form="section-form" size="sm" loading={savingSection}>
                <Save size={12} /> {savingSection ? tr('Saving…') : tr('Save')}
              </Button>
            </div>
          </div>
        }
      >
        {sectionEditor && (
          <form id="section-form" onSubmit={saveSection} className="space-y-3.5">
            {sectionError && <FieldError>{sectionError}</FieldError>}

            <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div>
                <label htmlFor="section-code" className="kicker mb-1 block text-[9px]">
                  {tr('Section Code')} *
                </label>
                <input
                  id="section-code"
                  type="text"
                  autoComplete="off"
                  required
                  value={sectionEditor.form.SECTION_CODE}
                  onChange={(e) => setSectionForm({ ...sectionEditor.form, SECTION_CODE: e.target.value })}
                  placeholder={tr('e.g. S-01')}
                  className="field mono text-[12px]"
                />
              </div>
              <LocalizedInput
                base="SECTION_LABEL"
                form={sectionEditor.form}
                setForm={setSectionForm}
                label={tr('Section Label')}
                required
                inputClassName="field text-[12px]"
              />
            </div>

            {/* One line per language: the description is short enough to read
                and edit in a single-line field. */}
            <LocalizedInput
              base="SECTION_DESCRIPTION"
              form={sectionEditor.form}
              setForm={setSectionForm}
              label={tr('Description')}
              inputClassName="field text-[12px]"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="section-category" className="kicker mb-1 block text-[9px]">
                  {tr('Teaching Category (Optional)')}
                </label>
                <select
                  id="section-category"
                  value={sectionEditor.form.TEACHING_CATEGORY_ID || ''}
                  onChange={(e) =>
                    setSectionForm({
                      ...sectionEditor.form,
                      TEACHING_CATEGORY_ID: e.target.value ? Number(e.target.value) : ''
                    })
                  }
                  className="field text-[12px]"
                >
                  <option value="">{tr('-- No Category --')}</option>
                  {categories.map((category) => (
                    <option key={category.TEACHING_CATEGORY_ID} value={category.TEACHING_CATEGORY_ID}>
                      {category.TEACHING_CATEGORY_LABEL} ({category.TEACHING_CATEGORY_CODE})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="section-promotion" className="kicker mb-1 block text-[9px]">
                  {tr('Promotion (Optional)')}
                </label>
                <select
                  id="section-promotion"
                  value={sectionEditor.form.PROMOTION_ID || ''}
                  onChange={(e) =>
                    setSectionForm({
                      ...sectionEditor.form,
                      PROMOTION_ID: e.target.value ? Number(e.target.value) : ''
                    })
                  }
                  className="field text-[12px]"
                >
                  <option value="">{tr('-- No Promotion --')}</option>
                  {promotions.map((promotion) => (
                    <option key={promotion.PROMOTION_ID} value={promotion.PROMOTION_ID}>
                      {promotion.PROMOTION_LABEL} ({promotion.PROMOTION_CODE})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {hasPromotionCategoryMismatch && (
              <div role="status" className="flex items-start gap-2 rounded-[4px] border border-warning/40 bg-warning-bg px-2.5 py-2 text-[11.5px] text-warning-ink">
                <AlertCircle size={13} className="mt-px shrink-0" />
                {tr("This section's category differs from the promotion's category. Authorization follows the section category.")}
              </div>
            )}
          </form>
        )}
      </Modal>

      {/* Add / edit group — the period is chosen on the page, so the dialog only
          carries the group's own code and label and shows the target period. */}
      <Modal
        open={!!groupEditor}
        onClose={closeGroupEditor}
        title={groupEditor?.id ? tr('Edit Teaching Group') : tr('Add Teaching Group')}
        maxWidth="max-w-[540px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[10px] text-ink-3">
              {groupEditor?.id ? `#${groupEditor.id}` : scopeLabel || tr('New record')}
            </span>
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" onClick={closeGroupEditor} disabled={savingGroup}>
                {tr('Cancel')}
              </Button>
              <Button type="submit" form="group-form" size="sm" loading={savingGroup}>
                <Save size={12} /> {savingGroup ? tr('Saving…') : tr('Save')}
              </Button>
            </div>
          </div>
        }
      >
        {groupEditor && (
          <form id="group-form" onSubmit={saveGroup} className="space-y-3.5">
            {groupError && <FieldError>{groupError}</FieldError>}

            {scopeLabel && (
              <div className="flex items-center gap-2 rounded-[4px] border border-line bg-surface-muted px-2.5 py-1.5">
                <span className="kicker text-[9px]">{tr('Scope')}</span>
                <span className="text-[11.5px] text-ink-2">{scopeLabel}</span>
              </div>
            )}

            <div>
              <label htmlFor="group-code" className="kicker mb-1 block text-[9px]">
                {tr('Group Code')} *
              </label>
              <input
                id="group-code"
                type="text"
                autoComplete="off"
                required
                value={groupEditor.form.TEACHING_GROUP_CODE}
                onChange={(e) => setGroupForm({ ...groupEditor.form, TEACHING_GROUP_CODE: e.target.value })}
                placeholder={tr('e.g. G-01')}
                className="field mono text-[12px]"
              />
            </div>

            <LocalizedInput
              base="TEACHING_GROUP_LABEL"
              form={groupEditor.form}
              setForm={setGroupForm}
              label={tr('Teaching Group Label')}
              required
              inputClassName="field text-[12px]"
            />

            <div>
              <label htmlFor="group-category" className="kicker mb-1 block text-[9px]">
                {tr('Teaching category')}
              </label>
              <select
                id="group-category"
                value={groupEditor.form.TEACHING_CATEGORY_ID}
                onChange={(e) => setGroupForm({ ...groupEditor.form, TEACHING_CATEGORY_ID: e.target.value })}
                className="field text-[12px]"
              >
                <option value="">{tr('No category')}</option>
                {groupCategories.map((category) => (
                  <option key={category.TEACHING_CATEGORY_ID} value={category.TEACHING_CATEGORY_ID}>
                    {category.TEACHING_CATEGORY_LABEL
                      || category.TEACHING_CATEGORY_LABEL_EN
                      || category.TEACHING_CATEGORY_LABEL_AR
                      || category.TEACHING_CATEGORY_LABEL_FR
                      || `#${category.TEACHING_CATEGORY_ID}`}
                  </option>
                ))}
              </select>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.kind === 'group' ? tr('Delete Teaching Group') : tr('Delete Section')}
        message={confirmTarget?.kind === 'group' ? tr('Delete this teaching group?') : tr('Delete this section?')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          const target = confirmTarget
          setConfirmTarget(null)
          if (target?.kind === 'group') handleDeleteGroup(target.id)
          else handleDeleteSection(target.id)
        }}
      />
    </div>
  )
}

export default Sections
