import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  CornerDownLeft,
  ArrowUpRight,
  UserRound,
  Command,
  Languages,
  LogOut,
  Moon,
  Sun,
  UserPlus
} from 'lucide-react'
import { allRoutes } from '../nav'
import { tr, useI18n, getActiveLanguage } from '../i18n'
import { resolveTheme, setTheme, useTheme } from '../theme'
import { personNameLastFirst } from '../../shared/personNames'

const MAX_SCREENS = 5
const MAX_STUDENTS = 7

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

// A row's own wording in one language, without the bracketed counterpart that
// localizedLabel adds: a result line is too narrow for "Colonel (عقيد)".
const plainLabel = (row, base, language) => {
  if (!row) return ''
  const order = [String(language || 'en').toUpperCase(), 'EN', 'AR', 'FR', 'LA']
  for (const suffix of order) {
    const value = row[`${base}_${suffix}`]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

// What identifies a student besides the name: grade, section and category.
const studentMeta = (student, language) =>
  [
    plainLabel(student, 'MILITARY_GRADE_NAME', language),
    plainLabel(student, 'SECTION_LABEL', language) || student.SECTION_CODE || '',
    plainLabel(student, 'TEACHING_CATEGORY_LABEL', language)
  ]
    .filter(Boolean)
    .join(' · ')

// Cmd/Ctrl+K: jump to any screen, or find any student by name or person id
// without leaving the keyboard. Students are fetched only when the palette
// opens, then filtered locally.
export default function CommandPalette({ open, onOpenChange, user, onLogout }) {
  const { t, setLang, languages } = useI18n()
  const navigate = useNavigate()
  const [theme] = useTheme()
  const [query, setQuery] = useState('')
  const [students, setStudents] = useState([])
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef(null)
  const inputRef = useRef(null)

  const language = getActiveLanguage()
  const routes = useMemo(() => allRoutes(user), [user])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    let cancelled = false
    setStudentsLoading(true)
    window.api
      ?.getStudentsWithSections?.(user?.id)
      .then((result) => {
        if (cancelled) return
        setStudents(result?.data || [])
      })
      .catch(() => {
        if (!cancelled) setStudents([])
      })
      .finally(() => {
        if (!cancelled) setStudentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const q = normalize(query.trim())

  const screenResults = useMemo(() => {
    if (!q) return routes.slice(0, MAX_SCREENS)
    return routes
      .map((route) => {
        const label = normalize(route.label)
        const group = normalize(route.group)
        const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : group.includes(q) ? 2 : -1
        return { route, score }
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_SCREENS)
      .map((entry) => entry.route)
  }, [routes, q])

  const studentResults = useMemo(() => {
    if (!q) return []
    const tokens = q.split(/\s+/)
    const scored = []
    for (const student of students) {
      const name = normalize(
        `${student.PERSON_FIRST_NAME || ''} ${student.PERSON_LAST_NAME || ''}`
      )
      // Everything a secretary may type to reach a student: the name, but also
      // the rank, the section, the category, the card numbers and the person id.
      const rest = normalize(
        [
          studentMeta(student, language),
          student.SECTION_CODE || '',
          student.student_military_card_number || '',
          student.student_insurance_card_number || '',
          student.PERSON_ID || ''
        ].join(' ')
      )
      if (!tokens.every((token) => name.includes(token) || rest.includes(token))) continue
      const score = tokens.every((token) => name.includes(token))
        ? name.startsWith(tokens[0])
          ? 0
          : 1
        : 2
      scored.push({ student, score })
    }
    return scored
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_STUDENTS)
      .map((entry) => entry.student)
  }, [students, q, language])

  const actions = useMemo(() => {
    const mode = resolveTheme(theme)
    const next = mode === 'dark' ? 'oled' : mode === 'oled' ? 'light' : 'dark'
    const label = mode === 'light'
      ? 'Switch to dark appearance'
      : mode === 'dark'
        ? 'Switch to pure black appearance'
        : 'Switch to light appearance'
    const list = []

    if (user?.roles?.some((role) => ['ADMIN', 'SECRETARY'].includes(role))) {
      list.push({
        id: 'register',
        label: 'Register a student',
        hint: 'Directory',
        icon: UserPlus,
        featured: true,
        run: () => navigate('/student-records?new=1')
      })
    }

    list.push({
      id: 'theme',
      label,
      hint: 'Appearance',
      icon: mode === 'light' ? Moon : Sun,
      featured: true,
      run: () => setTheme(next)
    })

    // The interface language, switched without a detour through Settings.
    for (const language of languages || []) {
      list.push({
        id: `language:${language.code}`,
        label: language.label,
        icon: Languages,
        featured: true,
        run: () => setLang(language.code)
      })
    }

    // Never offered on an empty query: signing out takes a deliberate search
    // and Enter, not a stray keystroke in the list.
    list.push({
      id: 'logout',
      label: 'Log out',
      icon: LogOut,
      danger: true,
      run: () => onLogout?.()
    })

    return q
      ? list.filter((action) =>
          normalize(`${t(action.label)} ${action.label} ${action.hint || ''}`).includes(q)
        )
      : list.filter((action) => action.featured)
  }, [theme, q, user, navigate, languages, setLang, t, onLogout])

  // One flat list keeps arrow navigation unambiguous across groups.
  const flat = useMemo(
    () => [
      ...screenResults.map((route) => ({ kind: 'route', route })),
      ...studentResults.map((student) => ({ kind: 'student', student })),
      ...actions.map((action) => ({ kind: 'action', action }))
    ],
    [screenResults, studentResults, actions]
  )

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, flat.length - 1)))
  }, [flat.length])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector('[data-index="' + active + '"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const run = (entry) => {
    if (!entry) return
    if (entry.kind === 'route') {
      navigate(entry.route.to)
    } else if (entry.kind === 'student') {
      navigate(`/student-records?person=${entry.student.PERSON_ID}`)
    } else {
      entry.action.run()
    }
    onOpenChange(false)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (flat.length ? (current + 1) % flat.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (flat.length ? (current - 1 + flat.length) % flat.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(flat[active])
    }
  }

  let cursor = -1
  const nextIndex = () => {
    cursor += 1
    return cursor
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] anim-overlay" style={{ background: 'rgba(0,0,0,0.7)' }} />
        <Dialog.Content
          aria-label={t('Command palette')}
          className="fixed inset-x-0 top-[13vh] z-[91] mx-auto flex max-h-[68vh] w-[620px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-line-strong bg-raised anim-plate"
          style={{ boxShadow: 'var(--shadow-e2)' }}
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">{t('Command palette')}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {t('Jump to a screen, find a student by name or person ID, or run an action.')}
          </Dialog.Description>
          <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
            <Search size={15} className="shrink-0 text-ink-3" />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              placeholder={t('Search students, screens, actions…')}
              aria-label={t('Search students, screens, actions')}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-results"
              className="h-full w-full bg-transparent text-[13.5px] text-ink placeholder:text-ink-3"
              style={{ outline: 'none', boxShadow: 'none' }}
            />
            <span className="kbd shrink-0">ESC</span>
          </div>

          <div id="palette-results" role="listbox" ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {screenResults.length > 0 && (
              <>
                <div className="kicker px-2 pb-1 pt-2">{t('Screens')}</div>
                {screenResults.map((route) => {
                  const Icon = route.icon
                  const index = nextIndex()
                  return (
                    <button
                      key={route.to}
                      type="button"
                      role="option"
                      aria-selected={active === index}
                      data-index={index}
                      data-active={active === index}
                      className="menu-item"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run({ kind: 'route', route })}
                    >
                      <Icon size={13} strokeWidth={1.75} className="shrink-0 opacity-75" />
                      <span className="truncate">{t(route.label)}</span>
                      <span className="ms-auto text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                        {t(route.group)}
                      </span>
                    </button>
                  )
                })}
              </>
            )}

            {studentResults.length > 0 && (
              <>
                <div className="kicker px-2 pb-1 pt-3">{t('Students')}</div>
                {studentResults.map((student) => {
                  const index = nextIndex()
                  const name = personNameLastFirst(student.PERSON_LAST_NAME, student.PERSON_FIRST_NAME)
                  const detail = studentMeta(student, language)
                  return (
                    <button
                      key={student.PERSON_ID}
                      type="button"
                      role="option"
                      aria-selected={active === index}
                      data-index={index}
                      data-active={active === index}
                      data-tall="true"
                      className="menu-item"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run({ kind: 'student', student })}
                    >
                      <UserRound size={13} strokeWidth={1.75} className="shrink-0 opacity-75" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{name}</span>
                        {detail && (
                          <span className="truncate text-[10.5px] leading-snug opacity-75">
                            {detail}
                          </span>
                        )}
                      </span>
                      <span className="mono ms-auto shrink-0 self-center text-[10.5px] text-ink-3">
                        № {String(student.PERSON_ID).padStart(4, '0')}
                      </span>
                    </button>
                  )
                })}
              </>
            )}

            {actions.length > 0 && (
              <>
                <div className="kicker px-2 pb-1 pt-3">{t('Actions')}</div>
                {actions.map((action) => {
                  const index = nextIndex()
                  const Icon = action.icon || Command
                  return (
                    <button
                      key={action.id}
                      type="button"
                      role="option"
                      aria-selected={active === index}
                      data-index={index}
                      data-active={active === index}
                      data-danger={action.danger ? 'true' : undefined}
                      className="menu-item"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => run({ kind: 'action', action })}
                    >
                      <Icon size={13} strokeWidth={1.75} className="shrink-0 opacity-75" />
                      <span className="truncate">{t(action.label)}</span>
                      {action.hint && (
                        <span className="ms-auto text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                          {t(action.hint)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </>
            )}

            {!studentsLoading && flat.length === 0 && (
              <div className="px-3 py-10 text-center">
                <p className="text-[13px] text-ink-2">{t('Nothing matches “{query}”.', { query })}</p>
                <p className="mt-1 text-[11.5px] text-ink-3">{t('Try a surname, a person ID, or a screen name.')}</p>
              </div>
            )}

            {studentsLoading && q && (
              <div role="status" aria-live="polite" className="px-3 py-2 text-[11.5px] text-ink-3">
                {t('Looking through student records…')}
              </div>
            )}
          </div>

          <div className="flex h-9 shrink-0 items-center gap-3 border-t border-line bg-surface-muted px-3 text-[10.5px] text-ink-3">
            <span className="flex items-center gap-1"><ArrowUpRight size={11} /> {t('↑↓ to move')}</span>
            <span className="flex items-center gap-1"><CornerDownLeft size={11} /> {t('↵ to open')}</span>
            <span className="flex items-center gap-1"><span className="kbd">?</span> {t('shortcuts')}</span>
            <span className="ms-auto mono">{t('eNote · command')}</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
