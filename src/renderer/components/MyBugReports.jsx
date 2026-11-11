import React, { useEffect, useMemo, useState } from 'react'
import { formatDate } from '../dateFormat'
import { Bug, Check, ChevronDown, ChevronUp, ExternalLink, Inbox, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageIntro } from './ui/PageHeader'
import { tr } from '../i18n'

// The reports one account submitted, with the status triage gave them. It is
// read through getMyBugReports, which only ever returns rows written by the
// signed-in account, so this list cannot show anybody else's reports.
//
// Shared by the support form (so a reporter sees the outcome of what they just
// sent) and the dedicated page the sidebar links to.

const labelCls = 'block text-[10px] font-bold text-ink-3 uppercase tracking-wider mb-1.5'

const STATUSES = ['open', 'in_progress', 'solved', 'dismissed']

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
  return isNaN(d.getTime())
    ? '—'
    : formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

const statusLabel = (status) => tr(STATUS_LABELS[status] || status || '')

export const MyBugReportList = ({ user, refreshKey = 0, showHeading = true }) => {
  const [mine, setMine] = useState([])
  const [mineLoading, setMineLoading] = useState(true)
  const [mineError, setMineError] = useState('')
  const [mineFilter, setMineFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const loadMine = async () => {
    if (!user?.id) return
    setMineLoading(true)
    setMineError('')
    try {
      const res = await window.api.getMyBugReports(user.id)
      setMine(res?.data || [])
    } catch (err) {
      setMineError(err.message)
    } finally {
      setMineLoading(false)
    }
  }

  useEffect(() => { loadMine() }, [user?.id, refreshKey])

  const filteredMine = useMemo(
    () => (mineFilter ? mine.filter(r => r.REPORT_STATUS === mineFilter) : mine),
    [mine, mineFilter]
  )

  const statusCounts = useMemo(() => {
    const counts = { open: 0, in_progress: 0, solved: 0, dismissed: 0 }
    mine.forEach(r => { counts[r.REPORT_STATUS] = (counts[r.REPORT_STATUS] || 0) + 1 })
    return counts
  }, [mine])

  const openScreenshot = async (reportId) => {
    const res = await window.api.openBugScreenshot(reportId)
    if (res?.error) setMineError(res.error)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h4 className="text-lg font-bold text-ink tracking-tight">
            {showHeading ? tr('Your reports') : tr('Reports')}
          </h4>
          <p className="text-sm text-ink-3 mt-0.5">
            {tr('Every bug you have reported, with the status the team has given it.')}
          </p>
        </div>
        <button
          onClick={loadMine}
          disabled={mineLoading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-ink-2 bg-white border border-line hover:bg-surface-muted disabled:opacity-50 transition-all"
        >
          <RefreshCw size={13} className={mineLoading ? 'animate-spin' : ''} />{' '}{tr('Refresh')}
        </button>
      </div>

      {mineError && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 rounded-xl p-4 text-sm font-semibold">
          {mineError}
        </div>
      )}

      {mine.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setMineFilter('')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
              mineFilter === ''
                ? 'bg-white text-ink border-blue-300 ring-2 ring-blue-500/30'
                : 'bg-white text-ink-2 border-line hover:bg-surface-muted'
            }`}
          >
            {tr('All')}
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${mineFilter === '' ? 'bg-blue-50 text-blue-700' : 'bg-surface-muted text-ink-3'}`}>
              {mine.length}
            </span>
          </button>
          {STATUSES.map(status => (
            <button
              key={status}
              onClick={() => setMineFilter(mineFilter === status ? '' : status)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                mineFilter === status
                  ? 'bg-white text-ink border-blue-300 ring-2 ring-blue-500/30'
                  : 'bg-white text-ink-2 border-line hover:bg-surface-muted'
              }`}
            >
              {statusLabel(status)}
              <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${mineFilter === status ? 'bg-blue-50 text-blue-700' : 'bg-surface-muted text-ink-3'}`}>
                {statusCounts[status] || 0}
              </span>
            </button>
          ))}
        </div>
      )}

      {mineLoading && mine.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center text-ink-3 font-medium">
          {tr('Loading your reports...')}
        </div>
      ) : mine.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center">
          <div className="mx-auto w-14 h-14 bg-surface-muted rounded-2xl flex items-center justify-center mb-3">
            <Inbox size={24} className="text-ink-3" />
          </div>
          <h4 className="text-base font-extrabold text-ink">{tr('No report from you yet')}</h4>
          <p className="text-sm text-ink-3 font-medium mt-1.5">
            {tr('Once you submit a bug report, it appears here with its status.')}
          </p>
        </div>
      ) : filteredMine.length === 0 ? (
        <div className="bg-white border border-line rounded-2xl p-10 text-center">
          <h4 className="text-base font-extrabold text-ink">{tr('No report with this status')}</h4>
          <p className="text-sm text-ink-3 font-medium mt-1.5">{tr('Choose another status or show them all.')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMine.map(report => {
            const expanded = expandedId === report.REPORT_ID
            const status = report.REPORT_STATUS || 'open'
            const resolved = !!(report.RESOLVED_AT || report.RESOLUTION_NOTE)
            return (
              <div key={report.REPORT_ID} className="bg-white border border-line rounded-2xl shadow-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : report.REPORT_ID)}
                  aria-expanded={expanded}
                  className="w-full text-left p-4 flex items-center gap-3 hover:bg-surface-muted/60 transition-colors"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>
                    <Bug size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${STATUS_STYLES[status] || STATUS_STYLES.open}`}>
                        {statusLabel(status)}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${PRIORITY_STYLES[report.REPORT_PRIORITY] || PRIORITY_STYLES.medium}`}>
                        {tr(PRIORITY_LABELS[report.REPORT_PRIORITY] || report.REPORT_PRIORITY || '')}
                      </span>
                      <span className="text-[11px] text-ink-3 font-semibold">#{report.REPORT_ID}</span>
                      <span className="text-[11px] text-ink-3">· {fmtDate(report.CREATED_AT)}</span>
                    </div>
                    <h5 className="font-bold text-ink text-sm truncate">{report.REPORT_SUBJECT}</h5>
                  </div>
                  {expanded
                    ? <ChevronUp size={16} className="text-ink-3 shrink-0" />
                    : <ChevronDown size={16} className="text-ink-3 shrink-0" />}
                </button>

                {expanded && (
                  <div className="border-t border-line p-4 space-y-3 bg-surface-muted/40">
                    <div>
                      <span className={labelCls}>{tr('Description')}</span>
                      <p className="text-sm text-ink-2 whitespace-pre-wrap">{report.REPORT_DESCRIPTION}</p>
                    </div>

                    {report.REPORT_SCREENSHOT_PATH && (
                      <button
                        type="button"
                        onClick={() => openScreenshot(report.REPORT_ID)}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors"
                      >
                        <ExternalLink size={13} />{' '}{tr('Open attached screenshot')}
                      </button>
                    )}

                    {resolved ? (
                      <div className={`rounded-xl border p-3 ${status === 'dismissed' ? 'bg-surface-muted border-line' : 'bg-emerald-50 border-emerald-100'}`}>
                        <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${status === 'dismissed' ? 'text-ink-3' : 'text-emerald-700'}`}>
                          <Check size={12} /> {tr('Outcome')}
                        </div>
                        <p className="text-sm text-ink-2 mt-1 whitespace-pre-wrap">
                          {report.RESOLUTION_NOTE || statusLabel(status)}
                        </p>
                        <p className="text-[11px] text-ink-3 mt-1">
                          {report.RESOLVER_USERNAME ? `${tr('By')} @${report.RESOLVER_USERNAME}` : statusLabel(status)}
                          {report.RESOLVED_AT ? ` · ${fmtDate(report.RESOLVED_AT)}` : ''}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-ink-3 font-semibold">
                        {status === 'in_progress'
                          ? tr('The team is looking into it.')
                          : tr('No status change has been recorded yet.')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// The reporter's own page: what they sent, and where each report stands. A new
// report is composed on the support form, which this page links to.
const MyBugReports = ({ user }) => {
  const navigate = useNavigate()

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <PageIntro
        kicker={tr('Support')}
        title={tr('My bug reports')}
        actions={
          <button
            type="button"
            onClick={() => navigate('/report-bug')}
            className="inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold text-on-jade hover:brightness-110"
            style={{ color: 'var(--color-on-jade)' }}
          >
            <Bug size={13} /> {tr('Report a bug')}
          </button>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Every bug you have reported, with the status the team has given it.')}
        </p>
      </PageIntro>

      <MyBugReportList user={user} showHeading={false} />
    </div>
  )
}

export default MyBugReports
