import React, { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Edit2, Check, X, GraduationCap, ChevronDown, ChevronRight, BookOpen, Scale } from 'lucide-react'
import ConfirmDialog from './ui/ConfirmDialog'
import DataTable from './ui/DataTable'
import Modal from './ui/Modal'
import FilterBar, { FilterField, FilterSearchField, filterInputCls } from './ui/FilterBar'
import LocalizedInput, { hasLocalizedValue } from './ui/LocalizedInput'
import MultiSelect from './ui/MultiSelect'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'
import { pickCurrentYearId, pickCurrentSemesterId } from '../scheduleUtils'
import { useCurrentPeriodSync } from '../useCurrentPeriod'

const DELETE_CONFIRMS = {
  category: {
    title: 'Delete Category',
    message: 'Are you sure you want to delete this category? Majors using this category will have it removed.'
  },
  major: { title: 'Delete Major', message: 'Are you sure you want to delete this major?' },
  chapter: {
    title: 'Delete Chapter',
    message: 'Are you sure you want to delete this chapter? All lessons in this chapter will also be deleted.'
  },
  lesson: { title: 'Delete Lesson', message: 'Are you sure you want to delete this lesson?' }
}

const Majors = () => {
  const [majors, setMajors] = useState([])
  const [categories, setCategories] = useState([])
  const [teachers, setTeachers] = useState([])
  const [majorTeachers, setMajorTeachers] = useState({})
  const [chapters, setChapters] = useState({})
  const [lessons, setLessons] = useState({})
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  // List filters (grouped behind the toolbar Filters button).
  const [majorCategoryFilter, setMajorCategoryFilter] = useState('')
  const [majorTeacherFilter, setMajorTeacherFilter] = useState('')
  const [majorSortBy, setMajorSortBy] = useState('code')
  // The category manager is a register of its own, so it browses on its own.
  const [categorySearch, setCategorySearch] = useState('')
  const [categorySortBy, setCategorySortBy] = useState('code')
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ MAJOR_CODE: '', MAJOR_LABEL_EN: '', MAJOR_LABEL_AR: '', MAJOR_LABEL_FR: '', MAJOR_CATEGORY_ID: '', MAJOR_TEACHER_IDS: [] })
  const [newMajor, setNewMajor] = useState({ MAJOR_CODE: '', MAJOR_LABEL_EN: '', MAJOR_LABEL_AR: '', MAJOR_LABEL_FR: '', MAJOR_CATEGORY_ID: '', MAJOR_TEACHER_IDS: [] })
  // Create forms live in modals opened by header buttons.
  const [showAddMajorModal, setShowAddMajorModal] = useState(false)
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false)
  
  const [categoryEditingId, setCategoryEditingId] = useState(null)
  const [categoryEditForm, setCategoryEditForm] = useState({ MAJOR_CATEGORY_CODE: '', MAJOR_CATEGORY_LABEL_EN: '', MAJOR_CATEGORY_LABEL_AR: '', MAJOR_CATEGORY_LABEL_FR: '' })
  const [newCategory, setNewCategory] = useState({ MAJOR_CATEGORY_CODE: '', MAJOR_CATEGORY_LABEL_EN: '', MAJOR_CATEGORY_LABEL_AR: '', MAJOR_CATEGORY_LABEL_FR: '' })
  const [showCategoryManager, setShowCategoryManager] = useState(false)
  
  const [expandedMajors, setExpandedMajors] = useState({})
  const [expandedChapters, setExpandedChapters] = useState({})
  
  const [chapterEditingId, setChapterEditingId] = useState(null)
  const [chapterEditForm, setChapterEditForm] = useState({ CHAPTER_CODE: '', CHAPTER_LABEL_EN: '', CHAPTER_LABEL_AR: '', CHAPTER_LABEL_FR: '' })
  const [newChapter, setNewChapter] = useState({ CHAPTER_CODE: '', CHAPTER_LABEL_EN: '', CHAPTER_LABEL_AR: '', CHAPTER_LABEL_FR: '', MAJOR_ID: '' })
  const [showChapterForm, setShowChapterForm] = useState(null)
  
  const [lessonEditingId, setLessonEditingId] = useState(null)
  const [lessonEditForm, setLessonEditForm] = useState({ LESSON_CODE: '', LESSON_LABEL_EN: '', LESSON_LABEL_AR: '', LESSON_LABEL_FR: '' })
  const [newLesson, setNewLesson] = useState({ LESSON_CODE: '', LESSON_LABEL_EN: '', LESSON_LABEL_AR: '', LESSON_LABEL_FR: '', CHAPTER_ID: '' })
  const [showLessonForm, setShowLessonForm] = useState(null)

  // Major semester factors: the weight of each major when averaging a
  // student's semester mark across majors, for the selected semester. Factors
  // are edited inline in the majors table; empty = default weight 1.
  const [factorSemesters, setFactorSemesters] = useState([])
  const [factorYears, setFactorYears] = useState([])
  const [factorYear, setFactorYear] = useState('')
  const [selectedFactorSemester, setSelectedFactorSemester] = useState('')

  // Semester factors follow the current period while the page stays open.
  useCurrentPeriodSync([
    { rows: factorYears, pickId: pickCurrentYearId, selectedId: factorYear, setSelectedId: setFactorYear },
    { rows: factorSemesters, pickId: pickCurrentSemesterId, selectedId: selectedFactorSemester, setSelectedId: setSelectedFactorSemester }
  ])

  const [semesterFactors, setSemesterFactors] = useState({}) // MAJOR_ID -> factor (null = default 1)
  const [factorDraft, setFactorDraft] = useState({}) // MAJOR_ID -> string being typed
  const [factorEditingId, setFactorEditingId] = useState(null)
  
  const [message, setMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    fetchData()
    loadFactorYears()
  }, [])

  const loadFactorYears = async () => {
    try {
      const res = await window.api.getStudyYears()
      const data = res?.data || []
      setFactorYears(data)
      // Semester factors are edited for the current academic period by default.
      setFactorYear(data.length > 0 ? pickCurrentYearId(data) : '')
    } catch (err) {
      console.error('Failed to load years for factors', err)
    }
  }

  useEffect(() => {
    if (!factorYear) {
      setFactorSemesters([])
      setSelectedFactorSemester('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.api.getStudySemesters(factorYear)
        if (cancelled) return
        const data = res?.data || []
        setFactorSemesters(data)
        setSelectedFactorSemester(data.length > 0 ? pickCurrentSemesterId(data) : '')
      } catch (err) {
        console.error('Failed to load semesters for factors', err)
      }
    })()
    return () => { cancelled = true }
  }, [factorYear])

  useEffect(() => {
    if (!selectedFactorSemester) {
      setSemesterFactors({})
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.api.getMajorSemesterFactors(selectedFactorSemester)
        if (cancelled) return
        const map = {}
        for (const row of res?.data || []) {
          map[row.MAJOR_ID] = Number(row.MAJOR_SEMESTER_FACTOR)
        }
        setSemesterFactors(map)
      } catch (err) {
        console.error('Failed to load major semester factors', err)
      }
    })()
    return () => { cancelled = true }
  }, [selectedFactorSemester])

  const startEditingFactor = (major) => {
    setFactorEditingId(major.MAJOR_ID)
    const f = semesterFactors[major.MAJOR_ID]
    setFactorDraft({ [major.MAJOR_ID]: f != null ? String(f) : '' })
  }

  const saveFactor = async (majorId) => {
    const raw = factorDraft[majorId]
    try {
      await window.api.setMajorSemesterFactor(majorId, selectedFactorSemester, raw ?? '')
      setFactorEditingId(null)
      setFactorDraft({})
      const res = await window.api.getMajorSemesterFactors(selectedFactorSemester)
      const map = {}
      for (const row of res?.data || []) map[row.MAJOR_ID] = Number(row.MAJOR_SEMESTER_FACTOR)
      setSemesterFactors(map)
      showMessage('success', raw && String(raw).trim() !== '' ? tr('Factor saved') : tr('Factor reset to default (1)'))
    } catch (err) {
      showMessage('error', err.message)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      const [majorsRes, categoriesRes, teachersRes] = await Promise.all([
        window.api.getMajors(),
        window.api.getMajorCategories(),
        window.api.getTeachers()
      ])
      setMajors(majorsRes.data || [])
      setCategories(categoriesRes.data || [])
      setTeachers(teachersRes.data || [])
      await fetchMajorTeachers()
      await fetchChaptersForAllMajors(majorsRes.data || [])
    } catch (error) {
      showMessage('error', tr('Failed to fetch data'))
    }
    setLoading(false)
  }

  const fetchChaptersForAllMajors = async (majorsList) => {
    const chaptersMap = {}
    const lessonsMap = {}
    
    for (const major of majorsList) {
      try {
        const chaptersRes = await window.api.getChaptersByMajor(major.MAJOR_ID)
        chaptersMap[major.MAJOR_ID] = chaptersRes.data || []
        
        for (const chapter of chaptersRes.data || []) {
          const lessonsRes = await window.api.getLessonsByChapter(chapter.CHAPTER_ID)
          lessonsMap[chapter.CHAPTER_ID] = lessonsRes.data || []
        }
      } catch (error) {
        console.error(`Failed to fetch chapters for major ${major.MAJOR_ID}:`, error)
      }
    }
    
    setChapters(chaptersMap)
    setLessons(lessonsMap)
  }

  const fetchMajors = async () => {
    try {
      const result = await window.api.getMajors()
      setMajors(result.data || [])
    } catch (error) {
      showMessage('error', tr('Failed to fetch majors'))
    }
  }

  const fetchMajorTeachers = async () => {
    try {
      const result = await window.api.getMajorTeachers()
      const map = {}
      ;(result.data || []).forEach((row) => {
        const majorId = row.MAJOR_ID
        if (!map[majorId]) map[majorId] = []
        map[majorId].push(row)
      })
      setMajorTeachers(map)
    } catch (error) {
      showMessage('error', tr('Failed to fetch major teacher assignments'))
    }
  }

  const fetchCategories = async () => {
    try {
      const result = await window.api.getMajorCategories()
      setCategories(result.data || [])
    } catch (error) {
      showMessage('error', tr('Failed to fetch categories'))
    }
  }

  const showMessage = (type, text) => {
    setMessage({ type, text })
    setTimeout(() => setMessage({ type: '', text: '' }), 3000)
  }

  const handleAddMajor = async (e) => {
    e.preventDefault()
    if (!newMajor.MAJOR_CODE || !hasLocalizedValue(newMajor, 'MAJOR_LABEL')) return
    
    setLoading(true)
    try {
      const dataToSave = {
        ...newMajor,
        MAJOR_CATEGORY_ID: newMajor.MAJOR_CATEGORY_ID || null
      }
      const created = await window.api.createMajor(dataToSave)
      if (newMajor.MAJOR_TEACHER_IDS?.length) {
        await window.api.updateMajorTeachers(created.MAJOR_ID, newMajor.MAJOR_TEACHER_IDS)
      }
      setNewMajor({ MAJOR_CODE: '', MAJOR_LABEL_EN: '', MAJOR_LABEL_AR: '', MAJOR_LABEL_FR: '', MAJOR_CATEGORY_ID: '', MAJOR_TEACHER_IDS: [] })
      await Promise.all([fetchMajors(), fetchMajorTeachers()])
      setShowAddMajorModal(false)
      showMessage('success', tr('Major added successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to add major'))
    }
    setLoading(false)
  }

  const handleAddCategory = async (e) => {
    e.preventDefault()
    if (!newCategory.MAJOR_CATEGORY_CODE || !hasLocalizedValue(newCategory, 'MAJOR_CATEGORY_LABEL')) return
    
    setLoading(true)
    try {
      await window.api.createMajorCategory(newCategory)
      setNewCategory({ MAJOR_CATEGORY_CODE: '', MAJOR_CATEGORY_LABEL_EN: '', MAJOR_CATEGORY_LABEL_AR: '', MAJOR_CATEGORY_LABEL_FR: '' })
      await fetchCategories()
      setShowAddCategoryModal(false)
      showMessage('success', tr('Category added successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to add category'))
    }
    setLoading(false)
  }

  const [confirmTarget, setConfirmTarget] = useState(null)

  const handleDeleteCategory = async (id) => {
    setLoading(true)
    try {
      await window.api.deleteMajorCategory(id)
      await Promise.all([fetchCategories(), fetchMajors()])
      showMessage('success', tr('Category deleted successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to delete category'))
    }
    setLoading(false)
  }

  const handleUpdateCategory = async (id) => {
    setLoading(true)
    try {
      await window.api.updateMajorCategory(id, categoryEditForm)
      setCategoryEditingId(null)
      await Promise.all([fetchCategories(), fetchMajors()])
      showMessage('success', tr('Category updated successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to update category'))
    }
    setLoading(false)
  }

  const startEditingCategory = (category) => {
    setCategoryEditingId(category.MAJOR_CATEGORY_ID)
    setCategoryEditForm({
      MAJOR_CATEGORY_CODE: category.MAJOR_CATEGORY_CODE,
      MAJOR_CATEGORY_LABEL_EN: category.MAJOR_CATEGORY_LABEL_EN ?? category.MAJOR_CATEGORY_LABEL ?? '',
      MAJOR_CATEGORY_LABEL_AR: category.MAJOR_CATEGORY_LABEL_AR ?? '',
      MAJOR_CATEGORY_LABEL_FR: category.MAJOR_CATEGORY_LABEL_FR ?? ''
    })
  }

  const handleDeleteMajor = async (id) => {
    setLoading(true)
    try {
      await window.api.deleteMajor(id)
      await fetchMajors()
      showMessage('success', tr('Major deleted successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to delete major'))
    }
    setLoading(false)
  }

  const startEditing = (major) => {
    setEditingId(major.MAJOR_ID)
    setEditForm({
      MAJOR_CODE: major.MAJOR_CODE,
      MAJOR_LABEL_EN: major.MAJOR_LABEL_EN ?? major.MAJOR_LABEL ?? '',
      MAJOR_LABEL_AR: major.MAJOR_LABEL_AR ?? '',
      MAJOR_LABEL_FR: major.MAJOR_LABEL_FR ?? '',
      MAJOR_CATEGORY_ID: major.MAJOR_CATEGORY_ID || '',
      MAJOR_TEACHER_IDS: (majorTeachers[major.MAJOR_ID] || []).map((teacher) => String(teacher.PERSON_ID))
    })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditForm({ MAJOR_CODE: '', MAJOR_LABEL_EN: '', MAJOR_LABEL_AR: '', MAJOR_LABEL_FR: '', MAJOR_CATEGORY_ID: '', MAJOR_TEACHER_IDS: [] })
  }

  const handleUpdateMajor = async (id) => {
    setLoading(true)
    try {
      const dataToSave = {
        MAJOR_CODE: editForm.MAJOR_CODE,
        MAJOR_LABEL_EN: editForm.MAJOR_LABEL_EN,
        MAJOR_LABEL_AR: editForm.MAJOR_LABEL_AR,
        MAJOR_LABEL_FR: editForm.MAJOR_LABEL_FR,
        MAJOR_CATEGORY_ID: editForm.MAJOR_CATEGORY_ID || null
      }
      await window.api.updateMajor(id, dataToSave)
      await window.api.updateMajorTeachers(id, editForm.MAJOR_TEACHER_IDS || [])
      setEditingId(null)
      await Promise.all([fetchMajors(), fetchMajorTeachers()])
      showMessage('success', tr('Major updated successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to update major'))
    }
    setLoading(false)
  }

  const handleAddChapter = async (e) => {
    e.preventDefault()
    if (!newChapter.CHAPTER_CODE || !hasLocalizedValue(newChapter, 'CHAPTER_LABEL') || !newChapter.MAJOR_ID) return
    
    setLoading(true)
    try {
      await window.api.createChapter(newChapter)
      setNewChapter({ CHAPTER_CODE: '', CHAPTER_LABEL_EN: '', CHAPTER_LABEL_AR: '', CHAPTER_LABEL_FR: '', MAJOR_ID: '' })
      setShowChapterForm(null)
      await fetchChaptersForAllMajors(majors)
      showMessage('success', tr('Chapter added successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to add chapter'))
    }
    setLoading(false)
  }

  const handleUpdateChapter = async (id) => {
    setLoading(true)
    try {
      await window.api.updateChapter(id, chapterEditForm)
      setChapterEditingId(null)
      setChapterEditForm({ CHAPTER_CODE: '', CHAPTER_LABEL_EN: '', CHAPTER_LABEL_AR: '', CHAPTER_LABEL_FR: '' })
      await fetchChaptersForAllMajors(majors)
      showMessage('success', tr('Chapter updated successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to update chapter'))
    }
    setLoading(false)
  }

  const handleDeleteChapter = async (id) => {
    setLoading(true)
    try {
      await window.api.deleteChapter(id)
      await fetchChaptersForAllMajors(majors)
      showMessage('success', tr('Chapter deleted successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to delete chapter'))
    }
    setLoading(false)
  }

  const startEditingChapter = (chapter) => {
    setChapterEditingId(chapter.CHAPTER_ID)
    setChapterEditForm({
      CHAPTER_CODE: chapter.CHAPTER_CODE,
      CHAPTER_LABEL_EN: chapter.CHAPTER_LABEL_EN ?? chapter.CHAPTER_LABEL ?? '',
      CHAPTER_LABEL_AR: chapter.CHAPTER_LABEL_AR ?? '',
      CHAPTER_LABEL_FR: chapter.CHAPTER_LABEL_FR ?? ''
    })
  }

  const handleAddLesson = async (e) => {
    e.preventDefault()
    if (!newLesson.LESSON_CODE || !hasLocalizedValue(newLesson, 'LESSON_LABEL') || !newLesson.CHAPTER_ID) return
    
    setLoading(true)
    try {
      await window.api.createLesson(newLesson)
      setNewLesson({ LESSON_CODE: '', LESSON_LABEL_EN: '', LESSON_LABEL_AR: '', LESSON_LABEL_FR: '', CHAPTER_ID: '' })
      setShowLessonForm(null)
      await fetchChaptersForAllMajors(majors)
      showMessage('success', tr('Lesson added successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to add lesson'))
    }
    setLoading(false)
  }

  const handleUpdateLesson = async (id) => {
    setLoading(true)
    try {
      await window.api.updateLesson(id, lessonEditForm)
      setLessonEditingId(null)
      setLessonEditForm({ LESSON_CODE: '', LESSON_LABEL_EN: '', LESSON_LABEL_AR: '', LESSON_LABEL_FR: '' })
      await fetchChaptersForAllMajors(majors)
      showMessage('success', tr('Lesson updated successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to update lesson'))
    }
    setLoading(false)
  }

  const handleDeleteLesson = async (id) => {
    setLoading(true)
    try {
      await window.api.deleteLesson(id)
      await fetchChaptersForAllMajors(majors)
      showMessage('success', tr('Lesson deleted successfully'))
    } catch (error) {
      showMessage('error', tr('Failed to delete lesson'))
    }
    setLoading(false)
  }

  const startEditingLesson = (lesson) => {
    setLessonEditingId(lesson.LESSON_ID)
    setLessonEditForm({
      LESSON_CODE: lesson.LESSON_CODE,
      LESSON_LABEL_EN: lesson.LESSON_LABEL_EN ?? lesson.LESSON_LABEL ?? '',
      LESSON_LABEL_AR: lesson.LESSON_LABEL_AR ?? '',
      LESSON_LABEL_FR: lesson.LESSON_LABEL_FR ?? ''
    })
  }

  const toggleMajorExpand = (majorId) => {
    setExpandedMajors(prev => ({ ...prev, [majorId]: !prev[majorId] }))
  }

  const toggleChapterExpand = (chapterId) => {
    setExpandedChapters(prev => ({ ...prev, [chapterId]: !prev[chapterId] }))
  }

  // Ordering the catalogue: code order reads like the register, but reviewing a
  // semester means looking at the weights, and staffing means looking at the
  // teachers, so both are sortable too.
  const compareMajors = (a, b) => {
    if (majorSortBy === 'teachers') {
      return (majorTeachers[b.MAJOR_ID] || []).length - (majorTeachers[a.MAJOR_ID] || []).length
    }
    if (majorSortBy === 'factor') {
      const value = (major) => {
        const raw = semesterFactors[major.MAJOR_ID]
        return raw === null || raw === undefined || raw === '' ? 1 : Number(raw) || 0
      }
      return value(b) - value(a)
    }
    if (majorSortBy === 'category') {
      return String(a.MAJOR_CATEGORY_LABEL || '').localeCompare(String(b.MAJOR_CATEGORY_LABEL || ''))
    }
    if (majorSortBy === 'label') {
      return String(a.MAJOR_LABEL || '').localeCompare(String(b.MAJOR_LABEL || ''))
    }
    return String(a.MAJOR_CODE || '').localeCompare(String(b.MAJOR_CODE || ''))
  }

  const filteredMajors = majors
    .filter(major => {
      const teachers = majorTeachers[major.MAJOR_ID] || []
      const teacherText = teachers
        .map((teacher) => `${teacher.PERSON_FIRST_NAME || ''} ${teacher.PERSON_LAST_NAME || ''}`.trim())
        .filter(Boolean)
        .join(' ')

      if (searchTerm) {
        const needle = searchTerm.toLowerCase()
        if (!(
          (major.MAJOR_LABEL?.toLowerCase() || '').includes(needle) ||
          (major.MAJOR_CODE?.toLowerCase() || '').includes(needle) ||
          (major.MAJOR_CATEGORY_LABEL?.toLowerCase() || '').includes(needle) ||
          teacherText.toLowerCase().includes(needle)
        )) return false
      }
      if (majorCategoryFilter === '__none__') {
        if (major.MAJOR_CATEGORY_ID) return false
      } else if (majorCategoryFilter && String(major.MAJOR_CATEGORY_ID || '') !== majorCategoryFilter) {
        return false
      }
      if (majorTeacherFilter && !teachers.some((teacher) => String(teacher.PERSON_ID) === majorTeacherFilter)) {
        return false
      }
      return true
    })
    .sort(compareMajors)

  const majorFilterCount = (searchTerm ? 1 : 0) + (majorCategoryFilter ? 1 : 0) + (majorTeacherFilter ? 1 : 0)

  const filteredCategories = categories
    .filter((category) => {
      if (!categorySearch) return true
      const needle = categorySearch.toLowerCase()
      return (category.MAJOR_CATEGORY_CODE?.toLowerCase() || '').includes(needle) ||
        (category.MAJOR_CATEGORY_LABEL?.toLowerCase() || '').includes(needle)
    })
    .sort((a, b) => (categorySortBy === 'label'
      ? String(a.MAJOR_CATEGORY_LABEL || '').localeCompare(String(b.MAJOR_CATEGORY_LABEL || ''))
      : String(a.MAJOR_CATEGORY_CODE || '').localeCompare(String(b.MAJOR_CATEGORY_CODE || ''))))

  const categoryFilterCount = categorySearch ? 1 : 0

  // Both major dialogs pick from the same faculty directory.
  const teacherOptions = useMemo(
    () => teachers.map((teacher) => ({
      value: String(teacher.PERSON_ID),
      label: `${teacher.PERSON_FIRST_NAME || ''} ${teacher.PERSON_LAST_NAME || ''}`.trim() || tr('Teacher')
    })),
    [teachers]
  )

  return (
    <div className="space-y-6">
      <PageIntro
        kicker={tr('Reference data')}
        title={tr('Majors Management')}
        actions={
          <>
            <button
              onClick={() => setShowCategoryManager(!showCategoryManager)}
              className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {showCategoryManager ? tr('Show Majors') : tr('Manage Categories')}
            </button>
            <button
              type="button"
              onClick={() => showCategoryManager ? setShowAddCategoryModal(true) : setShowAddMajorModal(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold text-on-jade hover:brightness-110"
              style={{ color: 'var(--color-on-jade)' }}
            >
              <Plus size={13} /> {showCategoryManager ? tr('Add Category') : tr('Add Major')}
            </button>
            {message.text && (
              <div className={`px-4 py-2 rounded-md text-[12.5px] font-medium ${
                message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {message.text}
              </div>
            )}
          </>
        }
      />

      {/* Semester factor picker: shown with the majors table */}
      {!showCategoryManager && (
        <div className="bg-white rounded-md border border-line p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-[12.5px] text-ink-2 font-medium">
            <Scale size={15} className="text-blue-600" />{' '}{tr("Semester factor (weight of each major in the semester average):")}</div>
          <select
            value={factorYear}
            onChange={(e) => setFactorYear(e.target.value)}
            className="bg-surface-muted border border-line text-ink-2 text-[12.5px] rounded-md focus:ring-blue-500 focus:border-blue-500 p-2"
          >
            {factorYears.length === 0 && <option value="">{tr("No years")}</option>}
            {factorYears.map(y => (
              <option key={y.STUDY_YEAR_ID} value={y.STUDY_YEAR_ID}>{y.STUDY_YEAR_LABEL}</option>
            ))}
          </select>
          <select
            value={selectedFactorSemester}
            onChange={(e) => setSelectedFactorSemester(e.target.value)}
            className="bg-surface-muted border border-line text-ink-2 text-[12.5px] rounded-md focus:ring-blue-500 focus:border-blue-500 p-2"
            disabled={!factorYear}
          >
            {factorSemesters.length === 0 && <option value="">{tr("No semesters")}</option>}
            {factorSemesters.map(s => (
              <option key={s.STUDY_SEMESTER_ID} value={s.STUDY_SEMESTER_ID}>{s.STUDY_SEMESTER_LABEL}</option>
            ))}
          </select>
          <span className="text-[11px] text-ink-3">{tr("Leave a factor empty to use the default weight (1). Factors apply per semester.")}</span>
        </div>
      )}

      {/* Create-category modal: opened by the header button while the
          category manager is shown. */}
      <Modal open={showAddCategoryModal} onClose={() => setShowAddCategoryModal(false)} maxWidth="max-w-2xl" title={tr("Add Category")}>
              <form onSubmit={handleAddCategory} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Category Code")}</label>
                  <input
                    type="text"
                    placeholder={tr("e.g. STEM, ART, BUS")}
                    className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    value={newCategory.MAJOR_CATEGORY_CODE}
                    onChange={(e) => setNewCategory({ ...newCategory, MAJOR_CATEGORY_CODE: e.target.value })}
                    required
                  />
                </div>
                <LocalizedInput
                  base="MAJOR_CATEGORY_LABEL"
                  form={newCategory}
                  setForm={setNewCategory}
                  stacked
                  label={tr("Category Label")}
                  required
                  inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-jade-solid text-on-jade py-2.5 rounded-md text-[12.5px] font-semibold hover:brightness-110 transition-colors flex items-center justify-center"
                >
                  <Plus size={18} className="mr-2" />{' '}{tr("Add Category")}</button>
              </form>
      </Modal>

      {showCategoryManager && (
      <div className="bg-white rounded-md border border-line overflow-hidden">
              <div className="p-4 border-b border-line flex justify-between items-center bg-surface-muted">
                <h2 className="kicker">{tr("Major Categories")}</h2>
                <div className="flex items-center gap-3">
                  <div className="text-[12.5px] text-ink-3">{tr("Total:")}{' '}{filteredCategories.length}
                  </div>
                  <FilterBar
                    activeCount={categoryFilterCount}
                    onClear={() => setCategorySearch('')}
                    matchCount={filteredCategories.length}
                    matchLabel="category"
                    title={tr("Filter Categories")}
                  >
                    <FilterSearchField
                      placeholder={tr("Search categories...")}
                      value={categorySearch}
                      onChange={(v) => setCategorySearch(v)}
                    />
                    <FilterField label={tr("Sort by")}>
                      <select
                        className={filterInputCls}
                        value={categorySortBy}
                        onChange={e => setCategorySortBy(e.target.value)}
                      >
                        <option value="code">{tr("Code")}</option>
                        <option value="label">{tr("Label")}</option>
                      </select>
                    </FilterField>
                  </FilterBar>
                </div>
              </div>

              <div className="overflow-x-auto">
                <DataTable
                  bodyClassName="divide-y divide-line"
                  className="w-full text-left border-collapse"
                  headClassName="bg-surface-muted text-ink-2 text-[11px] uppercase tracking-wider"
                  columns={[
                    { key: 'c0', className: "px-6 py-4 font-semibold", header: <>{tr("Code")}</> },
                    { key: 'c1', className: "px-6 py-4 font-semibold", header: <>{tr("Label")}</> },
                    { key: 'c2', className: "px-6 py-4 font-semibold text-right", header: <>{tr("Actions")}</> },
                  ]}
                >
                    {filteredCategories.map((category, index) => (
                      <tr key={category.MAJOR_CATEGORY_ID || index} className="hover:bg-surface-muted transition-colors">
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-purple-100 text-purple-800">
                            {category.MAJOR_CATEGORY_CODE}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-[12.5px] text-ink-2 font-medium">{category.MAJOR_CATEGORY_LABEL}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => startEditingCategory(category)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              title={tr("Edit")}
                            >
                              <Edit2 size={18} />
                            </button>
                            <button
                              onClick={() => setConfirmTarget({ kind: 'category', id: category.MAJOR_CATEGORY_ID })}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              title={tr("Delete")}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredCategories.length === 0 && (
                      <tr>
                        <td colSpan="3" className="px-6 py-10 text-center text-ink-3 italic text-[12.5px]">{categorySearch ? tr("No category matches this search.") : tr("No categories found.")}</td>
                      </tr>
                    )}
                </DataTable>
              </div>
      </div>
      )}

      {/* Create-major modal: opened by the header button. */}
      <Modal open={showAddMajorModal} onClose={() => setShowAddMajorModal(false)} maxWidth="max-w-2xl" title={tr("Add Major")}>
              <form onSubmit={handleAddMajor} className="space-y-4">
                {/* The teachers list stands beside the rest of the form: it is
                    the one field that grows with the faculty, so it gets a
                    column of its own instead of pushing everything else up. */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Major Code")}</label>
                      <input
                        type="text"
                        placeholder={tr("e.g. CS, MATH, BIO")}
                        className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        value={newMajor.MAJOR_CODE}
                        onChange={(e) => setNewMajor({ ...newMajor, MAJOR_CODE: e.target.value })}
                        required
                      />
                    </div>
                    <LocalizedInput
                      base="MAJOR_LABEL"
                      form={newMajor}
                      setForm={setNewMajor}
                      stacked
                      label={tr("Major Label")}
                      required
                      inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                    <div>
                      <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Category")}</label>
                      <select
                        className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                        value={newMajor.MAJOR_CATEGORY_ID}
                        onChange={(e) => setNewMajor({ ...newMajor, MAJOR_CATEGORY_ID: e.target.value })}
                      >
                        <option value="">{tr("No Category")}</option>
                        {categories.map((cat, index) => (
                          <option key={cat.MAJOR_CATEGORY_ID || index} value={cat.MAJOR_CATEGORY_ID}>
                            {cat.MAJOR_CATEGORY_LABEL}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Teachers")}</label>
                    <MultiSelect
                      options={teacherOptions}
                      values={newMajor.MAJOR_TEACHER_IDS}
                      onChange={(next) => setNewMajor({ ...newMajor, MAJOR_TEACHER_IDS: next })}
                      placeholder={tr('Select teachers')}
                      emptyLabel={tr('No teachers found')}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-jade-solid text-on-jade py-2.5 rounded-md text-[12.5px] font-semibold hover:brightness-110 transition-colors flex items-center justify-center"
                >
                  <Plus size={18} className="mr-2" />{' '}{tr("Add Major")}</button>
              </form>
      </Modal>

      {/* Edit modals: opened by the pencil on a row, so the lists themselves
          stay read-only and the form gets the room it needs. */}
      <Modal open={!!editingId} onClose={cancelEditing} maxWidth="max-w-2xl" title={tr("Edit Major")}>
        <form onSubmit={(e) => { e.preventDefault(); handleUpdateMajor(editingId) }} className="space-y-4">
          {/* Same two-column shape as the create dialog: the form on one side,
              the teachers list on the other. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Major Code")}</label>
                <input
                  type="text"
                  className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={editForm.MAJOR_CODE}
                  onChange={(e) => setEditForm({ ...editForm, MAJOR_CODE: e.target.value })}
                  required
                />
              </div>
              <LocalizedInput
                base="MAJOR_LABEL"
                form={editForm}
                setForm={setEditForm}
                stacked
                label={tr("Major Label")}
                required
                inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <div>
                <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Category")}</label>
                <select
                  className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={editForm.MAJOR_CATEGORY_ID}
                  onChange={(e) => setEditForm({ ...editForm, MAJOR_CATEGORY_ID: e.target.value })}
                >
                  <option value="">{tr("No Category")}</option>
                  {categories.map((cat, index) => (
                    <option key={cat.MAJOR_CATEGORY_ID || index} value={cat.MAJOR_CATEGORY_ID}>
                      {cat.MAJOR_CATEGORY_LABEL}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Teachers")}</label>
              <MultiSelect
                options={teacherOptions}
                values={editForm.MAJOR_TEACHER_IDS}
                onChange={(next) => setEditForm({ ...editForm, MAJOR_TEACHER_IDS: next })}
                placeholder={tr('Select teachers')}
                emptyLabel={tr('No teachers found')}
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={cancelEditing}
              className="px-3 py-2 text-[12.5px] text-ink-2 hover:bg-surface-muted rounded-md"
            >{tr("Cancel")}</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-jade-solid text-on-jade rounded-md text-[12.5px] font-semibold hover:brightness-110 disabled:opacity-60 transition-colors"
            >{tr("Save")}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!categoryEditingId} onClose={() => setCategoryEditingId(null)} maxWidth="max-w-2xl" title={tr("Edit Category")}>
        <form onSubmit={(e) => { e.preventDefault(); handleUpdateCategory(categoryEditingId) }} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Category Code")}</label>
            <input
              type="text"
              className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={categoryEditForm.MAJOR_CATEGORY_CODE}
              onChange={(e) => setCategoryEditForm({ ...categoryEditForm, MAJOR_CATEGORY_CODE: e.target.value })}
              required
            />
          </div>
          <LocalizedInput
            base="MAJOR_CATEGORY_LABEL"
            form={categoryEditForm}
            setForm={setCategoryEditForm}
            stacked
            label={tr("Category Label")}
            required
            inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setCategoryEditingId(null)}
              className="px-3 py-2 text-[12.5px] text-ink-2 hover:bg-surface-muted rounded-md"
            >{tr("Cancel")}</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-jade-solid text-on-jade rounded-md text-[12.5px] font-semibold hover:brightness-110 disabled:opacity-60 transition-colors"
            >{tr("Save")}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!chapterEditingId} onClose={() => setChapterEditingId(null)} maxWidth="max-w-2xl" title={tr("Edit Chapter")}>
        <form onSubmit={(e) => { e.preventDefault(); handleUpdateChapter(chapterEditingId) }} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Chapter Code")}</label>
            <input
              type="text"
              className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={chapterEditForm.CHAPTER_CODE}
              onChange={(e) => setChapterEditForm({ ...chapterEditForm, CHAPTER_CODE: e.target.value })}
              required
            />
          </div>
          <LocalizedInput
            base="CHAPTER_LABEL"
            form={chapterEditForm}
            setForm={setChapterEditForm}
            stacked
            label={tr("Chapter Label")}
            required
            inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setChapterEditingId(null)}
              className="px-3 py-2 text-[12.5px] text-ink-2 hover:bg-surface-muted rounded-md"
            >{tr("Cancel")}</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-jade-solid text-on-jade rounded-md text-[12.5px] font-semibold hover:brightness-110 disabled:opacity-60 transition-colors"
            >{tr("Save")}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!lessonEditingId} onClose={() => setLessonEditingId(null)} maxWidth="max-w-2xl" title={tr("Edit Lesson")}>
        <form onSubmit={(e) => { e.preventDefault(); handleUpdateLesson(lessonEditingId) }} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Lesson Code")}</label>
            <input
              type="text"
              className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={lessonEditForm.LESSON_CODE}
              onChange={(e) => setLessonEditForm({ ...lessonEditForm, LESSON_CODE: e.target.value })}
              required
            />
          </div>
          <LocalizedInput
            base="LESSON_LABEL"
            form={lessonEditForm}
            setForm={setLessonEditForm}
            stacked
            label={tr("Lesson Label")}
            required
            inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setLessonEditingId(null)}
              className="px-3 py-2 text-[12.5px] text-ink-2 hover:bg-surface-muted rounded-md"
            >{tr("Cancel")}</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-jade-solid text-on-jade rounded-md text-[12.5px] font-semibold hover:brightness-110 disabled:opacity-60 transition-colors"
            >{tr("Save")}</button>
          </div>
        </form>
      </Modal>

      {/* Add modals for the nested rows: the chapter/lesson "Add" buttons used to
          unfold a form inside the expanded row, which crowded the list. */}
      <Modal open={showChapterForm != null} onClose={() => setShowChapterForm(null)} maxWidth="max-w-2xl" title={tr("Add Chapter")}>
        <form onSubmit={handleAddChapter} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Chapter Code")}</label>
            <input
              type="text"
              placeholder={tr("e.g. CH1")}
              className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={newChapter.CHAPTER_CODE}
              onChange={(e) => setNewChapter({ ...newChapter, CHAPTER_CODE: e.target.value })}
              required
            />
          </div>
          <LocalizedInput
            base="CHAPTER_LABEL"
            form={newChapter}
            setForm={setNewChapter}
            stacked
            label={tr("Chapter Label")}
            required
            inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setShowChapterForm(null)}
              className="px-3 py-2 text-[12.5px] text-ink-2 hover:bg-surface-muted rounded-md"
            >{tr("Cancel")}</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-jade-solid text-on-jade rounded-md text-[12.5px] font-semibold hover:brightness-110 disabled:opacity-60 transition-colors"
            >{tr("Add Chapter")}</button>
          </div>
        </form>
      </Modal>

      <Modal open={showLessonForm != null} onClose={() => setShowLessonForm(null)} maxWidth="max-w-2xl" title={tr("Add Lesson")}>
        <form onSubmit={handleAddLesson} className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-ink-3 mb-1">{tr("Lesson Code")}</label>
            <input
              type="text"
              placeholder={tr("e.g. L1")}
              className="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={newLesson.LESSON_CODE}
              onChange={(e) => setNewLesson({ ...newLesson, LESSON_CODE: e.target.value })}
              required
            />
          </div>
          <LocalizedInput
            base="LESSON_LABEL"
            form={newLesson}
            setForm={setNewLesson}
            stacked
            label={tr("Lesson Label")}
            required
            inputClassName="w-full px-3.5 py-3 border rounded-md text-[14px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
          <div className="flex justify-end space-x-2 pt-1">
            <button
              type="button"
              onClick={() => setShowLessonForm(null)}
              className="px-3 py-2 text-[12.5px] text-ink-2 hover:bg-surface-muted rounded-md"
            >{tr("Cancel")}</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-purple-600 text-white rounded-md text-[12.5px] font-semibold hover:bg-purple-700 disabled:opacity-60 transition-colors"
            >{tr("Add Lesson")}</button>
          </div>
        </form>
      </Modal>

      {/* Majors List */}
      {!showCategoryManager && (
      <div className="bg-white rounded-md border border-line overflow-hidden">
              <div className="p-4 border-b border-line flex justify-between items-center bg-surface-muted">
                <div className="text-[12.5px] text-ink-3 font-medium">{tr("Total:")}{' '}{filteredMajors.length}
                </div>
                <FilterBar
                  activeCount={majorFilterCount}
                  onClear={() => {
                    setSearchTerm('')
                    setMajorCategoryFilter('')
                    setMajorTeacherFilter('')
                  }}
                  matchCount={filteredMajors.length}
                  matchLabel="major"
                  title={tr("Filter Majors")}
                >
                  <FilterSearchField
                    placeholder={tr("Search majors...")}
                    value={searchTerm}
                    onChange={(v) => setSearchTerm(v)}
                  />
                  <FilterField label={tr("Category")}>
                    <select
                      className={filterInputCls}
                      value={majorCategoryFilter}
                      onChange={e => setMajorCategoryFilter(e.target.value)}
                    >
                      <option value="">{tr("All categories")}</option>
                      <option value="__none__">{tr("Uncategorized")}</option>
                      {categories.map(c => (
                        <option key={c.MAJOR_CATEGORY_ID} value={c.MAJOR_CATEGORY_ID}>
                          {c.MAJOR_CATEGORY_LABEL}
                        </option>
                      ))}
                    </select>
                  </FilterField>
                  <FilterField label={tr("Teacher")}>
                    <select
                      className={filterInputCls}
                      value={majorTeacherFilter}
                      onChange={e => setMajorTeacherFilter(e.target.value)}
                    >
                      <option value="">{tr("All teachers")}</option>
                      {teacherOptions.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </FilterField>
                  <FilterField label={tr("Sort by")}>
                    <select
                      className={filterInputCls}
                      value={majorSortBy}
                      onChange={e => setMajorSortBy(e.target.value)}
                    >
                      <option value="code">{tr("Major code")}</option>
                      <option value="label">{tr("Major label")}</option>
                      <option value="category">{tr("Category")}</option>
                      <option value="teachers">{tr("Number of teachers")}</option>
                      <option value="factor">{tr("Semester factor")}</option>
                    </select>
                  </FilterField>
                </FilterBar>
              </div>

              <div className="overflow-x-auto">
                <DataTable
                  bodyClassName="divide-y divide-line"
                  className="w-full text-left border-collapse"
                  headClassName="bg-surface-muted text-ink-2 text-[11px] uppercase tracking-wider"
                  columns={[
                    { key: 'c0', className: "px-6 py-4 font-semibold", header: <>{tr("Code")}</> },
                    { key: 'c1', className: "px-6 py-4 font-semibold", header: <>{tr("Major Label")}</> },
                    { key: 'c2', className: "px-6 py-4 font-semibold", header: <>{tr("Category")}</> },
                    { key: 'c3', className: "px-6 py-4 font-semibold", header: <>{tr("Teacher")}</> },
                    { key: 'c4', className: "px-6 py-4 font-semibold", header: <><span className="inline-flex items-center gap-1"><Scale size={12} />{' '}{tr("Factor")}</span></> },
                    { key: 'c5', className: "px-6 py-4 font-semibold text-right", header: <>{tr("Actions")}</> },
                  ]}
                >
                    {filteredMajors.map((major, index) => {
                      const majorChapters = chapters[major.MAJOR_ID] || []
                      return (
                        <React.Fragment key={major.MAJOR_ID || index}>
                          <tr className="hover:bg-surface-muted transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => toggleMajorExpand(major.MAJOR_ID)}
                                  className="p-1 hover:bg-surface-muted rounded transition-colors"
                                >
                                  {expandedMajors[major.MAJOR_ID] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </button>
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-800">
                                  {major.MAJOR_CODE}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-[12.5px] text-ink-2 font-medium">{major.MAJOR_LABEL}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-[12.5px] text-ink-3 italic">
                                {major.MAJOR_CATEGORY_LABEL || tr('None')}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-[12.5px] text-ink-3 italic">
                                {(majorTeachers[major.MAJOR_ID] || []).map((teacher) => `${teacher.PERSON_FIRST_NAME || ''} ${teacher.PERSON_LAST_NAME || ''}`.trim()).filter(Boolean).join(', ') || tr('None')}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              {factorEditingId === major.MAJOR_ID ? (
                                <div className="flex items-center space-x-1">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={tr("1 (default)")}
                                    className="w-20 p-1 border rounded text-[12.5px]"
                                    value={factorDraft[major.MAJOR_ID] ?? ''}
                                    onChange={(e) => setFactorDraft({ [major.MAJOR_ID]: e.target.value })}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveFactor(major.MAJOR_ID)
                                      if (e.key === 'Escape') setFactorEditingId(null)
                                    }}
                                  />
                                  <button
                                    onClick={() => saveFactor(major.MAJOR_ID)}
                                    className="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                                    title={tr("Save factor")}
                                  >
                                    <Check size={16} />
                                  </button>
                                  <button
                                    onClick={() => setFactorEditingId(null)}
                                    className="p-1.5 text-ink-3 hover:bg-surface-muted rounded-md transition-colors"
                                    title={tr("Cancel")}
                                  >
                                    <X size={16} />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEditingFactor(major)}
                                  disabled={!selectedFactorSemester}
                                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-surface-muted text-ink-2 hover:bg-blue-100 hover:text-blue-800 disabled:opacity-50 transition-colors"
                                  title={tr("Click to edit the factor for the selected semester")}
                                >
                                  ×{semesterFactors[major.MAJOR_ID] != null ? semesterFactors[major.MAJOR_ID] : '1'}
                                </button>
                              )}
                            </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end space-x-2">
                            <button
                              onClick={() => startEditing(major)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              title={tr("Edit")}
                            >
                              <Edit2 size={18} />
                            </button>
                            <button
                              onClick={() => setConfirmTarget({ kind: 'major', id: major.MAJOR_ID })}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              title={tr("Delete")}
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedMajors[major.MAJOR_ID] && (
                        <tr>
                          <td colSpan="6" className="px-6 py-4 bg-surface-muted">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h3 className="text-[12.5px] font-semibold text-ink-2 flex items-center">
                                  <BookOpen size={16} className="mr-2" />{' '}{tr("Chapters (")}{majorChapters.length})
                                </h3>
                                <button
                                  onClick={() => {
                                    const next = showChapterForm === major.MAJOR_ID ? null : major.MAJOR_ID
                                    setShowChapterForm(next)
                                    if (next) setNewChapter((prev) => ({ ...prev, MAJOR_ID: major.MAJOR_ID }))
                                  }}
                                  className="px-3 py-1.5 bg-jade-solid text-on-jade text-[11px] rounded-md hover:brightness-110 transition-colors flex items-center"
                                >
                                  <Plus size={14} className="mr-1" />{' '}{tr("Add Chapter")}</button>
                              </div>
                              
                              
                              {majorChapters.length === 0 ? (
                                <p className="text-[12.5px] text-ink-3 italic">{tr("No chapters yet. Click \"Add Chapter\" to create one.")}</p>
                              ) : (
                                <div className="space-y-2">
                                  {majorChapters.map((chapter, index) => {
                                    const chapterLessons = lessons[chapter.CHAPTER_ID] || []
                                    return (
                                      <div key={chapter.CHAPTER_ID || index} className="bg-white rounded-md border border-line overflow-hidden">
                                        <div className="p-3 flex items-center justify-between bg-surface-muted">
                                          <div className="flex items-center space-x-2 flex-1">
                                            <button
                                              onClick={() => toggleChapterExpand(chapter.CHAPTER_ID)}
                                              className="p-1 hover:bg-surface-muted rounded transition-colors"
                                            >
                                              {expandedChapters[chapter.CHAPTER_ID] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </button>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-800">
                                              {chapter.CHAPTER_CODE}
                                            </span>
                                            <span className="text-[12.5px] text-ink-2 font-medium">{chapter.CHAPTER_LABEL}</span>
                                            <span className="text-[11px] text-ink-3">({chapterLessons.length}{' '}{tr("lessons)")}</span>
                                          </div>
                                          <div className="flex items-center space-x-1">
                                            <button
                                              onClick={() => startEditingChapter(chapter)}
                                              className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                              title={tr("Edit")}
                                            >
                                              <Edit2 size={16} />
                                            </button>
                                            <button
                                              onClick={() => setConfirmTarget({ kind: 'chapter', id: chapter.CHAPTER_ID })}
                                              className="p-1 text-red-600 hover:bg-red-50 rounded"
                                              title={tr("Delete")}
                                            >
                                              <Trash2 size={16} />
                                            </button>
                                          </div>
                                        </div>
                                        
                                        {expandedChapters[chapter.CHAPTER_ID] && (
                                          <div className="p-3 border-t border-line">
                                            <div className="flex items-center justify-between mb-3">
                                              <h4 className="text-[11px] font-semibold text-ink-2">{tr("Lessons")}</h4>
                                              <button
                                                onClick={() => {
                                                  const next = showLessonForm === chapter.CHAPTER_ID ? null : chapter.CHAPTER_ID
                                                  setShowLessonForm(next)
                                                  if (next) setNewLesson((prev) => ({ ...prev, CHAPTER_ID: chapter.CHAPTER_ID }))
                                                }}
                                                className="px-2 py-1 bg-purple-600 text-white text-[11px] rounded hover:bg-purple-700 transition-colors flex items-center"
                                              >
                                                <Plus size={12} className="mr-1" />{' '}{tr("Add Lesson")}</button>
                                            </div>
                                            
                                            
                                            {chapterLessons.length === 0 ? (
                                              <p className="text-[11px] text-ink-3 italic">{tr("No lessons yet.")}</p>
                                            ) : (
                                              <div className="space-y-1">
                                                {chapterLessons.map((lesson, index) => (
                                                  <div key={lesson.LESSON_ID || index} className="flex items-center justify-between p-2 bg-white rounded border border-line">
                                                    <div className="flex items-center space-x-2 flex-1">
                                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-800">
                                                        {lesson.LESSON_CODE}
                                                      </span>
                                                      <span className="text-[11px] text-ink-2">{lesson.LESSON_LABEL}</span>
                                                    </div>
                                                    <div className="flex items-center space-x-1">
                                                      <button
                                                        onClick={() => startEditingLesson(lesson)}
                                                        className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                                                        title={tr("Edit")}
                                                      >
                                                        <Edit2 size={14} />
                                                      </button>
                                                      <button
                                                        onClick={() => setConfirmTarget({ kind: 'lesson', id: lesson.LESSON_ID })}
                                                        className="p-1 text-red-600 hover:bg-red-50 rounded"
                                                        title={tr("Delete")}
                                                      >
                                                        <Trash2 size={14} />
                                                      </button>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                      )
                    })}
                    {filteredMajors.length === 0 && (
                      <tr>
                        <td colSpan="6" className="px-6 py-10 text-center text-ink-3 italic text-[12.5px]">{tr("No majors found.")}</td>
                      </tr>
                    )}
                </DataTable>
              </div>
      </div>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget ? tr(DELETE_CONFIRMS[confirmTarget.kind].title) : ''}
        message={confirmTarget ? tr(DELETE_CONFIRMS[confirmTarget.kind].message) : ''}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          const t = confirmTarget
          setConfirmTarget(null)
          if (t.kind === 'category') handleDeleteCategory(t.id)
          else if (t.kind === 'major') handleDeleteMajor(t.id)
          else if (t.kind === 'chapter') handleDeleteChapter(t.id)
          else handleDeleteLesson(t.id)
        }}
      />
    </div>
  )
}

export default Majors
