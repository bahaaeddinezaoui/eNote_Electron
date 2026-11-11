import React, { useState, useEffect, useMemo } from 'react'
import { formatDateTime } from '../dateFormat'
import { Bug, RefreshCw, ExternalLink, ChevronDown, ChevronUp, Check, Search } from 'lucide-react'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import Pagination from './ui/Pagination'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'

const inputCls = "w-full px-3 py-2 bg-surface-muted/50 border border-line rounded-md outline-none focus:border-jade-500 focus:bg-surface focus:ring-4 focus:ring-jade-500/20 text-[12.5px] text-ink transition-all"
const labelCls = "block kicker mb-1.5"

const STATUSES = ['open', 'in_progress', 'solved', 'dismissed']
const PRIORITIES = ['low', 'medium', 'high', 'critical']

// Triage values are stored in English. They are read through the dictionary so
// a status or a priority reads in the interface language, not in the language
// the column happens to be written in.
const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  solved: 'Solved',
  dismissed: 'Dismissed'
}

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical'
}

const statusLabel = (status) => tr(STATUS_LABELS[status] || String(status || ''))
const priorityLabel = (priority) => tr(PRIORITY_LABELS[priority] || String(priority || ''))

const STATUS_STYLES = {
  open: 'bg-blue-50 text-blue-700 border-blue-200',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
  solved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dismissed: 'bg-surface-muted text-ink-3 border-line'
}

const PRIORITY_STYLES = {
  low: 'bg-surface-muted text-ink-2 border-line',
  medium: 'bg-sky-50 text-sky-700 border-sky-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200'
}

const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : formatDateTime(d)
}

const BugReports = ({ user }) => {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  const loadReports = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.getBugReports()
      setReports(res?.data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadReports() }, [])

  const filtered = useMemo(() => {
    return reports.filter(r => {
      if (statusFilter && r.REPORT_STATUS !== statusFilter) return false
      if (priorityFilter && r.REPORT_PRIORITY !== priorityFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const haystack = `${r.REPORT_SUBJECT} ${r.REPORT_DESCRIPTION} ${r.REPORTER_FIRST_NAME || ''} ${r.REPORTER_LAST_NAME || ''} ${r.REPORTER_USERNAME || ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [reports, search, statusFilter, priorityFilter])

  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, solved: 0, dismissed: 0 }
    reports.forEach(r => { c[r.REPORT_STATUS] = (c[r.REPORT_STATUS] || 0) + 1 })
    return c
  }, [reports])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedReports = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const patchReport = async (reportId, patch) => {
    setSavingId(reportId)
    try {
      // The triage change is recorded against the account that made it.
      await window.api.updateBugReport(reportId, patch, user?.id ?? null)
      setReports(rs => rs.map(r => r.REPORT_ID === reportId ? { ...r, ...patch } : r))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  const openScreenshot = async (reportId) => {
    const res = await window.api.openBugScreenshot(reportId)
    if (res?.error) setError(res.error)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageIntro
        kicker={tr('Quality')}
        title={tr('Bug Reports')}
        actions={
          <button
            onClick={loadReports}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
          </button>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">{tr('Consult and triage the bug reports submitted by users')}</p>
      </PageIntro>

      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 rounded-md p-4 text-[12.5px] font-semibold">
          {error}
        </div>
      )}

      {/* Status counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`rounded-md border p-4 text-left transition-all ${statusFilter === s ? 'ring-2 ring-blue-500/40 border-blue-300' : 'border-line'} bg-white hover:`}
          >
            <span className={`inline-block px-2 py-0.5 rounded-full border kicker ${STATUS_STYLES[s]}`}>
              {statusLabel(s)}
            </span>
            <div className="text-2xl font-semibold text-ink mt-2">{counts[s] || 0}</div>
          </button>
        ))}
      </div>

      {/* Search and filters share one toolbar, so neither hides the list. */}
      <div className="bg-white rounded-md border border-line flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="relative w-full max-w-[280px]">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1) }}
            placeholder={tr('Search subject, description, reporter...')}
            aria-label={tr('Search reports')}
            className="field h-7 w-full ps-6 text-[11.5px]"
          />
        </div>
        <FilterBar
          activeCount={(search ? 1 : 0) + (statusFilter ? 1 : 0) + (priorityFilter ? 1 : 0)}
          onClear={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setPage(1) }}
          matchCount={filtered.length}
          matchLabel="report"
          title={tr('Filter reports')}
        >
          <FilterField label={tr('Status')}>
            <select
              className={filterInputCls}
              value={statusFilter}
              onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}
              aria-label={tr('Filter by status')}
            >
              <option value="">{tr('All statuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label={tr('Priority')}>
            <select
              className={filterInputCls}
              value={priorityFilter}
              onChange={(event) => { setPriorityFilter(event.target.value); setPage(1) }}
              aria-label={tr('Filter by priority')}
            >
              <option value="">{tr('All priorities')}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{priorityLabel(p)}</option>
              ))}
            </select>
          </FilterField>
        </FilterBar>
        <span className="mono ml-auto text-[10.5px] text-ink-3">
          {filtered.length} {tr(filtered.length === 1 ? 'report' : 'reports')}
        </span>
      </div>

      {/* List */}
      <div className="space-y-3">
        {loading ? (
          <div className="bg-white border border-line rounded-md p-10 text-center text-ink-3 font-medium">{tr("Loading reports...")}</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-line rounded-md p-12 text-center">
            <div className="mx-auto w-16 h-16 bg-surface-muted rounded-md flex items-center justify-center mb-4">
              <Bug size={28} className="text-ink-3" />
            </div>
            <h4 className="text-lg font-semibold text-ink">{tr("No bug reports")}</h4>
            <p className="text-[12.5px] text-ink-3 font-medium mt-2">
              {reports.length === 0 ? tr('Nothing has been reported yet.') : tr('No reports match the current filters.')}
            </p>
          </div>
        ) : (
          pagedReports.map(r => (
            <div key={r.REPORT_ID} className="bg-white border border-line rounded-md overflow-hidden">
              <div
                className="p-4 flex flex-col md:flex-row md:items-center gap-3 cursor-pointer hover:bg-surface-muted/60 transition-colors"
                onClick={() => setExpandedId(expandedId === r.REPORT_ID ? null : r.REPORT_ID)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full border kicker ${STATUS_STYLES[r.REPORT_STATUS] || ''}`}>
                      {statusLabel(r.REPORT_STATUS)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full border kicker ${PRIORITY_STYLES[r.REPORT_PRIORITY] || ''}`}>
                      {priorityLabel(r.REPORT_PRIORITY)}
                    </span>
                    <span className="text-[11px] text-ink-3 font-semibold">#{r.REPORT_ID}</span>
                  </div>
                  <h4 className="font-semibold text-ink text-[12.5px] truncate">{r.REPORT_SUBJECT}</h4>
                  <p className="text-[11px] text-ink-3 mt-0.5">
                    {(r.REPORTER_FIRST_NAME || '')} {(r.REPORTER_LAST_NAME || '')} (@{r.REPORTER_USERNAME}) · {fmtDate(r.CREATED_AT)}
                  </p>
                </div>
                {expandedId === r.REPORT_ID ? <ChevronUp size={16} className="text-ink-3" /> : <ChevronDown size={16} className="text-ink-3" />}
              </div>

              {expandedId === r.REPORT_ID && (
                <div className="border-t border-line p-4 space-y-4 bg-surface-muted/40">
                  <div>
                    <span className={labelCls}>{tr("Description")}</span>
                    <p className="text-[12.5px] text-ink-2 whitespace-pre-wrap">{r.REPORT_DESCRIPTION}</p>
                  </div>

                  {r.REPORT_SCREENSHOT_PATH && (
                    <button
                      onClick={() => openScreenshot(r.REPORT_ID)}
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                    >
                      <ExternalLink size={13} />{' '}{tr("Open attached screenshot")}</button>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className={labelCls}>{tr("Status")}</label>
                      <select
                        className={inputCls}
                        value={r.REPORT_STATUS || 'open'}
                        disabled={savingId === r.REPORT_ID}
                        onChange={e => patchReport(r.REPORT_ID, { REPORT_STATUS: e.target.value })}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{tr("Priority")}</label>
                      <select
                        className={inputCls}
                        value={r.REPORT_PRIORITY || 'medium'}
                        disabled={savingId === r.REPORT_ID}
                        onChange={e => patchReport(r.REPORT_ID, { REPORT_PRIORITY: e.target.value })}
                      >
                        {PRIORITIES.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{tr("Resolution note")}</label>
                      <input
                        type="text"
                        className={inputCls}
                        defaultValue={r.RESOLUTION_NOTE || ''}
                        placeholder={tr("Note about the resolution...")}
                        disabled={savingId === r.REPORT_ID}
                        onBlur={e => {
                          if ((r.RESOLUTION_NOTE || '') !== e.target.value) {
                            patchReport(r.REPORT_ID, { RESOLUTION_NOTE: e.target.value })
                          }
                        }}
                      />
                    </div>
                  </div>

                  {(r.RESOLVED_AT || r.RESOLVER_USERNAME) && (
                    <p className="text-[11px] text-ink-3 font-semibold flex items-center gap-1.5">
                      <Check size={12} className="text-emerald-500" />{' '}{tr("Resolved by @")}{r.RESOLVER_USERNAME || 'unknown'} · {fmtDate(r.RESOLVED_AT)}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <Pagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </div>
  )
}

export default BugReports
