import React, { useEffect, useMemo, useState } from 'react'
import { formatDate } from '../dateFormat'
import DataTable from './ui/DataTable'
import { CalendarRange, CheckCircle2, UserX, Users, RefreshCw, Search } from 'lucide-react'
import { PageHeader, Panel, PanelHeader } from './ui/PageHeader'
import Notice from './ui/Notice'
import { tr } from '../i18n'

// Teacher attendance, for Directors and Admins.
//
// The question this page answers is "did the teachers take the classes the
// schedule gave them?". A session counts as taken when it has a row in
// study_session_register — an absence, an observation, or an explicit "held,
// nothing to report" — and as missed when its slot is over and there is none.
// Sessions that have not finished yet are in neither column, so a class later
// today never shows up as a missed one.
//
// The period is inclusive and defaults to the last 30 days.

const pad = (n) => String(n).padStart(2, '0')
const toInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d, days) => {
  const next = new Date(d)
  next.setDate(next.getDate() + days)
  return next
}

const todayInput = () => toInput(new Date())

const formatDay = (value) => {
  if (!value) return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value)
  return isNaN(d.getTime())
    ? String(value)
    : formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

const percent = (rate) => `${Math.round((rate || 0) * 100)}%`

const PRESETS = [
  { id: 7, label: 'Last 7 days', days: 7 },
  { id: 30, label: 'Last 30 days', days: 30 },
  { id: 90, label: 'Last 90 days', days: 90 }
]

const TeacherAttendance = ({ user }) => {
  const [from, setFrom] = useState(() => toInput(addDays(new Date(), -29)))
  const [to, setTo] = useState(todayInput)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)
  const [search, setSearch] = useState('')

  const load = async () => {
    if (!from || !to) return
    if (from > to) {
      setNotice({ type: 'error', text: tr('The period must start on or before the day it ends.') })
      return
    }
    setLoading(true)
    try {
      const res = await window.api.getTeacherAttendanceReport(user?.id, { from, to })
      setReport(res || null)
      setNotice(null)
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to load the attendance report.') })
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to])

  const applyPreset = (days) => {
    setFrom(toInput(addDays(new Date(), -(days - 1))))
    setTo(todayInput())
  }

  const activePreset = useMemo(() => {
    const days = Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1
    return PRESETS.find(p => p.days === days && to === todayInput())?.id || null
  }, [from, to])

  const teachers = report?.teachers || []
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return teachers
    return teachers.filter(t => String(t.TEACHER_NAME || '').toLowerCase().includes(term))
  }, [teachers, search])

  const totals = report?.totals || { teachers: 0, programmed: 0, taken: 0, missed: 0, rate: 0 }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Oversight')}
        title={tr('Teacher attendance')}
        meta={[formatDay(report?.from), formatDay(report?.to)].filter(Boolean).join(' → ')}
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted disabled:opacity-40"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
          </button>
        }
      />

      {/* Period */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-5 py-2">
        {PRESETS.map(preset => {
          const active = activePreset === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset.days)}
              aria-pressed={active}
              className={`inline-flex h-7 items-center rounded-[4px] border px-2.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'border-transparent text-on-jade'
                  : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted'
              }`}
              style={active ? { background: 'var(--color-jade-solid)' } : undefined}
            >
              {tr(preset.label)}
            </button>
          )
        })}

        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />

        <label className="field-label mb-0" htmlFor="ta-from">{tr('From')}</label>
        <input
          id="ta-from"
          type="date"
          className="field field-date h-7 max-w-full text-[11.5px]"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label className="field-label mb-0" htmlFor="ta-to">{tr('To')}</label>
        <input
          id="ta-to"
          type="date"
          className="field field-date h-7 max-w-full text-[11.5px]"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />

        <div className="relative ms-auto min-w-0">
          <Search size={11} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('Teacher')}
            aria-label={tr('Filter by teacher')}
            className="field field-filter h-7 ps-6 text-[11.5px]"
          />
        </div>
      </div>

      {/* Totals */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-surface px-5 py-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <Users size={12} className="text-ink-3" /> <span className="mono">{totals.teachers}</span> {tr('teachers')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <CalendarRange size={12} className="text-ink-3" /> <span className="mono">{totals.programmed}</span> {tr('sessions programmed')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} /> <span className="mono">{totals.taken}</span> {tr('taken')}
        </span>
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          <UserX size={12} style={{ color: 'var(--color-danger-ink)' }} /> <span className="mono">{totals.missed}</span> {tr('missed')}
        </span>
        <span className="mono ms-auto text-[10.5px] text-ink-3">
          {tr('Overall rate')} {percent(totals.rate)}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <Panel>
          <PanelHeader
            title={tr('Per teacher')}
            meta={`${visible.length}/${teachers.length}`}
            actions={
              <span className="mono text-[10px] text-ink-3">
                {tr('Sessions that are over are counted; the current one is not.')}
              </span>
            }
          />

          {loading ? (
            <div className="space-y-2 p-4" role="status" aria-label={tr('Loading the attendance report')}>
              {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-8 rounded-[3px] bg-surface-muted" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <CalendarRange size={22} className="text-ink-3" />
              <h2 className="serif mt-3 text-[22px] leading-tight text-ink">
                {teachers.length === 0 ? tr('No session in this period.') : tr('No teacher matches.')}
              </h2>
              <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-ink-3">
                {teachers.length === 0
                  ? tr('No scheduled session has finished in the chosen period, so there is nothing to measure yet.')
                  : tr('Clear the teacher filter to see the whole staff.')}
              </p>
            </div>
          ) : (
            <DataTable
              className="w-full border-collapse text-[12px]"
              headClassName="border-b border-line bg-surface-muted text-[10px] uppercase tracking-[0.07em] text-ink-3"
              columns={[
                { key: 'c0', className: "px-3 py-2 text-start font-semibold", header: <>{tr('Teacher')}</> },
                { key: 'c1', className: "px-3 py-2 text-end font-semibold", header: <>{tr('Programmed')}</> },
                { key: 'c2', className: "px-3 py-2 text-end font-semibold", header: <>{tr('Taken')}</> },
                { key: 'c3', className: "px-3 py-2 text-end font-semibold", header: <>{tr('Missed')}</> },
                { key: 'c4', className: "px-3 py-2 text-start font-semibold", header: <>{tr('Attendance rate')}</> },
              ]}
            >
                {visible.map(row => {
                  const missed = row.MISSED_SESSIONS || 0
                  return (
                    <tr key={row.PERSON_ID} className="border-b border-line last:border-b-0 hover:bg-surface-muted">
                      <td className="px-3 py-2">
                        <div className="truncate text-ink" title={row.TEACHER_NAME}>{row.TEACHER_NAME}</div>
                        {row.LAST_MISSED_DATE && missed > 0 && (
                          <div className="mono mt-0.5 text-[9.5px] text-ink-3">
                            {tr('Last missed')} {formatDay(row.LAST_MISSED_DATE)}
                          </div>
                        )}
                      </td>
                      <td className="mono px-3 py-2 text-end text-ink-2">{row.PROGRAMMED_SESSIONS}</td>
                      <td className="mono px-3 py-2 text-end" style={{ color: 'var(--color-success-ink)' }}>
                        {row.TAKEN_SESSIONS}
                      </td>
                      <td
                        className="mono px-3 py-2 text-end"
                        style={{ color: missed > 0 ? 'var(--color-danger-ink)' : 'var(--color-ink-3)' }}
                      >
                        {missed}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-[5px] w-[120px] overflow-hidden rounded-sm bg-line" aria-hidden="true">
                            <span
                              className="block h-full"
                              style={{
                                width: `${Math.round((row.RATE || 0) * 100)}%`,
                                background: row.RATE >= 0.8
                                  ? 'var(--color-success)'
                                  : row.RATE >= 0.5
                                    ? 'var(--color-warning)'
                                    : 'var(--color-danger)'
                              }}
                            />
                          </div>
                          <span className="mono text-[11px] text-ink-2">{percent(row.RATE)}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
            </DataTable>
          )}
        </Panel>

        <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
          {tr('A session counts as taken when its teacher recorded an absence, recorded an observation, or confirmed the session was held. A finished session with none of those is counted as missed.')}
        </p>
      </div>
    </div>
  )
}

export default TeacherAttendance
