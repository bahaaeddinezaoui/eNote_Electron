import React, { useEffect, useMemo, useState } from 'react'
import { dateLocale, formatTime } from '../dateFormat'
import DataTable from './ui/DataTable'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  IdCard,
  Plus,
  Users
} from 'lucide-react'
import { tr, useI18n } from '../i18n'
import { personNameLastFirst } from '../../shared/personNames'
import { PageHeader, Panel, PanelHeader, StateMark } from './ui/PageHeader'
import ListError from './ui/ListError'
import { isDarkTheme, useTheme } from '../theme'

const fmtToday = () => {
  try {
    return new Intl.DateTimeFormat(dateLocale(), {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(new Date())
  } catch {
    return ''
  }
}

const shortName = (person) => {
  const first = person.PERSON_FIRST_NAME || person.person_first_name_la || ''
  const last = person.PERSON_LAST_NAME || person.person_last_name_la || ''
  return { first, last, full: personNameLastFirst(last, first) || '—' }
}

function Figure({ label, value, context, to, loading, accent }) {
  const body = (
    <>
      <div className="kicker truncate text-[9.5px]">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        {loading ? (
          <span className="block h-7 w-14 rounded-sm bg-surface-muted" role="status" aria-label={tr('Loading')} />
        ) : (
          <span className="serif figure text-[30px] leading-[30px] text-ink">{value}</span>
        )}
        {accent ? (
          <>
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--color-warning)' }} aria-hidden="true" />
            <span className="sr-only">{tr('Needs attention')}</span>
          </>
        ) : null}
      </div>
      <div className="mt-1 truncate text-[11px] text-ink-3">{context}</div>
    </>
  )
  const className = 'block min-w-0 flex-1 px-3.5 py-2.5 text-start hover:bg-surface-muted'
  if (to) {
    return (
      <Link to={to} className={className} style={{ transition: 'background-color 120ms var(--ease-out)' }}>
        {body}
      </Link>
    )
  }
  return <div className={className}>{body}</div>
}

export default function Dashboard({ user }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [theme] = useTheme()
  const [loading, setLoading] = useState(true)
  // A failed read is not an empty registry: the overview says which one it is.
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [stats, setStats] = useState(null)
  const [students, setStudents] = useState([])
  const [people, setPeople] = useState([])
  const [unread, setUnread] = useState(0)
  // Library submissions waiting for an administrator's decision. The sidebar
  // badge reads the same count from the same service.
  const [libraryPending, setLibraryPending] = useState(0)
  const [teacherData, setTeacherData] = useState({ majors: [], sessions: [], current: null })
  const [studentData, setStudentData] = useState({ sections: [], documents: [] })

  const roles = user?.roles || []
  const isAdmin = roles.includes('ADMIN')
  const isSecretary = roles.includes('SECRETARY')
  const isDirector = roles.includes('DIRECTOR')
  const isTeacher = roles.includes('TEACHER')
  const isStudent = roles.includes('STUDENT')
  const isStaff = isAdmin || isSecretary || isDirector
  const canManage = isAdmin || isSecretary
  const isDark = isDarkTheme(theme)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadError('')
      try {
        if (isStaff || isTeacher) {
          let failure = ''
          const [statRes, studentRes, personRes] = await Promise.all([
            window.api.getDashboardStats().catch((error) => {
              failure = error?.message || 'unreachable'
              return null
            }),
            window.api.getStudentsWithSections(user.id).catch(() => ({ data: [] })),
            window.api.getPersons().catch(() => ({ data: [] }))
          ])
          if (cancelled) return
          setLoadError(failure)
          setStats(statRes || { totalStudents: 0, activeCourses: 0, pendingExams: 0 })
          setStudents(studentRes?.data || [])
          setPeople(personRes?.data || [])
          if (user?.id) {
            const [inbox, libraryReview] = await Promise.all([
              window.api.getInboxUnreadCount(user.id).catch(() => null),
              isAdmin ? window.api.getLibraryReviewCount(user.id).catch(() => null) : Promise.resolve(null)
            ])
            if (!cancelled) {
              setUnread(inbox?.unread || 0)
              setLibraryPending(libraryReview?.pending || 0)
            }
          }
        }
        if (isTeacher) {
          const [majors, current, period] = await Promise.all([
            window.api.getMajorsTaughtByTeacher(user.personId).then((r) => r?.data || []).catch(() => []),
            window.api.getTeacherCurrentSession(user.personId).then((r) => r?.data?.[0] || null).catch(() => null),
            window.api.getTeacherSessionsForPeriod(user.personId).then((r) => r?.data || []).catch(() => [])
          ])
          if (!cancelled) setTeacherData({ majors, current, sessions: period })
        }
        if (isStudent) {
          const [sections, documents] = await Promise.all([
            window.api.getStudentSections(user.id, user.personId).then((r) => r?.data || []).catch(() => []),
            window.api.getDocuments(user.id).then((r) => r?.data || []).catch(() => [])
          ])
          if (!cancelled) setStudentData({ sections, documents })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [isStaff, isTeacher, isStudent, user?.id, user?.personId, reloadKey])

  const cohort = useMemo(() => {
    const bySection = new Map()
    let unassigned = 0
    for (const student of students) {
      const label = student.SECTION_LABEL || student.SECTION_CODE
      if (!label) {
        unassigned += 1
        continue
      }
      bySection.set(label, (bySection.get(label) || 0) + 1)
    }
    const rows = [...bySection.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
    const max = rows[0]?.count || 1
    return { rows, unassigned, max, total: students.length, sectionCount: rows.length }
  }, [students])

  // Anyone holding the teaching role, whether or not they are also enrolled as
  // a student — the two roles are independent.
  const teachers = useMemo(
    () => people.filter((person) => person.IS_TEACHER === true).length,
    [people]
  )

  const recentlyAdded = useMemo(() => {
    return [...people]
      .sort((a, b) => Number(b.PERSON_ID) - Number(a.PERSON_ID))
      .slice(0, 6)
  }, [people])

  const queue = useMemo(() => {
    if (isTeacher) {
      const today = new Date().toISOString().slice(0, 10)
      const todays = teacherData.sessions.filter((session) =>
        String(session.STUDY_DAY_DATE || '').slice(0, 10) === today
      )
      return [
        {
          tone: todays.length ? 'warn' : 'good',
          item: t('Sessions today'),
          detail: todays.length ? t('Attendance not yet recorded for {count}', { count: todays.length }) : t('No session is scheduled today'),
          count: todays.length,
          action: todays.length ? t('Open attendance') : t('View schedule'),
          to: todays.length ? '/absences' : '/teacher-schedule'
        },
        {
          tone: teacherData.majors.length ? 'good' : 'warn',
          item: t('Teaching assignments'),
          detail: teacherData.majors.map((major) => major.MAJOR_LABEL).slice(0, 2).join(' · ') || t('No major assigned to this account'),
          count: teacherData.majors.length,
          action: t('View schedule'),
          to: '/teacher-schedule'
        }
      ]
    }
    if (isStudent) {
      return [
        {
          tone: 'neutral',
          item: t('My section'),
          detail: studentData.sections[0]?.SECTION_LABEL || t('No section assigned yet'),
          count: studentData.sections.length,
          action: t('Open schedule'),
          to: '/student-schedule'
        },
        {
          tone: 'neutral',
          item: t('Documents available'),
          detail: t('Course material published to your account'),
          count: studentData.documents.length,
          action: t('Open documents'),
          to: '/documents'
        }
      ]
    }
    return [
      {
        tone: cohort.unassigned ? 'bad' : 'good',
        item: t('Students without a section'),
        detail: t('Cannot be seated, marked or examined'),
        count: cohort.unassigned,
        action: t('Assign sections'),
        to: '/student-records?filter=unassigned'
      },
      {
        tone: stats?.pendingExams ? 'warn' : 'good',
        item: t('Examinations ahead'),
        detail: t('Sittings scheduled with no mark entered yet'),
        count: stats?.pendingExams || 0,
        action: t('Open examinations'),
        to: '/exams'
      },
      // Only an administrator reviews Library submissions, so the row exists
      // only on that role's queue.
      ...(isAdmin
        ? [{
            tone: libraryPending ? 'warn' : 'good',
            item: t('Documents awaiting review'),
            detail: t('Library submissions not yet published to the school'),
            count: libraryPending,
            action: t('Review the Library'),
            to: '/library?tab=review'
          }]
        : []),
      {
        tone: unread ? 'warn' : 'good',
        item: t('Unread registry messages'),
        detail: t('Correspondence waiting in the inbox'),
        count: unread,
        action: t('Open inbox'),
        to: '/inbox'
      },
      {
        tone: people.length ? 'neutral' : 'neutral',
        item: t('Staff on the register'),
        detail: t('Teachers and administrators with an active role'),
        count: teachers,
        action: t('Open people'),
        to: '/teachers'
      }
    ]
  }, [isTeacher, isStudent, teacherData, studentData, cohort, stats, unread, libraryPending, isAdmin, people.length, teachers, t])

  const todaySessions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return teacherData.sessions
      .filter((session) => String(session.STUDY_DAY_DATE || '').slice(0, 10) === today)
      .sort((a, b) => String(a.STUDY_SESSION_START_TIME).localeCompare(String(b.STUDY_SESSION_START_TIME)))
  }, [teacherData.sessions])

  const studentCount = stats?.totalStudents ?? cohort.total
  const roleLabel = (roles[0] || 'MEMBER')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

  // A registry with no students opens on an empty dashboard. These are the
  // steps that fill it, in the order the structure requires.
  const setupSteps = [
    { n: '01', to: '/academic', label: t('Academic years') },
    { n: '02', to: '/majors', label: t('Majors') },
    { n: '03', to: '/sections', label: t('Sections') },
    { n: '04', to: '/student-records?new=1', label: t('Register the first student') },
    ...(roles.includes('ADMIN') || roles.includes('DEVELOPER')
      ? [{ n: '05', to: '/settings', label: t('Import the old registry') }]
      : [])
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        kicker={`${t('Academic registry')} · ${t(roleLabel)}`}
        title={t('Overview')}
        meta={fmtToday()}
        actions={
          canManage ? (
            <button
              type="button"
              onClick={() => navigate('/student-records?new=1')}
              className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[12px] font-semibold text-on-jade hover:brightness-110"
              style={{ color: 'var(--color-on-jade)' }}
            >
              <Plus size={13} strokeWidth={2.2} /> {t('Register student')}
            </button>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loadError ? (
          <ListError
            label="Some figures could not be loaded"
            detail={loadError}
            onRetry={() => { setLoading(true); setReloadKey((key) => key + 1) }}
          />
        ) : null}
        {/* Figures: four cells, hairline dividers, each one a link. */}
        <div className="anim-stagger flex overflow-hidden rounded-md border border-line bg-surface">
          {isTeacher || isStudent ? (
            <>
              <Figure
                label={isTeacher ? t('Majors taught') : t('My section')}
                value={isTeacher ? teacherData.majors.length : studentData.sections[0]?.SECTION_LABEL || '—'}
                context={isTeacher ? teacherData.majors.map((m) => m.MAJOR_LABEL).slice(0, 2).join(' · ') || t('No assignment') : t('Current placement')}
                loading={loading}
                to={isTeacher ? '/teacher-schedule' : '/student-schedule'}
              />
              <Figure
                label={isTeacher ? t('Sessions this period') : t('Documents')}
                value={isTeacher ? teacherData.sessions.length : studentData.documents.length}
                context={isTeacher ? t('Across the full timetable') : t('Available to your account')}
                loading={loading}
                to={isTeacher ? '/teacher-schedule' : '/documents'}
              />
              <Figure
                label={isTeacher ? t('Session now') : t('Marks')}
                value={isTeacher ? (teacherData.current ? 'LIVE' : '—') : '—'}
                context={isTeacher ? teacherData.current?.MAJOR_LABEL || t('Nothing scheduled at this hour') : t('Published results appear here')}
                loading={loading}
                to={isTeacher ? '/absences' : '/student-marks'}
              />
            </>
          ) : (
            <>
              <Figure
                label={t('Students on the register')}
                value={loading ? '' : Number(studentCount).toLocaleString()}
                context={t('Across every teaching category')}
                loading={loading}
                to="/student-records"
              />
              <Figure
                label={t('Teaching sections')}
                value={loading ? '' : cohort.sectionCount}
                context={cohort.unassigned ? t('{count} students unplaced', { count: cohort.unassigned }) : t('Every student is placed')}
                loading={loading}
                to="/sections"
              />
              <Figure
                label={t('Examinations ahead')}
                value={loading ? '' : stats?.pendingExams ?? 0}
                context={t('Open sittings on the calendar')}
                loading={loading}
                to="/exams"
              />
              <Figure
                label={t('Student records unmapped')}
                value={loading ? '' : cohort.unassigned}
                context={cohort.unassigned ? t('Needs an administrator') : t('Nothing outstanding')}
                loading={loading}
                accent={cohort.unassigned > 0}
                to="/student-records?filter=unassigned"
              />
            </>
          )}
        </div>

        {!loading && !loadError && canManage && Number(studentCount) === 0 && (
          <div className="mt-4 overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
              <h3 className="text-[12.5px] font-semibold text-ink">{t('Set up this registry')}</h3>
              <span className="kicker text-[9px]">{t('First run')}</span>
            </div>
            <div className="p-3.5">
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                {t('Start with the calendar, then the structure, then the people.')}
              </p>
              <div className="anim-stagger mt-2.5 grid gap-1.5 sm:grid-cols-2">
                {setupSteps.map((step) => (
                  <Link
                    key={step.to}
                    to={step.to}
                    className="flex items-center gap-2 rounded-[3px] border border-line px-2.5 py-2 text-[11.5px] text-ink-2 hover:border-line-strong hover:bg-surface-muted hover:text-ink"
                  >
                    <span className="mono text-[10px] text-ink-3">{step.n}</span>
                    <span className="flex-1">{step.label}</span>
                    <ArrowRight size={11} className="text-ink-3" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="anim-stagger mt-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4">
            <Panel>
              <PanelHeader
                title={t('Needs attention')}
                meta={queue.filter((row) => row.count > 0).length}
                actions={
                  <span className="text-[10.5px] text-ink-3">
                    {t('Checked')} {formatTime(new Date(), { hour: '2-digit', minute: '2-digit' })}
                  </span>
                }
              />
              <table className="w-full" aria-label={t('Items needing attention')}>
                <colgroup>
                  <col style={{ width: 18 }} />
                  <col />
                  <col style={{ width: 210 }} />
                  <col style={{ width: 54 }} />
                  <col style={{ width: 128 }} />
                </colgroup>
                <tbody>
                  {queue.map((row) => (
                    <tr key={row.item} className="group border-b border-line last:border-0 hover:bg-surface-muted">
                      <td className="py-2.5 ps-3 align-middle">
                        <span
                          className="block h-[6px] w-[6px] rounded-full"
                          style={{
                            background:
                              row.tone === 'bad'
                                ? 'var(--color-danger)'
                                : row.tone === 'warn'
                                  ? 'var(--color-warning)'
                                  : row.tone === 'good'
                                    ? 'var(--color-success)'
                                    : 'var(--color-ink-3)'
                          }}
                          aria-hidden="true"
                        />
                        <span className="sr-only">
                          {row.tone === 'bad' || row.tone === 'warn'
                            ? t('Needs attention')
                            : t('Nothing outstanding')}
                        </span>
                      </td>
                      <td className="py-2.5 pe-3 align-middle">
                        <Link to={row.to} className="block text-[12.5px] font-medium text-ink hover:text-jade-600">
                          {row.item}
                        </Link>
                        <span className="mt-0.5 block truncate text-[11px] text-ink-3">{row.detail}</span>
                      </td>
                      <td className="py-2.5 pe-3 text-end align-middle">
                        <span className="mono text-[13px] text-ink-2">{loading ? '—' : row.count}</span>
                      </td>
                      <td className="py-2.5 pe-2 text-end align-middle">
                        <Link
                          to={row.to}
                          className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-jade-600 hover:text-jade-700"
                        >
                          {row.action}
                          <ArrowRight size={11} strokeWidth={2} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            {isTeacher ? (
              <Panel>
                <PanelHeader title={t('Today')} meta={todaySessions.length ? t('{count} sessions', { count: todaySessions.length }) : t('No sessions')} />
                <DataTable
                  className="data-table"
                  label={t('Today’s teaching sessions')}
                  columns={[
                    { key: 'c0', width: 74, header: <>{t('Start')}</> },
                    { key: 'c1', header: <>{t('Subject')}</> },
                    { key: 'c2', width: 150, header: <>{t('Group')}</> },
                    { key: 'c3', width: 130, header: <>{t('Room')}</> },
                    { key: 'c4', width: 96 },
                  ]}
                >
                    {todaySessions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="!h-16 text-center text-[12px] text-ink-3">
                          {t('No teaching session is scheduled today.')}
                        </td>
                      </tr>
                    ) : (
                      todaySessions.map((session) => {
                        const isNow =
                          String(session.STUDY_SESSION_START_TIME) <= new Date().toTimeString().slice(0, 8) &&
                          String(session.STUDY_SESSION_END_TIME) >= new Date().toTimeString().slice(0, 8)
                        return (
                          <tr key={session.STUDY_SESSION_ID} data-open={isNow || undefined}>
                            <td className="mono text-ink">{String(session.STUDY_SESSION_START_TIME).slice(0, 5)}</td>
                            <td className="font-medium text-ink">{session.MAJOR_LABEL || t('Session')}</td>
                            <td>{session.TEACHING_GROUP_LABEL || '—'}</td>
                            <td>{session.CLASSROOM_LABEL || '—'}</td>
                            <td className="text-end">
                              {isNow ? (
                                <Link to="/absences" className="text-[11px] font-medium text-jade-600">{t('Attendance')}</Link>
                              ) : (
                                <span className="text-[11px] text-ink-3">{t('Scheduled')}</span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                </DataTable>
              </Panel>
            ) : (
              <Panel>
                <PanelHeader
                  title={t('Recently entered')}
                  meta={people.length}
                  actions={
                    <Link to="/teachers" className="text-[10.5px] text-ink-3 hover:text-ink">
                      {t('Open register')}
                    </Link>
                  }
                />
                <DataTable
                  className="data-table"
                  label={t('Recently entered people')}
                  columns={[
                    { key: 'c0', width: 130, header: <>{t('Reference')}</> },
                    { key: 'c1', header: <>{t('Name')}</> },
                    { key: 'c2', width: 140, header: <>{t('Role')}</> },
                    { key: 'c3', width: 110, header: <>{t('Cohort')}</> },
                  ]}
                >
                    {recentlyAdded.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="!h-16 text-center text-[12px] text-ink-3">
                          {t('No person has been entered yet.')}
                        </td>
                      </tr>
                    ) : (
                      recentlyAdded.map((person) => {
                        const name = shortName(person)
                        const isPersonStudent = person.IS_STUDENT === true
                        // Both roles can be held at once, so the pair is named
                        // as a pair rather than picking one of the two.
                        const roleLabel = isPersonStudent && person.IS_TEACHER
                          ? t('Student & Teacher')
                          : isPersonStudent ? t('Student') : person.IS_TEACHER ? t('Teacher') : t('Staff')
                        return (
                          <tr key={person.PERSON_ID}>
                            <td className="mono text-[11px] text-ink-3">
                              #{String(person.PERSON_ID).padStart(4, '0')}
                            </td>
                            <td className="font-medium text-ink">{name.full}</td>
                            <td>{roleLabel}</td>
                            <td>{person.SECTION_LABEL || '—'}</td>
                          </tr>
                        )
                      })
                    )}
                </DataTable>
              </Panel>
            )}
          </div>

          <div className="space-y-4">
            {isStaff ? (
              <Panel>
                <PanelHeader title={t('Cohort register')} meta={`${cohort.total}`} />
                <div className="px-3 py-2.5">
                  {cohort.rows.length === 0 && cohort.unassigned === 0 ? (
                    <p className="py-6 text-center text-[11.5px] text-ink-3">{t('No students registered yet.')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {cohort.rows.slice(0, 7).map((row) => (
                        <li key={row.label}>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[11.5px] text-ink-2">{row.label}</span>
                            <span className="mono text-[11px] text-ink-3">{row.count}</span>
                          </div>
                          <div className="mt-1 h-[3px] w-full overflow-hidden rounded-sm bg-line">
                            <span
                              className="block h-full"
                              style={{
                                width: `${Math.max(3, (row.count / cohort.max) * 100)}%`,
                                background: 'var(--color-jade-500)'
                              }}
                            />
                          </div>
                        </li>
                      ))}
                      {cohort.rows.length > 7 && (
                        <li className="pt-1 text-[10.5px] text-ink-3">
                          {t('+ {count} more sections', { count: cohort.rows.length - 7 })}
                        </li>
                      )}
                    </ul>
                  )}
                  {cohort.unassigned > 0 && (
                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2">
                      <StateMark tone="warn" className="text-[11px] text-ink-2">
                        {t('No section')}
                      </StateMark>
                      <Link to="/student-records?filter=unassigned" className="mono text-[11px] text-jade-600 hover:text-jade-700">
                        {cohort.unassigned} →
                      </Link>
                    </div>
                  )}
                </div>
              </Panel>
            ) : (
              <Panel>
                <PanelHeader title={t('My timetable')} />
                <div className="px-3 py-2.5">
                  <p className="text-[11.5px] leading-relaxed text-ink-3">
                    {t('Open the weekly grid to see rooms, instructors and groups side by side.')}
                  </p>
                  <Link
                    to={isTeacher ? '/teacher-schedule' : '/student-schedule'}
                    className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-jade-600 hover:text-jade-700"
                  >
                    <CalendarDays size={12} /> {t('Open schedule')}
                  </Link>
                </div>
              </Panel>
            )}

            <Panel>
              <PanelHeader title={t('Workspace')} />
              <dl className="divide-y divide-line px-3 text-[11.5px]">
                {[
                  [t('Signed in as'), t(roleLabel)],
                  [t('Appearance'), isDark ? t('Dark appearance') : t('Light appearance')]
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-[7px]">
                    <dt className="text-ink-3">{label}</dt>
                    <dd className="mono truncate text-[10.5px] capitalize text-ink-2">{value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>

          </div>
        </div>

        <div className="mt-3 text-[10px] text-ink-3">
          <span>{t('Registry of academic records · local installation')}</span>
        </div>
      </div>
    </div>
  )
}
