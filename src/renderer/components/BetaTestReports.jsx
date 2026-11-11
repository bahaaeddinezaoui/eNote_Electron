import React, { useEffect, useState } from 'react'
import { formatDate } from '../dateFormat'
import {
  AlertCircle, AlertTriangle, Bug, CheckCircle2, ChevronDown, FlaskConical, Inbox, Save
} from 'lucide-react'
import Button from './ui/Button'
import { PageIntro, Panel } from './ui/PageHeader'
import { getActiveLanguage, localizedLabel, tr } from '../i18n'

const SEVERITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' }
]

const fmtDate = (v) => {
  if (!v) return '—'
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return formatDate(new Date(+m[1], +m[2] - 1, +m[3]))
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : formatDate(d)
}

// One switch-like pill for a boolean answer on a feature. Tested reads jade,
// problems read ember: the two answers never share a colour.
const AnswerToggle = ({ active, onClick, label, icon: Icon, tone = 'jade' }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`inline-flex h-6 items-center gap-1 rounded-[3px] border px-1.5 text-[10.5px] font-medium ${
      active
        ? tone === 'ember'
          ? 'border-ember-500/60 bg-ember-solid text-on-ember'
          : 'border-jade-500/60 bg-jade-solid text-on-jade'
        : 'border-line-strong bg-surface text-ink-3 hover:bg-surface-muted hover:text-ink'
    }`}
  >
    <Icon size={11} /> {label}
  </button>
)

// Beta testers report, per version, whether each feature was tested and whether
// it has problems, plus one overall comment for the release.
const BetaTestReports = ({ user }) => {
  const [versions, setVersions] = useState([])
  const [reports, setReports] = useState({})
  const [expandedId, setExpandedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.getBetaTestVersions(user.id)
      const list = res?.data || []
      setVersions(list)

      const initial = {}
      for (const version of list) {
        const answersByIndex = {}
        for (const feature of version.FEATURES) {
          const saved = (version.REPORT?.FEATURES || []).find(a => a.FEATURE_INDEX === feature.FEATURE_INDEX)
          answersByIndex[feature.FEATURE_INDEX] = {
            isTested: !!saved?.IS_TESTED,
            hasProblems: !!saved?.HAS_PROBLEMS,
            problemSeverity: saved?.PROBLEM_SEVERITY || 'medium',
            description: saved?.DESCRIPTION || ''
          }
        }
        initial[version.CHANGELOG_ID] = {
          overall: version.REPORT?.OVERALL_COMMENT || '',
          features: answersByIndex,
          reportId: version.REPORT?.BETA_TEST_REPORT_ID || null,
          dirty: false,
          saving: false
        }
      }
      setReports(initial)
      if (list.length > 0) setExpandedId(list[0].CHANGELOG_ID)
      setError('')
    } catch (err) {
      setError(err.message || tr('Failed to load beta test versions.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const showFlash = (msg) => {
    setFlash(msg)
    setTimeout(() => setFlash(''), 2500)
  }

  const updateFeature = (changelogId, featureIndex, patch) => {
    setReports(prev => {
      const report = prev[changelogId]
      return {
        ...prev,
        [changelogId]: {
          ...report,
          dirty: true,
          features: {
            ...report.features,
            [featureIndex]: { ...report.features[featureIndex], ...patch }
          }
        }
      }
    })
  }

  const setTested = (changelogId, index, next) => {
    // Untested features cannot have problems, so clearing "tested" clears both.
    if (!next) updateFeature(changelogId, index, { isTested: false, hasProblems: false })
    else updateFeature(changelogId, index, { isTested: true })
  }

  const setProblems = (changelogId, index, current, next) => {
    if (next) {
      updateFeature(changelogId, index, {
        hasProblems: true,
        isTested: true,
        problemSeverity: current.problemSeverity || 'medium'
      })
    } else {
      updateFeature(changelogId, index, { hasProblems: false })
    }
  }

  const setOverall = (changelogId, value) => {
    setReports(prev => ({
      ...prev,
      [changelogId]: { ...prev[changelogId], overall: value, dirty: true }
    }))
  }

  const saveReport = async (version) => {
    const changelogId = version.CHANGELOG_ID
    const report = reports[changelogId]
    if (!report) return

    setReports(prev => ({ ...prev, [changelogId]: { ...report, saving: true } }))
    setError('')
    try {
      const features = version.FEATURES.map(feature => {
        const answer = report.features[feature.FEATURE_INDEX] || {}
        return {
          featureIndex: feature.FEATURE_INDEX,
          isTested: !!answer.isTested,
          hasProblems: !!answer.hasProblems,
          problemSeverity: answer.hasProblems ? (answer.problemSeverity || 'medium') : null,
          description: answer.hasProblems ? (answer.description || '') : ''
        }
      })

      const res = await window.api.saveBetaTestReport(user.id, changelogId, {
        overallComment: report.overall,
        features
      })

      setReports(prev => ({
        ...prev,
        [changelogId]: {
          ...prev[changelogId],
          saving: false,
          // A queued report is not on the server yet: the page stays marked as
          // unsaved, and the queue in the title bar carries it.
          dirty: !!res?.queued,
          reportId: res?.reportId || prev[changelogId].reportId
        }
      }))
      showFlash(
        res?.queued
          ? tr('Saved on this computer. It will be sent when the server is back.')
          : `Report saved for version ${version.VERSION}.`
      )
    } catch (err) {
      setError(err.message || tr('Failed to save the beta test report.'))
      setReports(prev => ({ ...prev, [changelogId]: { ...prev[changelogId], saving: false } }))
    }
  }

  const summary = (version) => {
    const report = reports[version.CHANGELOG_ID]
    const answers = Object.values(report?.features || {})
    return {
      tested: answers.filter(a => a.isTested).length,
      problems: answers.filter(a => a.hasProblems).length,
      total: version.FEATURES.length
    }
  }

  const testableVersions = versions.reduce((sum, version) => sum + version.FEATURES.length, 0)

  return (
    <div className="space-y-4">
      <PageIntro
        kicker={tr('Support')}
        title={tr('Beta tests')}
        meta={loading ? null : `${versions.length} ${versions.length === 1 ? tr('version') : tr('versions')}`}
        actions={flash && (
          <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-success/40 bg-success-bg px-2 py-1 text-[10.5px] text-success-ink">
            <CheckCircle2 size={11} /> {flash}
          </span>
        )}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('For each version, mark the features you tested and report any problems you found.')}
        </p>
      </PageIntro>

      {error && (
        <div className="flex items-start gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-3 py-2 text-[11.5px] text-danger-ink">
          <AlertCircle size={13} className="mt-px shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <Panel>
          <div role="status" aria-live="polite" className="space-y-1.5 p-3">
            <span className="sr-only">{tr('Loading beta test versions...')}</span>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-14 rounded-[3px] bg-surface-muted" aria-hidden="true" />
            ))}
          </div>
        </Panel>
      ) : versions.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <Inbox size={22} className="text-ink-3" />
            <h2 className="serif mt-3 text-[22px] leading-tight text-ink">{tr('No versions to test yet')}</h2>
            <p className="mt-1.5 max-w-md text-[11.5px] leading-relaxed text-ink-3">
              {tr('Released versions appear here with their feature lists as soon as they are published.')}
            </p>
          </div>
        </Panel>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="kicker text-[9px]">{tr('Versions')}</span>
            <span className="mono text-[10px] text-ink-3">
              {testableVersions} {testableVersions === 1 ? tr('feature') : tr('features')}
            </span>
          </div>

          {versions.map(version => {
            const report = reports[version.CHANGELOG_ID]
            const stats = summary(version)
            const expanded = expandedId === version.CHANGELOG_ID
            const progress = stats.total === 0 ? 0 : Math.round((stats.tested / stats.total) * 100)

            return (
              <Panel key={version.CHANGELOG_ID}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : version.CHANGELOG_ID)}
                  aria-expanded={expanded}
                  className="flex w-full items-start gap-3 px-3.5 py-2.5 text-start hover:bg-surface-muted"
                >
                  <span className="mono shrink-0 border border-jade-500/40 bg-selection px-1.5 py-0.5 text-[10.5px] font-medium text-jade-600">
                    v{version.VERSION}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{version.TITLE_EN}</span>
                    {version.TITLE_AR && (
                      <span dir="rtl" className="mt-0.5 block truncate text-[11px] text-ink-3">
                        {version.TITLE_AR}
                      </span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-ink-3">
                      <span className="mono">{fmtDate(version.RELEASE_DATE)}</span>
                      <span className="mono">
                        {stats.tested}/{stats.total} {tr('tested')}
                      </span>
                      {stats.problems > 0 && (
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-ember-600)' }}>
                          <Bug size={10} /> {stats.problems} {tr('with problems')}
                        </span>
                      )}
                      {report?.dirty && (
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-warning-ink)' }}>
                          <AlertTriangle size={10} /> {tr('Unsaved changes')}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2 pt-0.5">
                    {report?.reportId && !report.dirty && (
                      <span className="inline-flex items-center gap-1 rounded-[3px] border border-success/40 bg-success-bg px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.05em] text-success-ink">
                        <CheckCircle2 size={10} /> {tr('Saved')}
                      </span>
                    )}
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={`text-ink-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>

                {expanded && (
                  <div className="space-y-2 border-t border-line bg-surface-muted/30 px-3.5 py-3">
                    {version.FEATURES.length === 0 ? (
                      <p className="py-2 text-[11.5px] text-ink-3">{tr('This version has no features to report on.')}</p>
                    ) : (
                      version.FEATURES.map(feature => {
                        const answer = report?.features?.[feature.FEATURE_INDEX] || {}
                        return (
                          <div
                            key={feature.FEATURE_ID}
                            className={`rounded-[4px] border bg-surface px-2.5 py-2 ${
                              answer.hasProblems ? 'border-ember-500/40' : 'border-line'
                            }`}
                            style={answer.hasProblems ? { borderInlineStartWidth: 2, borderInlineStartColor: 'var(--color-ember-500)' } : undefined}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                {/* The label already carries the other language in brackets. */}
                                <div className="text-[12px] leading-snug text-ink">{localizedLabel(feature, 'FEATURE_TEXT') || feature.FEATURE_TEXT_EN || '—'}</div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <AnswerToggle
                                  active={!!answer.isTested}
                                  onClick={() => setTested(version.CHANGELOG_ID, feature.FEATURE_INDEX, !answer.isTested)}
                                  label={tr('Tested')}
                                  icon={CheckCircle2}
                                />
                                <AnswerToggle
                                  active={!!answer.hasProblems}
                                  onClick={() => setProblems(version.CHANGELOG_ID, feature.FEATURE_INDEX, answer, !answer.hasProblems)}
                                  label={tr('Problems')}
                                  icon={AlertTriangle}
                                  tone="ember"
                                />
                              </div>
                            </div>

                            {answer.hasProblems && (
                              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[150px_minmax(0,1fr)]">
                                <div>
                                  <label className="kicker mb-1 block text-[8.5px]">{tr('Severity')}</label>
                                  <select
                                    value={answer.problemSeverity || 'medium'}
                                    onChange={e => updateFeature(version.CHANGELOG_ID, feature.FEATURE_INDEX, { problemSeverity: e.target.value })}
                                    className="field text-[11px] capitalize"
                                  >
                                    {SEVERITIES.map(s => <option key={s.value} value={s.value}>{tr(s.label)}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="kicker mb-1 block text-[8.5px]">{tr('What went wrong')}</label>
                                  <textarea
                                    value={answer.description || ''}
                                    onChange={e => updateFeature(version.CHANGELOG_ID, feature.FEATURE_INDEX, { description: e.target.value })}
                                    rows={2}
                                    maxLength={4000}
                                    placeholder={tr('Describe the problem, reproduction steps, expected result...')}
                                    className="w-full resize-y rounded-[4px] border border-line-strong bg-surface px-2 py-1.5 text-[11px] leading-relaxed text-ink outline-none focus:border-jade-500 focus:ring-2 focus:ring-jade-500/20"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}

                    <div className="pt-1">
                      <label className="kicker mb-1 block text-[8.5px]">{tr('Overall feedback for this version')}</label>
                      <textarea
                        value={report?.overall || ''}
                        onChange={e => setOverall(version.CHANGELOG_ID, e.target.value)}
                        rows={3}
                        maxLength={10000}
                        placeholder={tr('General feedback on the version as a whole...')}
                        className="w-full resize-y rounded-[4px] border border-line-strong bg-surface px-2.5 py-2 text-[11.5px] leading-relaxed text-ink outline-none focus:border-jade-500 focus:ring-2 focus:ring-jade-500/20"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
                      <div className="min-w-0">
                        <span className="mono text-[10px] text-ink-3">
                          {stats.tested}/{stats.total} {tr('features marked as tested.')}
                        </span>
                        <span className="mt-1 block h-[3px] w-40 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                          <span
                            className="block h-full"
                            style={{ width: `${progress}%`, background: 'var(--color-jade-500)' }}
                          />
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => saveReport(version)}
                        disabled={report?.saving || version.FEATURES.length === 0}
                        loading={!!report?.saving}
                      >
                        <Save size={12} /> {report?.saving ? tr('Saving...') : tr('Save report')}
                      </Button>
                    </div>
                  </div>
                )}
              </Panel>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default BetaTestReports
