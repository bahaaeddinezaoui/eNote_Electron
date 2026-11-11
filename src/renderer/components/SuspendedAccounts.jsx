import React, { useEffect, useMemo, useState } from 'react'
import { formatDateTime } from '../dateFormat'
import DataTable from './ui/DataTable'
import { Search, RefreshCw, Lock, ShieldCheck, AlertCircle, Power } from 'lucide-react'
import { PageHeader } from './ui/PageHeader'
import Notice from './ui/Notice'
import { sortRows } from './ui/tableSort'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import { tr } from '../i18n'

// Accounts suspended after repeated wrong passwords (Admin only).
//
// Sign-in counts consecutive failures and locks the account itself on the fifth
// (see authService); this page is the way back. Restoring clears the suspension
// and puts the counter back to zero, and the admin who did it is recorded on the
// row. Suspension is not deactivation: an account that was also switched off on
// the Accounts page still needs reactivating there, which each row says.

const displayName = (account) =>
  [account.PERSON_FIRST_NAME_LA, account.PERSON_LAST_NAME_LA].filter(Boolean).join(' ')
  || [account.PERSON_FIRST_NAME, account.PERSON_LAST_NAME].filter(Boolean).join(' ')
  || account.USER_USERNAME

const fmtDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (isNaN(date.getTime())) return '—'
  return formatDateTime(date, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

const SORT_ACCESSORS = {
  name: (account) => displayName(account),
  roles: (account) => (account.ROLE_CODES || []).join(' '),
  attempts: (account) => Number(account.FAILED_LOGIN_ATTEMPTS || 0),
  suspended: (account) => (account.SUSPENDED_AT ? new Date(account.SUSPENDED_AT).getTime() : null)
}

const SuspendedAccounts = ({ user }) => {
  const isAdmin = !!user && user.roles?.includes('ADMIN')

  const [accounts, setAccounts] = useState([])
  const [maxAttempts, setMaxAttempts] = useState(5)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState(null)
  const [restoringId, setRestoringId] = useState(null)
  // Newest suspension first: the account somebody is waiting on is at the top.
  const [sort, setSort] = useState({ key: 'suspended', dir: 'desc' })

  const load = async () => {
    if (!isAdmin) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await window.api.getSuspendedAccounts(user?.id)
      setAccounts(res?.accounts || [])
      if (res?.maxAttempts) setMaxAttempts(res.maxAttempts)
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return accounts
    return accounts.filter((account) =>
      [
        account.USER_USERNAME,
        account.USER_EMAIL,
        displayName(account),
        ...(account.ROLE_CODES || [])
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    )
  }, [accounts, search])

  const rows = useMemo(() => sortRows(filtered, sort, SORT_ACCESSORS), [filtered, sort])

  const deactivatedCount = accounts.filter((account) => account.IS_ACTIVE === false).length

  const restore = async (account) => {
    setRestoringId(account.USER_ID)
    try {
      const res = await window.api.unlockAccount(user?.id, account.USER_ID)
      setAccounts((prev) => prev.filter((row) => row.USER_ID !== account.USER_ID))
      setNotice({
        type: 'success',
        text: res?.stillDeactivated
          ? `${tr('Access restored:')} @${account.USER_USERNAME}${tr(' — the account is still deactivated, so it must also be activated on the Accounts page.')}`
          : `${tr('Access restored:')} @${account.USER_USERNAME}`
      })
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setRestoringId(null)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="max-w-md text-center text-[12px] text-ink-3">
          {tr('Restoring suspended accounts requires the Admin role.')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Administration')}
        title={tr('Suspended accounts')}
        meta={[
          `${accounts.length} ${tr('suspended')}`,
          deactivatedCount > 0 ? `${deactivatedCount} ${tr('also deactivated')}` : null,
          `${maxAttempts} ${tr('wrong passwords suspend an account')}`
        ].filter(Boolean).join(' · ')}
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

      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-1.5">
        <div className="relative w-[240px] max-w-full">
          <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr('Name, username, email or role')}
            aria-label={tr('Search suspended accounts')}
            className="field h-7 ps-6 text-[11.5px]"
          />
        </div>
        <FilterBar
          activeCount={search.trim() ? 1 : 0}
          onClear={() => setSearch('')}
          matchCount={filtered.length}
          matchLabel="account"
          title={tr('Filter suspended accounts')}
        >
          <FilterField label={tr('Sort by')}>
            <select
              className={filterInputCls}
              value={sort.key}
              onChange={(event) => setSort((current) => ({ ...current, key: event.target.value }))}
              aria-label={tr('Sort accounts by')}
            >
              <option value="name">{tr('Account')}</option>
              <option value="roles">{tr('Roles')}</option>
              <option value="attempts">{tr('Attempts')}</option>
              <option value="suspended">{tr('Suspended')}</option>
            </select>
          </FilterField>
          <FilterField label={tr('Order')}>
            <select
              className={filterInputCls}
              value={sort.dir}
              onChange={(event) => setSort((current) => ({ ...current, dir: event.target.value }))}
              aria-label={tr('Sort order')}
            >
              <option value="asc">{tr('Ascending')}</option>
              <option value="desc">{tr('Descending')}</option>
            </select>
          </FilterField>
        </FilterBar>
        <span className="mono ms-auto text-[10px] text-ink-3">{filtered.length}/{accounts.length}</span>
      </div>

      {/* Active filters stay on the toolbar trigger, never over the table. */}

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <DataTable
          className="data-table"
          label={tr('Suspended accounts')}
          columns={[
            { key: 'c0', header: <>{tr('Account')}</> },
            { key: 'c1', width: 200, header: <>{tr('Roles')}</> },
            { key: 'c2', width: 90, className: "text-end", header: <>{tr('Attempts')}</> },
            { key: 'c3', width: 190, header: <>{tr('Suspended')}</> },
            { key: 'c4', width: 120, header: <>{tr('Access')}</> },
            { key: 'c5', width: 160 },
          ]}
        >
            {loading && accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="!h-20 text-center text-[11.5px] text-ink-3">
                  {tr('Loading suspended accounts…')}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="!h-40 text-center">
                  <div className="mx-auto max-w-[280px]">
                    <ShieldCheck size={20} className="mx-auto text-ink-3" />
                    <p className="mt-2 text-[12.5px] font-medium text-ink-2">
                      {accounts.length === 0 ? tr('No account is suspended.') : tr('No suspended account matches this search.')}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-3">
                      {accounts.length === 0
                        ? tr('An account is suspended by itself after {count} consecutive wrong passwords.', { count: maxAttempts })
                        : tr('Clear the search to see every suspended account again.')}
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((account) => {
                const deactivated = account.IS_ACTIVE === false
                const restoring = restoringId === account.USER_ID
                return (
                  <tr key={account.USER_ID}>
                    <td className="max-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-medium text-ink">{displayName(account)}</span>
                        {deactivated && (
                          <span className="mono shrink-0 border border-line-strong px-1 text-[9px] uppercase tracking-[0.05em] text-ink-3">
                            {tr('Deactivated')}
                          </span>
                        )}
                      </span>
                      <span className="mono block truncate text-[9.5px] text-ink-3">
                        @{account.USER_USERNAME}
                        {account.USER_EMAIL ? ` · ${account.USER_EMAIL}` : ''}
                      </span>
                    </td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {(account.ROLE_CODES || []).length === 0 ? (
                          <span className="text-[10.5px] text-ink-3">—</span>
                        ) : (
                          (account.ROLE_CODES || []).map((code) => (
                            <span
                              key={code}
                              className="mono border border-line px-1 py-0.5 text-[9px] uppercase tracking-[0.04em] text-ink-3"
                            >
                              {code}
                            </span>
                          ))
                        )}
                      </span>
                    </td>
                    <td className="num">{account.FAILED_LOGIN_ATTEMPTS ?? maxAttempts}</td>
                    <td className="mono text-[10.5px] text-ink-3">{fmtDateTime(account.SUSPENDED_AT)}</td>
                    <td>
                      <span
                        className="mono inline-flex h-[20px] items-center gap-1 border px-1.5 text-[9px] uppercase tracking-[0.06em]"
                        style={{
                          borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                          color: 'var(--color-danger-ink)'
                        }}
                      >
                        <Lock size={9} /> {tr('Suspended')}
                      </span>
                    </td>
                    <td className="!pe-2 text-end">
                      <button
                        type="button"
                        onClick={() => restore(account)}
                        disabled={restoring}
                        title={
                          deactivated
                            ? tr('Restore access. The account is still deactivated and will not be able to sign in until it is activated.')
                            : tr('Restore access to this account')
                        }
                        className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-line-strong bg-surface px-2 text-[10.5px] text-ink-2 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Power size={10} /> {restoring ? tr('Restoring…') : tr('Restore access')}
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
        </DataTable>

        <div className="flex items-start gap-2 border-t border-line px-5 py-2.5 text-[10.5px] text-ink-3">
          <AlertCircle size={12} className="mt-px shrink-0" />
          {tr('Restoring clears the failed attempts and lets the account sign in again. A successful sign-in also resets the count, so the five are consecutive, not lifetime.')}
        </div>
      </div>
    </div>
  )
}

export default SuspendedAccounts
