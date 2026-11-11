import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, CheckCircle2, DatabaseZap, FileSearch, FlaskConical, Loader2
} from 'lucide-react'
import { tr } from '../../i18n'
import DataTable from '../ui/DataTable'
import Modal from '../ui/Modal'

// Settings → Legacy registry.
//
// The old application's MySQL dump is mapped onto this PostgreSQL registry in
// two beats: a dry run that only counts, shown here as a per-table plan, and the
// real import. Each step of the plan is one table, and the reviewer selects the
// tables to import: a blocked table is left out instead of stopping the others.
// The service re-checks each blocker inside the import transaction. The registry
// may already hold rows, so the reviewer also picks a mode: merge keeps the
// existing rows and adds only what is missing; replace clears the selected
// target tables first and is all-or-nothing.

const number = new Intl.NumberFormat()

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Count({ value, tone }) {
  const className =
    tone === 'good' ? 'text-[var(--color-success-ink)]'
      : tone === 'warn' ? 'text-[var(--color-warning-ink)]'
        : 'text-ink'
  return <span className={`mono tabular-nums ${className}`}>{number.format(value || 0)}</span>
}

function blockerText(blocker, labelFor) {
  switch (blocker.code) {
    case 'missingSource':
      return tr('The dump has no “{table}” table.', { table: blocker.table })
    case 'dependencyBlocked':
      return tr('Blocked because “{step}” cannot be imported.', {
        step: tr(blocker.label || labelFor(blocker.step))
      })
    case 'dependencyFailed':
      return tr('Blocked because “{step}” failed.', {
        step: tr(blocker.dependencyLabel || blocker.label || labelFor(blocker.step))
      })
    case 'runtimeError':
      return blocker.message
    default:
      return tr('This table cannot be imported.')
  }
}

// How an already-populated registry is handled. Merge never deletes anything;
// replace mirrors the dump by clearing the selected target tables first.
function ModeSwitch({ mode, onChange, disabled }) {
  const base =
    'inline-flex h-7 items-center px-2.5 text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  const activeStyle = { background: 'var(--color-jade-solid)', color: 'var(--color-on-jade)' }
  return (
    <div
      role="group"
      aria-label={tr('Import mode')}
      className="inline-flex overflow-hidden rounded-[4px] border border-line-strong"
    >
      <button
        type="button"
        onClick={() => onChange('merge')}
        disabled={disabled}
        aria-pressed={mode === 'merge'}
        className={`${base} ${mode === 'merge' ? '' : 'bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink'}`}
        style={mode === 'merge' ? activeStyle : undefined}
      >
        {tr('Merge with existing data')}
      </button>
      <button
        type="button"
        onClick={() => onChange('replace')}
        disabled={disabled}
        aria-pressed={mode === 'replace'}
        className={`${base} border-s border-line-strong ${mode === 'replace' ? '' : 'bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink'}`}
        style={mode === 'replace' ? activeStyle : undefined}
      >
        {tr('Replace selected tables')}
      </button>
    </div>
  )
}

function PlanTable({ steps, selectedSteps, onToggle, busy, mode }) {
  const selected = new Set(selectedSteps)
  const labelFor = (id) => steps.find((step) => step.id === id)?.label || id

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <DataTable
        label={tr('Tables to import')}
        className="w-full border-collapse text-[11px]"
        headClassName="border-b border-line bg-surface-muted text-ink-3"
        bodyClassName="divide-y divide-line"
        columns={[
          { key: 'select', className: 'w-8 px-2 py-1.5 text-center', header: null },
          { key: 'c0', className: 'px-2.5 py-1.5 text-start font-medium', header: <>{tr('Step')}</> },
          { key: 'c1', className: 'px-2 py-1.5 text-start font-medium', header: <>{tr('Old table')}</> },
          { key: 'c2', className: 'px-2 py-1.5 text-start font-medium', header: <>{tr('New table')}</> },
          { key: 'c3', className: 'px-2 py-1.5 text-end font-medium', header: <>{tr('Rows read')}</> },
          { key: 'c4', className: 'px-2 py-1.5 text-end font-medium', header: <>{tr('Will import')}</> },
          { key: 'c5', className: 'px-2 py-1.5 text-end font-medium', header: <>{tr('Reused')}</> },
          { key: 'c6', className: 'px-2.5 py-1.5 text-end font-medium', header: <>{tr('Skipped')}</> }
        ]}
      >
        {steps.map((step) => (
          <tr key={step.id} className={`align-top ${step.blocked ? 'opacity-60' : ''}`}>
            <td className="px-2 py-2 align-top">
              <input
                type="checkbox"
                checked={selected.has(step.id)}
                disabled={busy || step.blocked}
                onChange={() => onToggle(step.id)}
                aria-label={tr('Import {table}', { table: tr(step.label) })}
                className="mt-0.5"
                style={{ accentColor: 'var(--color-jade-solid)' }}
              />
            </td>
            <td className="px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-ink">{tr(step.label)}</span>
                {step.blocked && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                    style={{
                      background: 'var(--color-danger-bg)',
                      color: 'var(--color-danger-ink)'
                    }}
                  >
                    {tr('Blocked')}
                  </span>
                )}
              </div>
              {step.blockers.length > 0 && (
                <ul className="mt-0.5 space-y-0.5 text-[10px] text-[var(--color-danger-ink)]">
                  {step.blockers.map((blocker, index) => (
                    <li key={`${blocker.code}-${index}`}>{blockerText(blocker, labelFor)}</li>
                  ))}
                </ul>
              )}
              {!step.blocked && step.dependsOn.length > 0 && (
                <div className="mt-0.5 text-[10px] text-ink-3">
                  {tr('Needs: {steps}', { steps: step.dependsOn.map((id) => tr(labelFor(id))).join(', ') })}
                </div>
              )}
              {step.reasons.length > 0 && (
                <ul className="mt-0.5 space-y-0.5 text-[10px] text-ink-3">
                  {step.reasons.map((reason) => (
                    <li key={reason.reason}>
                      {tr(reason.reason)} · {number.format(reason.count)}
                    </li>
                  ))}
                </ul>
              )}
              {mode === 'replace' && !step.blocked && step.existingRows > 0 && (
                <div className="mt-0.5 text-[10px] text-[var(--color-danger-ink)]">
                  {tr('{count} existing rows will be deleted.', {
                    count: number.format(step.existingRows)
                  })}
                </div>
              )}
            </td>
            <td className="mono px-2 py-2 text-[10px] text-ink-3">{step.source}</td>
            <td className="mono px-2 py-2 text-[10px] text-ink-3">{step.target}</td>
            <td className="px-2 py-2 text-end"><Count value={step.read} /></td>
            <td className="px-2 py-2 text-end"><Count value={step.inserted} tone="good" /></td>
            <td className="px-2 py-2 text-end">
              <Count value={step.reused} />
            </td>
            <td className="px-2.5 py-2 text-end">
              <Count value={step.skipped} tone={step.skipped > 0 ? 'warn' : undefined} />
            </td>
          </tr>
        ))}
        <tr className="border-t border-line bg-surface-muted">
          <td className="px-2.5 py-1.5 font-medium text-ink-2" colSpan={4}>{tr('Total')}</td>
          <td className="px-2 py-1.5 text-end"><Count value={steps.reduce((n, s) => n + s.read, 0)} /></td>
          <td className="px-2 py-1.5 text-end"><Count value={steps.reduce((n, s) => n + s.inserted, 0)} tone="good" /></td>
          <td className="px-2 py-1.5 text-end"><Count value={steps.reduce((n, s) => n + s.reused, 0)} /></td>
          <td className="px-2.5 py-1.5 text-end"><Count value={steps.reduce((n, s) => n + s.skipped, 0)} /></td>
        </tr>
      </DataTable>
    </div>
  )
}

const LegacyImportDialog = ({ open, onClose, userId }) => {
  const [filePath, setFilePath] = useState('')
  const [mode, setMode] = useState('merge')
  const [preview, setPreview] = useState(null)
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [selectedSteps, setSelectedSteps] = useState([])

  useEffect(() => {
    if (open) return
    setFilePath('')
    setMode('merge')
    setPreview(null)
    setReport(null)
    setError(null)
    setLoading(false)
    setRunning(false)
    setConfirmed(false)
    setSelectedSteps([])
  }, [open])

  const steps = preview?.steps || []
  const stepById = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps])
  const importableSteps = useMemo(() => steps.filter((step) => !step.blocked), [steps])
  const selectedSet = useMemo(() => new Set(selectedSteps), [selectedSteps])

  // Reads the dump again for a chosen mode: merge counts only the rows that are
  // missing from the registry, replace counts the whole dump because it clears
  // the target tables first.
  const loadPreview = async (target, nextMode) => {
    setError(null)
    setReport(null)
    setPreview(null)
    setSelectedSteps([])
    setConfirmed(false)
    setLoading(true)
    try {
      const plan = await window.api.previewLegacyImport(userId, target, null, nextMode)
      setPreview(plan)
      setSelectedSteps(plan.importableSteps || [])
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const choose = async () => {
    setError(null)
    setReport(null)
    setPreview(null)
    setSelectedSteps([])
    setConfirmed(false)
    // A window opened before this feature was rebuilt still carries the previous
    // preload bridge. Say what to do instead of throwing "is not a function".
    if (typeof window.api?.pickLegacyDump !== 'function') {
      setError(tr('The import is unavailable in this window. Restart the application to load the updated bridge.'))
      return
    }
    try {
      const picked = await window.api.pickLegacyDump()
      if (!picked) return
      setFilePath(picked)
      await loadPreview(picked, mode)
    } catch (err) {
      setError(err?.message || String(err))
      setLoading(false)
    }
  }

  const changeMode = async (nextMode) => {
    if (nextMode === mode || loading || running) return
    setMode(nextMode)
    if (filePath) await loadPreview(filePath, nextMode)
  }

  // Checking a table also checks the tables it reads from; unchecking one also
  // unchecks every table that depends on it. The set therefore always stays
  // closed under dependencies, which is what the service expects.
  const toggleStep = (id) => {
    const step = stepById.get(id)
    if (!step || step.blocked) return
    setSelectedSteps((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        const remove = new Set([id])
        let changed = true
        while (changed) {
          changed = false
          for (const candidate of steps) {
            if (remove.has(candidate.id)) continue
            if (candidate.dependsOn.some((dependency) => remove.has(dependency))) {
              remove.add(candidate.id)
              changed = true
            }
          }
        }
        for (const removed of remove) next.delete(removed)
      } else {
        const add = new Set([id])
        let changed = true
        while (changed) {
          changed = false
          for (const candidate of [...add]) {
            const definition = stepById.get(candidate)
            for (const dependency of definition?.dependsOn || []) {
              if (!add.has(dependency)) {
                add.add(dependency)
                changed = true
              }
            }
          }
        }
        for (const added of add) next.add(added)
      }
      return [...next]
    })
  }

  const run = async () => {
    setError(null)
    if (typeof window.api?.runLegacyImport !== 'function') {
      setError(tr('The import is unavailable in this window. Restart the application to load the updated bridge.'))
      return
    }
    setRunning(true)
    try {
      const result = await window.api.runLegacyImport(userId, filePath, selectedSteps, mode)
      setReport(result)
      setPreview(null)
      setSelectedSteps([])
      setConfirmed(false)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setRunning(false)
    }
  }

  const busy = loading || running
  const selectedImportable = importableSteps.filter((step) => selectedSet.has(step.id))
  const canRun = confirmed && !busy && selectedImportable.length > 0 &&
    (mode === 'replace' || selectedImportable.some((step) => step.inserted > 0))

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-8 items-center rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
      >
        {tr('Close')}
      </button>
      <button
        type="button"
        onClick={run}
        disabled={!canRun}
        className="inline-flex h-8 items-center gap-1.5 rounded-[4px] px-3 text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: 'var(--color-jade-solid)', color: 'var(--color-on-jade)' }}
      >
        {running ? <Loader2 size={13} className="animate-spin" /> : null}
        {running ? tr('Importing…') : tr('Import now')}
      </button>
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr('Import from the old application')}
      description={tr('Map an old MySQL dump into this registry')}
      maxWidth="max-w-[900px]"
      footer={footer}
    >
      <div className="space-y-3.5">
        <p className="max-w-3xl text-[11.5px] leading-relaxed text-ink-2">
          {tr('Pick a MySQL dump exported from the old eNote. The plan below maps every old table onto this PostgreSQL registry. Choose the tables to import; a blocked table is left out instead of stopping the others, and nothing is written until you confirm.')}
        </p>

        <div
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
            background: 'var(--color-warning-bg)',
            color: 'var(--color-warning-ink)'
          }}
        >
          <FlaskConical size={13} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">{tr('Experimental')}</span>
            {' — '}
            {tr('This import is experimental. Review the plan and keep a database backup before running it.')}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[3px] border border-line bg-surface-muted text-ink-3">
            <DatabaseZap size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="kicker text-ink-3">{tr('Dump file')}</div>
            <div className="mono mt-0.5 truncate text-[10.5px] text-ink-2" title={filePath || undefined}>
              {filePath || tr('No dump chosen yet.')}
            </div>
          </div>
          <button
            type="button"
            onClick={choose}
            disabled={busy}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <FileSearch size={12} />}
            {loading ? tr('Reading the dump…') : tr('Choose dump file')}
          </button>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 rounded-md border px-3 py-2 text-[11.5px]"
            style={{
              borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger-ink)'
            }}
          >
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        {preview && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-2">
              <span>
                <span className="mono tabular-nums text-ink">{number.format(preview.tablesFound)}</span>{' '}
                {tr('tables')} ·{' '}
                <span className="mono tabular-nums text-ink">{number.format(preview.rowsFound)}</span>{' '}
                {tr('rows')} · {formatBytes(preview.file.bytes)}
              </span>
              <ModeSwitch mode={mode} onChange={changeMode} disabled={busy} />
              {preview.target.hasRows ? (
                <span className="inline-flex items-center gap-1.5 text-[var(--color-warning-ink)]">
                  <AlertCircle size={12} />
                  {tr('Some tables already hold data.')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[var(--color-success-ink)]">
                  <CheckCircle2 size={12} />
                  {tr('The registry is empty and ready for an import.')}
                </span>
              )}
            </div>

            <div
              className="flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed"
              style={mode === 'merge'
                ? {
                    borderColor: 'var(--color-line)',
                    background: 'var(--color-surface-muted)',
                    color: 'var(--color-ink-2)'
                  }
                : {
                    borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                    background: 'var(--color-danger-bg)',
                    color: 'var(--color-danger-ink)'
                  }}
            >
              {mode === 'merge'
                ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                : <AlertCircle size={13} className="mt-0.5 shrink-0" />}
              <span>
                {mode === 'merge'
                  ? tr('Existing rows are kept; only missing rows are added.')
                  : tr('Replace deletes the existing rows of the selected tables and the rows that depend on them before importing. This cannot be undone.')}
              </span>
            </div>

            {preview.blockedSteps.length > 0 && (
              <div
                className="flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
                  background: 'var(--color-warning-bg)',
                  color: 'var(--color-warning-ink)'
                }}
              >
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>
                  {tr('Some tables cannot be imported and are left out. Review the reasons in the plan below.')}
                </span>
              </div>
            )}

            {importableSteps.length === 0 && (
              <div
                className="flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                  background: 'var(--color-danger-bg)',
                  color: 'var(--color-danger-ink)'
                }}
              >
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{tr('No table can be imported; review the blockers.')}</span>
              </div>
            )}

            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <div className="kicker text-ink-3">{tr('Migration plan')}</div>
                <span className="text-[10.5px] text-ink-3">
                  {tr('{selected} of {count} tables selected', {
                    selected: number.format(selectedSteps.length),
                    count: number.format(importableSteps.length)
                  })}
                </span>
                <div className="ms-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedSteps(importableSteps.map((step) => step.id))}
                    disabled={busy || importableSteps.length === 0}
                    className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[10.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {tr('Select all')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSteps([])}
                    disabled={busy || selectedSteps.length === 0}
                    className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[10.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {tr('Clear selection')}
                  </button>
                </div>
              </div>
              <PlanTable
                steps={steps}
                selectedSteps={selectedSteps}
                onToggle={toggleStep}
                busy={busy}
                mode={mode}
              />
            </div>

            {preview.notes.length > 0 && (
              <div className="rounded-md border border-line bg-surface-muted px-3 py-2">
                <div className="kicker mb-1 text-ink-3">{tr('Notes')}</div>
                <ul className="list-disc space-y-0.5 ps-4 text-[10.5px] leading-relaxed text-ink-2">
                  {preview.notes.map((item) => <li key={item}>{tr(item)}</li>)}
                </ul>
              </div>
            )}

            {importableSteps.length > 0 && (
              <label className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[11px] text-ink-2">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5"
                  style={{ accentColor: 'var(--color-jade-solid)' }}
                />
                <span>
                  <span className="font-medium text-ink">{tr('Confirm the import')}</span>
                  <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-3">
                    {tr('This writes the mapped rows into the registry and cannot be undone from here. Take a database backup first.')}
                  </span>
                </span>
              </label>
            )}
          </>
        )}

        {report && (
          <div className="space-y-2">
            <div
              className="rounded-md border px-3 py-2.5"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-success) 40%, transparent)',
                background: 'var(--color-success-bg)'
              }}
            >
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-success-ink)]">
                <CheckCircle2 size={13} />
                {tr('Imported rows')} · <span className="mono tabular-nums">{number.format(report.totals.inserted)}</span>
              </div>
              <div className="mono mt-0.5 text-[10px] text-ink-2">
                {report.file.name} · {number.format(report.totals.skipped)} {tr('Skipped')}
                {report.totals.reused > 0 && (
                  <> · {number.format(report.totals.reused)} {tr('Reused')}</>
                )}
              </div>
              {report.mode === 'replace' && (
                <div className="mono mt-0.5 text-[10px] text-ink-2">
                  {tr('Deleted {count} existing rows before importing.', {
                    count: number.format((report.cleared || []).reduce((n, row) => n + row.count, 0))
                  })}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-2">
                <span>
                  {tr('Imported tables')}: <span className="mono tabular-nums">{report.steps.length}</span>
                </span>
                {report.skippedSteps.length > 0 && (
                  <span>
                    {tr('Skipped tables')}: <span className="mono tabular-nums">{report.skippedSteps.length}</span>
                  </span>
                )}
                {report.failedSteps.length > 0 && (
                  <span className="text-[var(--color-danger-ink)]">
                    {tr('Failed tables')}: <span className="mono tabular-nums">{report.failedSteps.length}</span>
                  </span>
                )}
              </div>
              {report.notes.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 ps-4 text-[10.5px] leading-relaxed text-ink-2">
                  {report.notes.map((item) => <li key={item}>{tr(item)}</li>)}
                </ul>
              )}
            </div>

            {report.skippedSteps.length > 0 && (
              <div
                className="rounded-md border px-3 py-2 text-[11px]"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
                  background: 'var(--color-warning-bg)',
                  color: 'var(--color-warning-ink)'
                }}
              >
                <div className="kicker mb-1">{tr('Skipped tables')}</div>
                <ul className="list-disc space-y-0.5 ps-4">
                  {report.skippedSteps.map((step) => (
                    <li key={step.id}>
                      <span className="font-medium text-ink">{tr(step.label)}</span>
                      {' — '}
                      {step.blockers
                        .map((blocker) => blockerText(blocker, (id) => report.skippedSteps.find((item) => item.id === id)?.label || id))
                        .join(' ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.failedSteps.length > 0 && (
              <div
                className="rounded-md border px-3 py-2 text-[11px]"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                  background: 'var(--color-danger-bg)',
                  color: 'var(--color-danger-ink)'
                }}
              >
                <div className="kicker mb-1">{tr('Failed tables')}</div>
                <ul className="list-disc space-y-0.5 ps-4">
                  {report.failedSteps.map((step) => (
                    <li key={step.id}>
                      <span className="font-medium text-ink">{tr(step.label)}</span>
                      {' — '}
                      {blockerText(step, (id) => report.failedSteps.find((item) => item.id === id)?.label || id)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default LegacyImportDialog
