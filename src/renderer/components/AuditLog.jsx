import React, { useCallback, useEffect, useRef, useState } from 'react'
import { formatDateTime } from '../dateFormat'
import DataTable from './ui/DataTable'
import { AlertCircle, CheckCircle2, Download, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import { PageIntro } from './ui/PageHeader'
import Modal from './ui/Modal'
import Pagination from './ui/Pagination'
import { tr } from '../i18n'
import { auditActionLabel } from '../../shared/auditActions'
import { activatableRowProps } from './ui/tableA11y'

// Activity log — the audit trail, for Admin and Developer accounts. Entries are
// written by the main process as the actions happen; this page reads them,
// filters them and exports them, and never edits or deletes one (the table
// itself refuses UPDATE and DELETE — see migration_audit_log.sql).

const PAGE_SIZE = 25

const EMPTY_FILTERS = {
  q: '',
  from: '',
  to: '',
  actor: '',
  action: '',
  entityType: '',
  result: ''
}

const formatTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return isNaN(date.getTime()) ? '—' : formatDateTime(date)
}

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function ResultBadge({ result }) {
  const failure = result === 'failure'
  const color = failure ? 'var(--color-danger-ink)' : 'var(--color-success-ink)'
  const background = failure ? 'var(--color-danger-bg)' : 'var(--color-success-bg)'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color, background, borderColor: 'color-mix(in srgb, currentColor 35%, transparent)' }}
    >
      {failure ? <AlertCircle size={10} /> : <CheckCircle2 size={10} />}
      {failure ? tr('Failure') : tr('Success')}
    </span>
  )
}

const AuditLog = ({ user }) => {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState({ actions: [], entities: [] })
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  // The visit itself is recorded once per opening, not on every keystroke.
  const viewRecorded = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.getAuditLog(user?.id, {
        ...filters,
        page,
        pageSize: PAGE_SIZE,
        recordView: !viewRecorded.current
      })
      viewRecorded.current = true
      setRows(res?.rows || [])
      setTotal(Number(res?.total) || 0)
      setFacets({ actions: res?.actions || [], entities: res?.entities || [] })
    } catch (err) {
      setError(err.message || tr('Could not load the activity log.'))
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [user?.id, filters, page])

  useEffect(() => {
    load()
  }, [load])

  // Typing should not query on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((prev) => (prev.q === search ? prev : { ...prev, q: search }))
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS)
    setSearch('')
    setPage(1)
  }

  const exportCsv = async () => {
    setExporting(true)
    setError('')
    try {
      const res = await window.api.exportAuditLogCsv(user?.id, filters)
      const blob = new Blob([res?.csv || ''], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = res?.filename || 'activity-log.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || tr('Could not export the activity log.'))
    } finally {
      setExporting(false)
    }
  }

  const changedCount = (row) => Object.keys(row?.CHANGES || {}).length

  return (
    <div className="space-y-4">
      <PageIntro
        kicker={tr('Audit')}
        title={tr('Activity log')}
        meta={`${total} ${tr('entries')}`}
        actions={
          <>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:opacity-40"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : undefined} />
              {tr('Refresh')}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={exporting || total === 0}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={11} />
              {exporting ? tr('Exporting…') : tr('Export CSV')}
            </button>
          </>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Every sign-in, permission change and record change, written where the action happens. Entries cannot be edited or deleted from the application; entries older than 12 months are pruned automatically.')}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
          <ShieldCheck size={11} />
          {tr('Passwords and tokens are never stored. Identifiers and phone numbers are masked.')}
        </p>
      </PageIntro>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[11.5px]" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }}>
          <AlertCircle size={13} />
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="ms-auto opacity-70 hover:opacity-100" aria-label={tr('Dismiss message')}>
            ✕
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-muted px-3 py-2">
          <div className="relative w-full max-w-[320px]">
            <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tr('Search actor, action, entity or error…')}
              aria-label={tr('Search the activity log')}
              className="field h-7 w-full ps-6 text-[11.5px]"
            />
          </div>
          <FilterBar
            activeCount={[filters.from, filters.to, filters.actor, filters.action, filters.entityType, filters.result].filter(Boolean).length + (search ? 1 : 0)}
            onClear={resetFilters}
            matchCount={total}
            matchLabel="record"
            title={tr('Filter the activity log')}
          >
            <FilterField label={tr('From')}>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => setFilter('from', event.target.value)}
                aria-label={tr('From date')}
                className={filterInputCls}
              />
            </FilterField>
            <FilterField label={tr('To')}>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => setFilter('to', event.target.value)}
                aria-label={tr('To date')}
                className={filterInputCls}
              />
            </FilterField>
            <FilterField label={tr('Actor')}>
              <input
                type="text"
                value={filters.actor}
                onChange={(event) => setFilter('actor', event.target.value)}
                placeholder={tr('Actor')}
                aria-label={tr('Filter by actor')}
                className={filterInputCls}
              />
            </FilterField>
            <FilterField label={tr('Action')}>
              <select
                value={filters.action}
                onChange={(event) => setFilter('action', event.target.value)}
                aria-label={tr('Filter by action')}
                className={filterInputCls}
              >
                <option value="">{tr('All actions')}</option>
                {facets.actions.map((code) => (
                  <option key={code} value={code}>{tr(auditActionLabel(code))}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr('Entity')}>
              <select
                value={filters.entityType}
                onChange={(event) => setFilter('entityType', event.target.value)}
                aria-label={tr('Filter by entity')}
                className={filterInputCls}
              >
                <option value="">{tr('All entities')}</option>
                {facets.entities.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr('Result')}>
              <select
                value={filters.result}
                onChange={(event) => setFilter('result', event.target.value)}
                aria-label={tr('Filter by result')}
                className={filterInputCls}
              >
                <option value="">{tr('All results')}</option>
                <option value="success">{tr('Success')}</option>
                <option value="failure">{tr('Failure')}</option>
              </select>
            </FilterField>
          </FilterBar>
          <span className="mono ms-auto text-[10.5px] text-ink-3">{total} {tr('entries')}</span>
        </div>

        {/* Active filters stay on the toolbar trigger, never over the table. */}

        {loading ? (
          <div className="p-8 text-center text-[12px] text-ink-3">{tr('Loading the activity log…')}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[12.5px] text-ink-2">
              {total === 0 && !filters.q && !filters.from && !filters.to && !filters.actor && !filters.action && !filters.entityType && !filters.result
                ? tr('The activity log is empty.')
                : tr('No entries match these filters.')}
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              {tr('Actions are recorded from now on, as they happen.')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              className="data-table"
              label={tr('Activity log')}
              columns={[
                { key: 'c0', header: <>{tr('Time')}</> },
                { key: 'c1', header: <>{tr('Actor')}</> },
                { key: 'c2', header: <>{tr('Action')}</> },
                { key: 'c3', header: <>{tr('Entity')}</> },
                { key: 'c4', header: <>{tr('Result')}</> },
                { key: 'c5', className: "text-end", header: <>{tr('Changed fields')}</> },
              ]}
            >
                {rows.map((row) => (
                  <tr
                    key={row.AUDIT_LOG_ID}
                    aria-label={`${auditActionLabel(row.ACTION)} — ${formatTime(row.OCCURRED_AT)}`}
                    {...activatableRowProps(() => setSelected(row))}
                    onClick={() => setSelected(row)}
                    className="cursor-pointer"
                  >
                    <td className="mono whitespace-nowrap text-[11px] text-ink-2">{formatTime(row.OCCURRED_AT)}</td>
                    <td>
                      <div className="max-w-[190px] truncate text-[12px] text-ink">
                        {row.ACTOR_NAME || row.ACTOR_USERNAME || tr('Unknown actor')}
                      </div>
                      <div className="mono max-w-[190px] truncate text-[9.5px] text-ink-3">
                        {row.ACTOR_USERNAME ? `@${row.ACTOR_USERNAME}` : tr('no account')}
                        {Array.isArray(row.ACTOR_ROLES) && row.ACTOR_ROLES.length > 0 ? ` · ${row.ACTOR_ROLES.join(', ')}` : ''}
                      </div>
                    </td>
                    <td>
                      <div className="max-w-[220px] truncate text-[12px] text-ink-2">{tr(auditActionLabel(row.ACTION))}</div>
                      <div className="mono text-[9.5px] text-ink-3">{row.ACTION}</div>
                    </td>
                    <td>
                      <div className="max-w-[180px] truncate text-[12px] text-ink-2">
                        {row.ENTITY_LABEL || row.ENTITY_ID || '—'}
                      </div>
                      <div className="mono text-[9.5px] text-ink-3">
                        {row.ENTITY_TYPE || '—'}{row.ENTITY_TYPE && row.ENTITY_ID ? ` #${row.ENTITY_ID}` : ''}
                      </div>
                    </td>
                    <td><ResultBadge result={row.RESULT} /></td>
                    <td className="num">{changedCount(row) || '—'}</td>
                  </tr>
                ))}
            </DataTable>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <Pagination page={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        )}
      </section>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={tr('Activity entry')}
        maxWidth="max-w-[720px]"
        footer={
          <div className="flex items-center justify-between gap-2">
            <span className="mono text-[10px] text-ink-3">
              {selected ? `#${selected.AUDIT_LOG_ID}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              {tr('Close')}
            </button>
          </div>
        }
      >
        {selected && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ink">{tr(auditActionLabel(selected.ACTION))}</span>
              <ResultBadge result={selected.RESULT} />
              <span className="mono text-[10px] text-ink-3">{selected.ACTION}</span>
            </div>

            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-[4px] border border-line bg-canvas p-3 text-[11.5px] sm:grid-cols-2">
              <div>
                <dt className="kicker text-[9px]">{tr('Time')}</dt>
                <dd className="mono mt-0.5 text-ink">{formatTime(selected.OCCURRED_AT)}</dd>
              </div>
              <div>
                <dt className="kicker text-[9px]">{tr('Actor')}</dt>
                <dd className="mt-0.5 text-ink">
                  {selected.ACTOR_NAME || selected.ACTOR_USERNAME || tr('Unknown actor')}
                  <span className="mono ms-1.5 text-[10px] text-ink-3">
                    {selected.ACTOR_USERNAME ? `@${selected.ACTOR_USERNAME}` : ''}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="kicker text-[9px]">{tr('Roles')}</dt>
                <dd className="mono mt-0.5 text-ink-2">
                  {Array.isArray(selected.ACTOR_ROLES) && selected.ACTOR_ROLES.length
                    ? selected.ACTOR_ROLES.join(', ')
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="kicker text-[9px]">{tr('Entity')}</dt>
                <dd className="mt-0.5 text-ink">
                  {selected.ENTITY_LABEL || '—'}
                  <span className="mono ms-1.5 text-[10px] text-ink-3">
                    {selected.ENTITY_TYPE || ''}{selected.ENTITY_ID ? ` #${selected.ENTITY_ID}` : ''}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="kicker text-[9px]">{tr('App version')}</dt>
                <dd className="mono mt-0.5 text-ink-2">{selected.APP_VERSION || '—'}</dd>
              </div>
              <div>
                <dt className="kicker text-[9px]">{tr('Result')}</dt>
                <dd className="mt-0.5"><ResultBadge result={selected.RESULT} /></dd>
              </div>
            </dl>

            {selected.ERROR_MESSAGE && (
              <div
                className="rounded-[4px] border border-line p-3 text-[11.5px]"
                style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }}
              >
                <div className="kicker mb-1 text-[9px]">{tr('Error')}</div>
                <div className="whitespace-pre-wrap break-words">{selected.ERROR_MESSAGE}</div>
              </div>
            )}

            <div>
              <div className="kicker mb-1.5 text-[9px]">{tr('Details')}</div>
              {Object.keys(selected.DETAIL || {}).length === 0 ? (
                <p className="text-[11px] text-ink-3">{tr('No further details recorded.')}</p>
              ) : (
                <dl className="divide-y divide-line rounded-[4px] border border-line text-[11.5px]">
                  {Object.entries(selected.DETAIL).map(([key, value]) => (
                    <div key={key} className="flex items-start gap-3 px-3 py-1.5">
                      <dt className="mono w-[150px] shrink-0 text-[10px] text-ink-3">{key}</dt>
                      <dd className="min-w-0 flex-1 break-words text-ink-2">{formatValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div>
              <div className="kicker mb-1.5 text-[9px]">{tr('Changed fields')}</div>
              {changedCount(selected) === 0 ? (
                <p className="text-[11px] text-ink-3">{tr('No field changes recorded.')}</p>
              ) : (
                <DataTable
                  className="data-table"
                  columns={[
                    { key: 'c0', header: <>{tr('Field')}</> },
                    { key: 'c1', header: <>{tr('Before')}</> },
                    { key: 'c2', header: <>{tr('After')}</> },
                  ]}
                >
                    {Object.entries(selected.CHANGES).map(([field, pair]) => (
                      <tr key={field}>
                        <td className="mono text-[10.5px] text-ink-2">{field}</td>
                        <td className="max-w-[240px] truncate text-ink-3" title={formatValue(pair?.before)}>
                          {formatValue(pair?.before)}
                        </td>
                        <td className="max-w-[240px] truncate text-ink" title={formatValue(pair?.after)}>
                          {formatValue(pair?.after)}
                        </td>
                      </tr>
                    ))}
                </DataTable>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default AuditLog
