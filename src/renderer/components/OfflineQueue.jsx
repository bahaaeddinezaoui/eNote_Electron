import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react'
import Modal from './ui/Modal'
import DataTable from './ui/DataTable'
import Notice from './ui/Notice'
import { localizedLabel, useI18n } from '../i18n'
import { dateLocale } from '../scheduleUtils'
import { describeFlushRun } from '../offlineNotice'

// The offline queue, in the title bar.
//
// Attendance recorded while the server was away waits in a local queue. This is
// where that queue is visible: what is still to be sent, what could not be sent,
// and — the reason the queue exists — what conflicted because somebody else
// changed the same record. A conflict is never resolved automatically: the two
// versions are shown side by side and one of them is chosen.

const EMPTY = { total: 0, pending: 0, conflict: 0, failed: 0 }

const KIND_LABEL = {
  'absence.mark': 'Absence recorded',
  'absence.clear': 'Marked present',
  'observation.create': 'Observation recorded',
  'observation.delete': 'Observation deleted',
  'observation.clear': 'Observation deleted',
  'session.attended': 'Session confirmed as held',
  'bugReport.create': 'Bug report saved',
  'betaTest.save': 'Beta test report saved',
  'notification.comment': 'Comment saved'
}

const buttonCls =
  'inline-flex h-5 items-center gap-1 rounded-[2px] border border-line-strong bg-surface px-1.5 text-[9.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:opacity-60'

const stamp = (value) => {
  try {
    return new Intl.DateTimeFormat(dateLocale(), {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return ''
  }
}

const AbsenceDiff = ({ conflict }) => {
  const { t } = useI18n()
  const labelOf = (side) =>
    side?.justification
      ? localizedLabel(side.justification, 'ABSENCE_JUSTIFICATION_LABEL')
      : t('Removed')

  // An absence has a justification; an observation does not, so the row is left
  // out rather than printed empty. A deletion shows "Removed" on the side that
  // no longer wants the note.
  const rows = []
  if (conflict?.desired?.justificationId || conflict?.current?.justificationId) {
    rows.push({
      key: 'justification',
      label: t('Justification'),
      mine: labelOf(conflict?.desired),
      theirs: labelOf(conflict?.current)
    })
  }
  rows.push({
    key: 'note',
    label: t('Note'),
    mine: conflict?.action === 'delete' ? t('Removed') : conflict?.desired?.note || '—',
    theirs: conflict?.current?.note || '—'
  })

  return (
    <div className="mt-2 border-t border-line pt-2">
      <p className="text-[10.5px] leading-relaxed text-warning-ink">
        {t('Someone else changed this record after you did. Choose the version to keep.')}
      </p>
      <DataTable
        className="mt-2 w-full text-[10.5px]"
        headClassName="text-ink-3"
        columns={[
          { key: 'c0', className: "w-[28%] text-start font-medium" },
          { key: 'c1', className: "text-start font-medium", header: <>{t('Your version')}</> },
          { key: 'c2', className: "text-start font-medium", header: <>{t('On the server')}</> },
        ]}
      >
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-line align-top">
              <td className="py-1 pe-2 text-ink-3">{row.label}</td>
              <td className="py-1 pe-2 text-ink">{row.mine}</td>
              <td className="py-1 text-ink">{row.theirs}</td>
            </tr>
          ))}
      </DataTable>
    </div>
  )
}

export default function OfflineQueue() {
  const { t } = useI18n()
  const [counts, setCounts] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [flash, setFlash] = useState(null)

  // A run recorded before this window opened is old news: report only flushes
  // that happen while the page is watching, and each one only once.
  const mountedAtRef = useRef(Date.now())
  const shownRunRef = useRef(0)

  const loadCounts = useCallback(async () => {
    try {
      const next = await window.api.getOutboxCounts()
      setCounts(next && next.total !== undefined ? { ...EMPTY, ...next } : EMPTY)
      return next
    } catch {
      // No queue readable: the chip stays out of the way.
      return null
    }
  }, [])

  // When the queue drains, say what happened. A silent success leaves the
  // teacher unsure whether the register reached the server, and a conflict that
  // only shows as a small chip is a conflict nobody reads.
  const announce = useCallback(
    (state) => {
      const run = state?.lastRun
      if (!run || !run.at || run.at < mountedAtRef.current || run.at === shownRunRef.current) return
      shownRunRef.current = run.at

      const summary = describeFlushRun(run)
      if (!summary) return

      let text
      if (summary.kind === 'partial') {
        text = t('{count} queued changes sent. {conflicts} need review.', {
          count: summary.sent,
          conflicts: summary.conflicts
        })
      } else if (summary.kind === 'review') {
        text = t('{count} changes need review.', { count: summary.conflicts })
      } else if (summary.kind === 'failed') {
        text = t('{count} could not be sent.', { count: summary.failed })
      } else {
        text = t('{count} queued changes sent.', { count: summary.sent })
      }

      setFlash({
        text,
        type: summary.kind === 'sent' ? 'success' : 'error',
        persist: summary.kind !== 'sent'
      })
    },
    [t]
  )

  const loadEntries = useCallback(async () => {
    try {
      const list = await window.api.getOutboxEntries()
      setEntries(Array.isArray(list) ? list : [])
    } catch {
      setEntries([])
    }
  }, [])

  useEffect(() => {
    loadCounts().then(announce)
    const timer = window.setInterval(loadCounts, 20000)
    // The main process pushes the counts the moment an entry is queued, sent or
    // found to conflict, so the chip is right without waiting for the timer.
    const off = window.api.onOutboxChanged?.((next) => {
      if (next && next.total !== undefined) setCounts({ ...EMPTY, ...next })
      else loadCounts()
      announce(next)
      loadEntries()
    })
    return () => {
      window.clearInterval(timer)
      if (typeof off === 'function') off()
    }
  }, [loadCounts, loadEntries, announce])

  useEffect(() => {
    if (open) loadEntries()
  }, [open, loadEntries])

  const act = async (run) => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await run()
      await loadCounts()
      await loadEntries()
    } catch (error) {
      setMessage(error?.message || t('The queue could not be read on this computer.'))
    } finally {
      setBusy(false)
    }
  }

  // Nothing waiting: no chip at all, so a normal day looks unchanged. The toast
  // and the dialog stay mounted, because a flush can finish when the queue is
  // already empty — that is exactly when its result has to be said.
  const conflicted = counts.conflict > 0
  const waiting = counts.pending + counts.failed

  const groups = [
    {
      key: 'conflict',
      title: 'Needs review',
      rows: entries.filter((entry) => entry.status === 'CONFLICT')
    },
    {
      key: 'pending',
      title: 'Waiting to be sent',
      rows: entries.filter((entry) => entry.status === 'PENDING')
    },
    {
      key: 'failed',
      title: 'Could not be sent',
      rows: entries.filter((entry) => entry.status === 'FAILED')
    }
  ].filter((group) => group.rows.length > 0)

  return (
    <>
      {counts.total > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t('Queued changes')}
          aria-label={t('Queued changes')}
          className={`me-1 inline-flex h-5 items-center gap-1 rounded-[2px] border px-1.5 text-[9.5px] font-medium ${
            conflicted
              ? 'border-danger/50 bg-danger-bg text-danger-ink'
              : 'border-warning/50 bg-warning-bg text-warning-ink'
          }`}
        >
          {conflicted ? <AlertTriangle size={9} strokeWidth={2} /> : <CloudOff size={9} strokeWidth={2} />}
          {conflicted
            ? t('{count} to review', { count: counts.conflict })
            : t('{count} queued', { count: waiting })}
        </button>
      )}

      <Notice notice={flash} onDismiss={() => setFlash(null)} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('Changes saved offline')}
        maxWidth="max-w-2xl"
      >
        <p className="text-[11px] leading-relaxed text-ink-2">
          {t('These changes were made while the server was unreachable. They are sent automatically when it comes back.')}
        </p>

        {message && (
          <p role="alert" className="mt-2 text-[10.5px]" style={{ color: 'var(--color-danger-ink)' }}>
            {message}
          </p>
        )}

        {entries.length === 0 ? (
          <p className="mt-4 text-[11.5px] text-ink-3">{t('Nothing is waiting.')}</p>
        ) : (
          <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pe-1">
            {groups.map((group) => (
              <section key={group.key}>
                <div className="kicker mb-1.5 text-[9px]">{t(group.title)}</div>
                <div className="space-y-2">
                  {group.rows.map((entry) => (
                    <article key={entry.id} className="border border-line bg-surface p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-ink">
                            {t(KIND_LABEL[entry.kind] || 'Queued changes')}
                          </div>
                          <div className="mono mt-0.5 text-[10px] text-ink-3">
                            {stamp(entry.createdAt)}
                            {entry.sessionId ? ` · #${entry.sessionId}` : ''}
                          </div>
                          {entry.status === 'FAILED' && entry.lastError && (
                            <div className="mt-1 text-[10.5px]" style={{ color: 'var(--color-danger-ink)' }}>
                              {entry.lastError}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {entry.status === 'CONFLICT' && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => act(() => window.api.resolveOutboxConflict(entry.id, 'mine'))}
                                className={buttonCls}
                              >
                                {t('Keep mine')}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => act(() => window.api.resolveOutboxConflict(entry.id, 'server'))}
                                className={buttonCls}
                              >
                                {t('Keep server')}
                              </button>
                            </>
                          )}
                          {entry.status === 'FAILED' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                act(async () => {
                                  await window.api.retryOutboxEntry(entry.id)
                                  await window.api.flushOutbox()
                                })
                              }
                              className={buttonCls}
                            >
                              <RefreshCw size={9} strokeWidth={2} /> {t('Retry')}
                            </button>
                          )}
                          {entry.status !== 'FAILED' && entry.status !== 'CONFLICT' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => act(() => window.api.discardOutboxEntry(entry.id))}
                              className={buttonCls}
                            >
                              {t('Discard')}
                            </button>
                          )}
                          {entry.status === 'FAILED' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => act(() => window.api.discardOutboxEntry(entry.id))}
                              className={buttonCls}
                            >
                              {t('Discard')}
                            </button>
                          )}
                        </div>
                      </div>

                      {entry.status === 'CONFLICT' && entry.conflict && (
                        <AbsenceDiff conflict={entry.conflict} />
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {entries.length > 0 && (
          <div className="mt-4 flex items-center justify-end border-t border-line pt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => window.api.flushOutbox())}
              className="inline-flex h-7 items-center gap-1.5 rounded-[3px] px-3 text-[11px] font-semibold disabled:opacity-60"
              style={{ background: 'var(--color-jade-solid)', color: 'var(--color-on-jade)' }}
            >
              <RefreshCw size={11} strokeWidth={2} className={busy ? 'animate-spin' : undefined} />
              {t('Send now')}
            </button>
          </div>
        )}
      </Modal>
    </>
  )
}
