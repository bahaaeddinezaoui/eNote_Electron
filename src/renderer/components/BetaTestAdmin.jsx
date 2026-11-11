import React, { useEffect, useMemo, useState } from 'react'
import { formatDate, formatDateTime } from '../dateFormat'
import { FlaskConical, AlertTriangle, Check, RefreshCw, Minus, Inbox, Search } from 'lucide-react'
import SplitPane from './ui/SplitPane'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import Notice from './ui/Notice'
import { PageHeader, PanelHeader } from './ui/PageHeader'
import { localizedLabel, tr } from '../i18n'
import { personNameLastFirst } from '../../shared/personNames'

const fmtDate = (v) => {
  if (!v) return '—'
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v)
  return isNaN(d.getTime())
    ? '—'
    : formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtDateTime = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime())
    ? '—'
    : formatDateTime(d, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Severity wears the app's semantic tones: a critical finding reads like a
// danger, a medium one like a warning, a low one stays quiet.
const SEVERITY_TONE = {
  critical: { background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' },
  high: { background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' },
  medium: { background: 'var(--color-warning-bg)', color: 'var(--color-warning-ink)' },
  low: { background: 'var(--color-surface-muted)', color: 'var(--color-ink-3)' }
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 }

const severityStyle = (severity) => SEVERITY_TONE[severity] || SEVERITY_TONE.low

const testerName = (report) => {
  const name = personNameLastFirst(report.TESTER_LAST_NAME, report.TESTER_FIRST_NAME)
  return name || report.TESTER_USERNAME || `#${report.USER_ID}`
}

const reportStats = (report) => {
  const answers = report.FEATURES || []
  const tested = answers.filter(a => a.IS_TESTED)
  const problems = answers.filter(a => a.HAS_PROBLEMS)
  const worst = problems.reduce(
    (acc, a) => ((SEVERITY_RANK[a.PROBLEM_SEVERITY] || 0) > (SEVERITY_RANK[acc] || 0) ? a.PROBLEM_SEVERITY : acc),
    null
  )
  return { tested: tested.length, problems: problems.length, worst }
}

const FILTERS = [
  { id: '', label: 'All reports' },
  { id: 'problems', label: 'With problems' },
  { id: 'complete', label: 'Every feature tested' }
]

// What testers filed against each version, for the people who ship the builds.
const BetaTestAdmin = ({ user }) => {
  const [versions, setVersions] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  const load = async (keepSelection = true) => {
    setLoading(true)
    try {
      const res = await window.api.getBetaTestAdminReports(user.id)
      const list = res?.data || []
      setVersions(list)
      setSelectedId(prev => {
        if (keepSelection && prev && list.some(v => v.CHANGELOG_ID === prev)) return prev
        // Open on the newest version that actually has reports, else the newest.
        const withReports = list.find(v => (v.REPORTS || []).length > 0)
        return (withReports || list[0])?.CHANGELOG_ID ?? null
      })
      setError('')
    } catch (err) {
      setError(err.message || tr('Failed to load beta test reports.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(false) }, [])

  const totalReports = useMemo(
    () => versions.reduce((sum, v) => sum + (v.REPORTS || []).length, 0),
    [versions]
  )

  const selected = versions.find(v => v.CHANGELOG_ID === selectedId) || null

  const versionSummary = (version) => {
    const reports = version.REPORTS || []
    const problems = reports.reduce((sum, r) => sum + reportStats(r).problems, 0)
    const worst = reports.reduce((acc, r) => {
      const w = reportStats(r).worst
      return (SEVERITY_RANK[w] || 0) > (SEVERITY_RANK[acc] || 0) ? w : acc
    }, null)
    // Features at least one tester marked as tested.
    const coveredFeatures = new Set()
    reports.forEach(r => (r.FEATURES || []).forEach(a => { if (a.IS_TESTED) coveredFeatures.add(a.FEATURE_INDEX) }))
    return { reports: reports.length, problems, worst, covered: coveredFeatures.size, total: (version.FEATURES || []).length }
  }

  const visibleReports = useMemo(() => {
    let reports = selected?.REPORTS || []
    if (filter === 'problems') reports = reports.filter(r => reportStats(r).problems > 0)
    else if (filter === 'complete') {
      const total = (selected?.FEATURES || []).length
      reports = reports.filter(r => {
        const stats = reportStats(r)
        return total > 0 && stats.tested === total && stats.problems === 0
      })
    }
    // Search reads the tester and everything they wrote, so a problem can be
    // found by the words in its description instead of by who filed it.
    const needle = search.trim().toLowerCase()
    if (!needle) return reports
    return reports.filter((report) =>
      [
        testerName(report),
        report.TESTER_USERNAME,
        report.OVERALL_COMMENT,
        ...(report.FEATURES || []).map(a => `${a.FEATURE_TEXT || ''} ${a.DESCRIPTION || ''}`)
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [selected, filter, search])

  const showFlash = (msg) => {
    setFlash(msg)
    setTimeout(() => setFlash(''), 2500)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice
        notice={flash ? { type: 'success', text: flash } : null}
        onDismiss={() => setFlash('')}
      />

      <PageHeader
        kicker={tr('Quality')}
        title={tr('Beta test reports')}
        meta={`${totalReports} ${tr('reports')}`}
        actions={
          <>
            <button
              type="button"
              onClick={() => { load(); showFlash(tr('Reloaded.')) }}
              disabled={loading}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted disabled:opacity-40"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
            </button>
            <span className="mono hidden text-[10px] text-ink-3 md:inline">{tr('Testers only')}</span>
          </>
        }
      />

      {error && (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-1.5 text-[11px]"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }}
        >
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      <SplitPane
        side="start"
        storageKey="enote-beta-admin-split"
        initial={310}
        min={270}
        max={420}
        asideLabel={tr('Versions')}
        aside={
          <>
            <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-3.5">
              <span className="kicker">{tr('Versions')}</span>
              <span className="mono text-[10px] text-ink-3">{versions.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && versions.length === 0 ? (
                <div className="space-y-2 p-3" role="status" aria-label={tr('Loading versions')}>
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="h-10 rounded-sm bg-surface-muted" />
                  ))}
                </div>
              ) : versions.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-3">
                  {tr('No version has been published yet.')}
                </p>
              ) : (
                versions.map(version => {
                  const summary = versionSummary(version)
                  const active = version.CHANGELOG_ID === selectedId
                  return (
                    <button
                      key={version.CHANGELOG_ID}
                      type="button"
                      onClick={() => { setSelectedId(version.CHANGELOG_ID); setFilter(''); setSearch('') }}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-0.5 border-b border-line px-3 py-2 text-start ${
                        active ? 'bg-selection' : 'hover:bg-surface-muted'
                      }`}
                      style={active ? { boxShadow: 'inset 2px 0 0 var(--color-jade-500)' } : undefined}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="mono text-[11px] text-ink">{version.VERSION}</span>
                        <span className="mono ms-auto text-[9.5px] text-ink-3">{summary.reports} {tr('reports')}</span>
                      </span>
                      <span className="truncate text-[11.5px] text-ink-2">
                        {localizedLabel(version, 'TITLE') || '—'}
                      </span>
                      <span className="flex items-center gap-2 mono text-[9.5px] text-ink-3">
                        <span>{fmtDate(version.RELEASE_DATE)}</span>
                        <span>· {summary.covered}/{summary.total} {tr('tested')}</span>
                        {summary.problems > 0 && (
                          <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-danger-ink)' }}>
                            <AlertTriangle size={9} /> {summary.problems}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            <div className="shrink-0 border-t border-line px-3.5 py-2 text-[10px] text-ink-3">
              {tr('One report per tester and version.')}
            </div>
          </>
        }
      >
        {!selected ? (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-4">
              <span className="kicker">{tr('Reports')}</span>
              <span className="mono text-[10px] text-ink-3">{tr('NO VERSION')}</span>
            </div>
            <div className="min-h-0 flex-1 px-5 py-6">
              <h2 className="serif max-w-[430px] text-[27px] leading-tight text-ink">
                {tr('Select a version to read what testers reported.')}
              </h2>
              <p className="mt-2 max-w-[440px] text-[11.5px] leading-relaxed text-ink-3">
                {tr('Each report lists the features the tester marked, the problems found with their severity, and the overall comment on the release.')}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex min-h-[64px] shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="serif truncate text-[22px] leading-none text-ink">
                    {localizedLabel(selected, 'TITLE')}
                  </h2>
                  <span className="mono shrink-0 text-[10px] text-ink-3">{selected.VERSION}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[10.5px] text-ink-3">
                  <span>{fmtDate(selected.RELEASE_DATE)}</span>
                  <span>· {versionSummary(selected).reports} {tr('reports')}</span>
                  <span>· {versionSummary(selected).covered}/{versionSummary(selected).total} {tr('features tested')}</span>
                  {versionSummary(selected).problems > 0 && (
                    <span style={{ color: 'var(--color-danger-ink)' }}>
                      {versionSummary(selected).problems} {tr('problems reported')}
                    </span>
                  )}
                </div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-1">
                <div className="relative w-[200px]">
                  <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={tr('Search tester or comment…')}
                    aria-label={tr('Search reports')}
                    className="field h-7 ps-6 text-[11.5px]"
                  />
                </div>

            {/* Filters share the header with the search. */}
            <FilterBar
              activeCount={(search ? 1 : 0) + (filter ? 1 : 0)}
              onClear={() => { setSearch(''); setFilter('') }}
              matchCount={visibleReports.length}
              matchLabel="report"
              title={tr('Filter reports')}
            >
              <FilterField label={tr('Reports')}>
                <select
                  className={filterInputCls}
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  aria-label={tr('Filter reports')}
                >
                  {FILTERS.map(option => (
                    <option key={option.id || 'all'} value={option.id}>{tr(option.label)}</option>
                  ))}
                </select>
              </FilterField>
            </FilterBar>
            </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {(selected.REPORTS || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-md border border-line bg-surface-muted">
                    <Inbox size={20} className="text-ink-3" />
                  </div>
                  <h3 className="serif mt-3 text-[22px] text-ink">{tr('No report for this version yet')}</h3>
                  <p className="mt-1 max-w-[380px] text-[11.5px] leading-relaxed text-ink-3">
                    {tr('Beta testers have not filed anything against this release. Their reports appear here as soon as they save one.')}
                  </p>
                </div>
              ) : visibleReports.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <h3 className="serif text-[20px] text-ink">{tr('No report matches this filter')}</h3>
                  <p className="mt-1 text-[11.5px] text-ink-3">{tr('Choose another filter, or clear the search, to see the rest.')}</p>
                </div>
              ) : (
                visibleReports.map(report => {
                  const stats = reportStats(report)
                  const answersByIndex = new Map((report.FEATURES || []).map(a => [a.FEATURE_INDEX, a]))
                  const features = (selected.FEATURES || []).filter(f => answersByIndex.has(f.FEATURE_INDEX))
                  return (
                    <section key={report.BETA_TEST_REPORT_ID} className="border-b border-line">
                      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-muted px-4 py-2">
                        <FlaskConical size={12} className="shrink-0 text-ink-3" />
                        <span className="text-[12px] font-semibold text-ink">{testerName(report)}</span>
                        {report.TESTER_USERNAME && (
                          <span className="mono text-[10px] text-ink-3">@{report.TESTER_USERNAME}</span>
                        )}
                        <span className="mono text-[10px] text-ink-3">· {fmtDateTime(report.UPDATED_AT || report.CREATED_AT)}</span>
                        <span className="ms-auto flex items-center gap-2">
                          <span className="mono text-[10px] text-ink-3">
                            {stats.tested}/{(selected.FEATURES || []).length} {tr('tested')}
                          </span>
                          {stats.problems > 0 ? (
                            <span
                              className="inline-flex h-[20px] items-center gap-1 rounded-[3px] border px-1.5 text-[9.5px] uppercase tracking-[0.04em]"
                              style={{ ...severityStyle(stats.worst), borderColor: 'transparent' }}
                            >
                              <AlertTriangle size={9} /> {stats.problems} {tr('problems')} · {stats.worst}
                            </span>
                          ) : (
                            <span className="inline-flex h-[20px] items-center gap-1 rounded-[3px] border border-line bg-surface px-1.5 text-[9.5px] uppercase tracking-[0.04em] text-ink-3">
                              <Check size={9} /> {tr('No problem')}
                            </span>
                          )}
                        </span>
                      </div>

                      {report.OVERALL_COMMENT && (
                        <div className="px-4 pt-2">
                          <p className="border-s-2 border-line-strong ps-2.5 text-[11.5px] leading-relaxed text-ink-2 whitespace-pre-wrap">
                            {report.OVERALL_COMMENT}
                          </p>
                        </div>
                      )}

                      <div className="divide-y divide-[color:var(--color-line)] px-4 py-2">
                        {features.map(feature => {
                          const answer = answersByIndex.get(feature.FEATURE_INDEX)
                          const problems = !!answer.HAS_PROBLEMS
                          return (
                            <div key={feature.FEATURE_ID} className="flex items-start gap-3 py-2">
                              <span className="mono w-5 shrink-0 pt-0.5 text-[10px] text-ink-3">
                                {String(feature.FEATURE_INDEX + 1).padStart(2, '0')}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] leading-snug text-ink">
                                  {localizedLabel(feature, 'FEATURE_TEXT') || answer.FEATURE_TEXT || '—'}
                                </div>
                                {problems && answer.DESCRIPTION && (
                                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2 whitespace-pre-wrap">
                                    {answer.DESCRIPTION}
                                  </p>
                                )}
                              </div>
                              <span className="flex shrink-0 items-center gap-1.5">
                                {answer.IS_TESTED ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-ink-2">
                                    <Check size={10} /> {tr('Tested')}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-ink-3">
                                    <Minus size={10} /> {tr('Not tested')}
                                  </span>
                                )}
                                {problems && (
                                  <span
                                    className="inline-flex h-[18px] items-center rounded-[3px] px-1.5 text-[9.5px] uppercase tracking-[0.04em]"
                                    style={severityStyle(answer.PROBLEM_SEVERITY)}
                                  >
                                    {answer.PROBLEM_SEVERITY || 'medium'}
                                  </span>
                                )}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  )
                })
              )}
            </div>
          </div>
        )}
      </SplitPane>
    </div>
  )
}

export default BetaTestAdmin
