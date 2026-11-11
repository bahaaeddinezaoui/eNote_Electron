import React, { useEffect, useMemo, useState } from 'react'
import { formatDateTime } from '../dateFormat'
import DataTable from './ui/DataTable'
import {
  AlertCircle, CheckCircle2, LogOut, MonitorSmartphone, RefreshCw, Search, ShieldCheck
} from 'lucide-react'
import { PageHeader } from './ui/PageHeader'
import Button from './ui/Button'
import Modal from './ui/Modal'
import Notice from './ui/Notice'
import { tr } from '../i18n'

// The signed-in account's own application windows — and, for an Admin (or a
// Developer the administrator has allowed in Settings), every account's.
//
// A row is one sign-in, not one click: the window keeps its session id and
// sends a heartbeat every minute. A session that has not been seen for ten
// minutes is shown as inactive rather than being closed, because a sleeping
// computer or a short network outage must not sign anybody out. Ending a
// session closes it for good; the next heartbeat of that window signs it out.

const fmtDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (isNaN(date.getTime())) return '—'
  return formatDateTime(date, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

const displayName = (session) =>
  [session.PERSON_FIRST_NAME, session.PERSON_LAST_NAME].filter(Boolean).join(' ')
  || session.USER_USERNAME
  || '—'

const deviceLine = (session) =>
  [session.DEVICE_PLATFORM, session.APP_VERSION ? `v${session.APP_VERSION}` : null]
    .filter(Boolean)
    .join(' · ')

const STATUS_TONE = {
  ACTIVE: {
    color: 'var(--color-success-ink)',
    background: 'var(--color-success-bg)'
  },
  INACTIVE: {
    color: 'var(--color-warning-ink)',
    background: 'var(--color-warning-bg)'
  },
  ENDED: {
    color: 'var(--color-ink-3)',
    background: 'var(--color-surface-muted)'
  }
}

const statusLabel = (status) => {
  if (status === 'ACTIVE') return tr('Active')
  if (status === 'INACTIVE') return tr('Inactive')
  return tr('Ended')
}

const endReasonLabel = (session) => {
  if (!session.END_REASON) return null
  if (session.END_REASON === 'SIGNED_OUT') return tr('Signed out')
  if (session.END_REASON === 'ENDED_BY_ADMIN') return tr('Ended by an administrator')
  if (session.END_REASON === 'ENDED_BY_DEVELOPER') return tr('Ended by a developer')
  return session.END_REASON
}

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.ENDED
  return (
    <span
      className="mono inline-flex h-[20px] items-center border px-1.5 text-[9px] uppercase tracking-[0.06em]"
      style={{
        color: tone.color,
        background: tone.background,
        borderColor: 'color-mix(in srgb, currentColor 35%, transparent)'
      }}
    >
      {statusLabel(status)}
    </span>
  )
}

const matchesSearch = (session, term) => {
  if (!term) return true
  return [
    session.USER_USERNAME,
    session.USER_EMAIL,
    displayName(session),
    session.ROLE_CODE,
    session.DEVICE_NAME,
    session.DEVICE_PLATFORM,
    session.APP_VERSION
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(term))
}

const UserSessions = ({ user, onLogout }) => {
  const [tab, setTab] = useState('mine')
  const [mine, setMine] = useState([])
  const [all, setAll] = useState([])
  const [canManageAll, setCanManageAll] = useState(false)
  const [activeWindowMinutes, setActiveWindowMinutes] = useState(10)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [notice, setNotice] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const currentSessionId = user?.sessionId ?? null

  const load = async (which = tab, quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const mineRes = await window.api.getUserSessions(user?.id, currentSessionId)
      const canManage = !!mineRes?.canManageAll
      setMine(mineRes?.sessions || [])
      setCanManageAll(canManage)
      if (mineRes?.activeWindowMinutes) setActiveWindowMinutes(mineRes.activeWindowMinutes)

      if (which === 'all' && canManage) {
        const allRes = await window.api.getAllUserSessions(user?.id, {
          currentSessionId
        })
        setAll(allRes?.sessions || [])
      }
    } catch (err) {
      if (!quiet) {
        setNotice({ type: 'error', text: err.message || tr('Could not load the sessions.') })
      }
    } finally {
      if (!quiet) setLoading(false)
    }
  }

  useEffect(() => {
    load(tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tab])

  // A page left open would otherwise keep showing a session as active after its
  // heartbeat stopped. The rows are cheap to re-read and this never signs the
  // window out; the App heartbeat owns that decision.
  useEffect(() => {
    const timer = setInterval(() => load(tab, true), 60 * 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user?.id])

  const source = tab === 'all' ? all : mine
  const term = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    return source.filter((session) => {
      if (status !== 'ALL' && session.STATUS !== status) return false
      return matchesSearch(session, term)
    })
  }, [source, status, term])

  const activeCount = source.filter((session) => session.STATUS === 'ACTIVE').length
  const openCount = source.filter((session) => session.STATUS !== 'ENDED').length
  // A bulk end keeps this window signed in, so it is offered only when there is
  // indeed another open session to close.
  const otherOpenCount = source.filter(
    (session) => session.STATUS !== 'ENDED' && !session.IS_CURRENT
  ).length

  const askEnd = (session) => setConfirm({ kind: 'one', session })
  const askOthers = () => setConfirm({ kind: tab === 'all' ? 'all' : 'others' })

  const endOne = async (session) => {
    setBusy(true)
    try {
      const res = await window.api.endUserSession(user?.id, session.USER_SESSION_ID)
      const isCurrent = Number(session.USER_SESSION_ID) === Number(currentSessionId)
      if (isCurrent) {
        onLogout?.()
        return
      }
      setNotice({
        type: 'success',
        text: res?.alreadyEnded
          ? tr('This session had already ended.')
          : tr('Session ended.')
      })
      setConfirm(null)
      await load(tab)
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const endMany = async () => {
    setBusy(true)
    try {
      const res = confirm?.kind === 'all'
        ? await window.api.endAllUserSessions(user?.id, currentSessionId)
        : await window.api.endOtherUserSessions(user?.id, currentSessionId)
      const count = Number(res?.ended) || 0
      setNotice({
        type: 'success',
        text: count > 0
          ? tr('{count} sessions ended.', { count })
          : tr('No other open session was found.')
      })
      setConfirm(null)
      await load(tab)
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const confirmTitle = confirm?.kind === 'one'
    ? tr('End this session?')
    : confirm?.kind === 'all'
      ? tr('End every other session?')
      : tr('End all your other sessions?')

  const confirmText = confirm?.kind === 'one'
    ? tr('The device is signed out on its next heartbeat. If it is this window, you are signed out immediately.')
    : confirm?.kind === 'all'
      ? tr('Every other open session on this installation is closed. Your current window stays signed in.')
      : tr('Every other session of your account is closed. Your current window stays signed in.')

  const targetLabel = confirm?.session
    ? `${displayName(confirm.session)}${confirm.session.DEVICE_NAME ? ` · ${confirm.session.DEVICE_NAME}` : ''}`
    : null

  const columns = tab === 'all' ? 7 : 6

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Security')}
        title={tr('Sessions')}
        meta={[
          `${openCount} ${tr('open')}`,
          `${activeCount} ${tr('active')}`,
          `${source.length} ${tr('shown')}`
        ].join(' · ')}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => load(tab)}
              disabled={loading}
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
            </Button>
            {tab === 'mine' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={askOthers}
                disabled={loading || otherOpenCount === 0}
              >
                {tr('End all other sessions')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="danger"
                onClick={askOthers}
                disabled={loading || otherOpenCount === 0}
              >
                {tr('End every other session')}
              </Button>
            )}
          </>
        }
      />

      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab('mine')}
            aria-pressed={tab === 'mine'}
            className={`inline-flex h-7 items-center gap-1.5 rounded-[3px] border px-2 text-[11px] ${
              tab === 'mine'
                ? 'border-line-strong bg-selection text-ink'
                : 'border-transparent text-ink-3 hover:bg-surface-muted hover:text-ink'
            }`}
          >
            <MonitorSmartphone size={11} /> {tr('My sessions')}
          </button>
          {canManageAll && (
            <button
              type="button"
              onClick={() => setTab('all')}
              aria-pressed={tab === 'all'}
              className={`inline-flex h-7 items-center gap-1.5 rounded-[3px] border px-2 text-[11px] ${
                tab === 'all'
                  ? 'border-line-strong bg-selection text-ink'
                  : 'border-transparent text-ink-3 hover:bg-surface-muted hover:text-ink'
              }`}
            >
              <ShieldCheck size={11} /> {tr('All accounts')}
            </button>
          )}
        </div>

        <div className="relative w-[240px] max-w-full">
          <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tab === 'all'
              ? tr('Name, username, role or device')
              : tr('Device, platform or version')}
            aria-label={tr('Search sessions')}
            className="field h-7 ps-6 text-[11.5px]"
          />
        </div>

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label={tr('Filter by status')}
          className="field h-7 w-[130px] text-[11px]"
        >
          <option value="ALL">{tr('All statuses')}</option>
          <option value="ACTIVE">{tr('Active')}</option>
          <option value="INACTIVE">{tr('Inactive')}</option>
          <option value="ENDED">{tr('Ended')}</option>
        </select>

        <span className="mono ms-auto text-[10px] text-ink-3">{filtered.length}/{source.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <DataTable
          className="data-table"
          label={tr('Sessions')}
          columns={[
            { key: 'c0', when: tab === 'all', header: <>{tr('Account')}</> },
            { key: 'c1', header: <>{tr('Device')}</> },
            { key: 'c2', width: 90, header: <>{tr('Status')}</> },
            { key: 'c3', width: 175, header: <>{tr('Started')}</> },
            { key: 'c4', width: 175, header: <>{tr('Last seen')}</> },
            { key: 'c5', width: 210, header: <>{tr('Ended')}</> },
            { key: 'c6', width: 90 },
          ]}
        >
            {loading && source.length === 0 ? (
              <tr>
                <td colSpan={columns} className="!h-20 text-center text-[11.5px] text-ink-3">
                  {tr('Loading sessions…')}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={columns} className="!h-40 text-center">
                  <div className="mx-auto max-w-[320px]">
                    <MonitorSmartphone size={20} className="mx-auto text-ink-3" />
                    <p className="mt-2 text-[12.5px] font-medium text-ink-2">
                      {source.length === 0
                        ? tr('No session has been recorded for this account yet.')
                        : tr('No session matches these filters.')}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-3">
                      {source.length === 0
                        ? tr('A session is recorded when an account signs in on a computer.')
                        : tr('Clear the search or choose another status to see every session again.')}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((session) => {
                const ended = session.STATUS === 'ENDED'
                return (
                  <tr key={session.USER_SESSION_ID}>
                    {tab === 'all' && (
                      <td className="max-w-0">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate font-medium text-ink">{displayName(session)}</span>
                          {session.ROLE_CODE && (
                            <span className="mono shrink-0 border border-line px-1 text-[9px] uppercase tracking-[0.04em] text-ink-3">
                              {session.ROLE_CODE}
                            </span>
                          )}
                        </span>
                        <span className="mono block truncate text-[9.5px] text-ink-3">
                          @{session.USER_USERNAME}
                          {session.USER_EMAIL ? ` · ${session.USER_EMAIL}` : ''}
                        </span>
                      </td>
                    )}
                    <td className="max-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-ink">
                          {session.DEVICE_NAME || tr('Unknown device')}
                        </span>
                        {session.IS_CURRENT && (
                          <span className="mono shrink-0 border border-line-strong px-1 text-[9px] uppercase tracking-[0.05em] text-ink-3">
                            {tr('This session')}
                          </span>
                        )}
                      </span>
                      <span className="mono block truncate text-[9.5px] text-ink-3">
                        {deviceLine(session) || '—'}
                      </span>
                    </td>
                    <td><StatusBadge status={session.STATUS} /></td>
                    <td className="mono text-[10.5px] text-ink-3">{fmtDateTime(session.STARTED_AT)}</td>
                    <td className="mono text-[10.5px] text-ink-3">{fmtDateTime(session.LAST_SEEN_AT)}</td>
                    <td className="text-[10.5px] text-ink-3">
                      {ended ? (
                        <>
                          <span className="mono block">{fmtDateTime(session.ENDED_AT)}</span>
                          <span className="block truncate">
                            {endReasonLabel(session) || '—'}
                            {session.ENDED_BY_USERNAME ? ` · @${session.ENDED_BY_USERNAME}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="!pe-2 text-end">
                      {!ended ? (
                        <button
                          type="button"
                          onClick={() => askEnd(session)}
                          title={
                            session.IS_CURRENT
                              ? tr('End this session and sign this window out')
                              : tr('End this session')
                          }
                          className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border px-2 text-[10.5px] hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-40"
                          style={{
                            borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                            color: 'var(--color-danger-ink)'
                          }}
                        >
                          <LogOut size={10} /> {tr('End')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                )
              })
            )}
        </DataTable>

        <div className="flex items-start gap-2 border-t border-line px-5 py-2.5 text-[10.5px] text-ink-3">
          <AlertCircle size={12} className="mt-px shrink-0" />
          <span>
            {tr('A session with no heartbeat for {count} minutes is shown as inactive but is not closed automatically. Ending it closes it for good; the window signs out on its next heartbeat.', { count: activeWindowMinutes })}
            {tab === 'all' && canManageAll
              ? ` ${tr('Ending another account’s session is recorded in the activity log.')}`
              : ''}
          </span>
        </div>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => { if (!busy) setConfirm(null) }}
        title={confirmTitle}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={busy}
              className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:opacity-40"
            >
              {tr('Cancel')}
            </button>
            <Button
              size="sm"
              variant="danger-solid"
              onClick={confirm?.kind === 'one' ? () => endOne(confirm.session) : endMany}
              loading={busy}
            >
              {confirm?.kind === 'one' ? tr('End session') : tr('End sessions')}
            </Button>
          </div>
        }
      >
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full"
            style={{
              background: 'var(--color-danger-bg)',
              color: 'var(--color-danger-ink)'
            }}
          >
            <LogOut size={14} />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] leading-relaxed text-ink-2">{confirmText}</p>
            {targetLabel && (
              <p className="mono mt-2 truncate text-[10.5px] text-ink-3">{targetLabel}</p>
            )}
            {confirm?.kind === 'one' && confirm.session?.IS_CURRENT && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-2">
                <CheckCircle2 size={11} /> {tr('You are ending the session of this window.')}
              </p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default UserSessions
