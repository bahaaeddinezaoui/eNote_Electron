import React, { useEffect, useMemo, useState } from 'react'
import { formatDate } from '../dateFormat'
import DataTable from './ui/DataTable'
import { Search, Power, RefreshCw, AlertCircle, Pencil, KeyRound, X } from 'lucide-react'
import { PageHeader } from './ui/PageHeader'
import Notice from './ui/Notice'
import ConfirmDialog from './ui/ConfirmDialog'
import Modal from './ui/Modal'
import Button from './ui/Button'
import PasswordStrength from './ui/PasswordStrength'
import { isPasswordValid } from '../../shared/passwordPolicy'
import { sortRows } from './ui/tableSort'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import { tr } from '../i18n'
import { ipcErrorMessage } from '../ipcError'

// Account administration (Admin and Developer): who may sign in. Turning an
// account off sets `user.is_active`; everything the account produced stays,
// and it can be switched back on at any time.
//
// The server re-checks the role and refuses two things this page also guards
// against: changing your own account, and deactivating the last active
// administrator or developer.

const displayName = (account) =>
  [account.PERSON_FIRST_NAME_LA, account.PERSON_LAST_NAME_LA].filter(Boolean).join(' ')
  || [account.PERSON_FIRST_NAME, account.PERSON_LAST_NAME].filter(Boolean).join(' ')
  || account.USER_USERNAME

const fmtDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  return isNaN(date.getTime())
    ? '—'
    : formatDate(date, { day: '2-digit', month: 'short', year: 'numeric' })
}

// What each sortable column compares. A date sorts by time, not by the label.
const SORT_ACCESSORS = {
  name: (account) => displayName(account),
  roles: (account) => (account.ROLE_CODES || []).join(' '),
  lastSeen: (account) => (account.LAST_SEEN_AT ? new Date(account.LAST_SEEN_AT).getTime() : null),
  state: (account) => (account.IS_ACTIVE === false ? 0 : 1)
}


const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FILTERS = [
  { id: '', label: 'All accounts' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' }
]

const Accounts = ({ user }) => {
  const isManager = !!user && (user.roles?.includes('ADMIN') || user.roles?.includes('DEVELOPER'))

  const [accounts, setAccounts] = useState([])
  // The account roles the server knows, so the editor offers no invented code.
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState(null)
  const [savingId, setSavingId] = useState(null)
  const [confirmTarget, setConfirmTarget] = useState(null)
  // The account being edited and the fields of its editor.
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState({ username: '', email: '', role: '', password: '', confirm: '' })
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  // Accounts arrive in creation order; the header sorts them without a round trip.
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })

  const load = async () => {
    if (!isManager) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await window.api.getAccounts(user?.id)
      setAccounts(res?.accounts || [])
      setRoles(res?.roles || [])
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return accounts.filter((account) => {
      if (filter === 'active' && account.IS_ACTIVE === false) return false
      if (filter === 'inactive' && account.IS_ACTIVE !== false) return false
      if (!term) return true
      return [
        account.USER_USERNAME,
        account.USER_EMAIL,
        displayName(account),
        ...(account.ROLE_CODES || [])
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [accounts, search, filter])

  const rows = useMemo(() => sortRows(filtered, sort, SORT_ACCESSORS), [filtered, sort])

  const activeCount = accounts.filter((account) => account.IS_ACTIVE !== false).length
  const inactiveCount = accounts.length - activeCount

  const setActive = async (account, next) => {
    setSavingId(account.USER_ID)
    try {
      await window.api.setAccountActive(user?.id, account.USER_ID, next)
      setAccounts((prev) =>
        prev.map((row) => (row.USER_ID === account.USER_ID ? { ...row, IS_ACTIVE: next } : row))
      )
      setNotice({
        type: 'success',
        text: next
          ? `${tr('Account activated:')} @${account.USER_USERNAME}`
          : `${tr('Account deactivated:')} @${account.USER_USERNAME}`
      })
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setSavingId(null)
    }
  }

  const openEdit = (account) => {
    setEditTarget(account)
    setEditForm({
      username: account.USER_USERNAME || '',
      email: account.USER_EMAIL || '',
      role: (account.ROLE_CODES || [])[0] || '',
      password: '',
      confirm: ''
    })
    setEditError('')
  }

  const closeEdit = () => {
    if (editSaving) return
    setEditTarget(null)
    setEditError('')
  }

  // A validation message belongs to the value that produced it; correcting any
  // field clears it instead of leaving a stale error under the form.
  const updateEditForm = (patch) => {
    setEditForm((current) => ({ ...current, ...patch }))
    setEditError('')
  }

  // One save for the three fields: the username and email always travel, the
  // password only when one was typed. The service writes them together and
  // re-checks the manager role, so a refused password leaves the account as it
  // was rather than half-edited.
  const submitEdit = async (event) => {
    event.preventDefault()
    if (!editTarget) return

    const username = editForm.username.trim()
    const email = editForm.email.trim()
    const password = editForm.password

    if (!username) return setEditError(tr('Username is required.'))
    if (username.length > 60) {
      return setEditError(tr('Username is too long (max 60 characters).'))
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      return setEditError(tr('Enter a valid email address.'))
    }
    if (password && !isPasswordValid(password)) {
      return setEditError(tr('Use at least 8 characters, including a capital letter, a lowercase letter and a number.'))
    }
    if (password && password !== editForm.confirm) {
      return setEditError(tr('The two passwords do not match.'))
    }
    if (usernameConflict) {
      return setEditError(tr('This username is already used by {name}.', { name: displayName(usernameConflict) }))
    }
    if (emailConflict) {
      return setEditError(tr('This email address is already used by {name}.', { name: displayName(emailConflict) }))
    }

    setEditSaving(true)
    setEditError('')
    try {
      const res = await window.api.updateAccount(user?.id, editTarget.USER_ID, {
        username,
        email,
        roleCode: editForm.role,
        password: password || undefined
      })
      const savedUsername = res?.username || username
      const savedEmail = res?.email ?? (email || null)
      const savedRole = res?.roleCode || null
      setAccounts((prev) =>
        prev.map((row) =>
          row.USER_ID === editTarget.USER_ID
            ? {
                ...row,
                USER_USERNAME: savedUsername,
                USER_EMAIL: savedEmail,
                ROLE_CODES: savedRole ? [savedRole] : []
              }
            : row
        )
      )
      setNotice({ type: 'success', text: `${tr('Account updated:')} @${savedUsername}` })
      setEditTarget(null)
    } catch (err) {
      setEditError(ipcErrorMessage(err))
    } finally {
      setEditSaving(false)
    }
  }

  // Role changes are blocked on your own account: the rule is the same as
  // deactivating yourself, and the editor disables the select to say so.
  const editingSelf = !!editTarget && Number(editTarget.USER_ID) === Number(user?.id)

  // The account list is already in memory, so a duplicate username or email
  // can be refused on the keystroke rather than after the server round trip.
  const usernameConflict = editTarget
    ? accounts.find((account) =>
        Number(account.USER_ID) !== Number(editTarget.USER_ID) &&
        String(account.USER_USERNAME || '').trim().toLowerCase() === editForm.username.trim().toLowerCase()
      )
    : null
  const emailConflict = editTarget && editForm.email.trim()
    ? accounts.find((account) =>
        Number(account.USER_ID) !== Number(editTarget.USER_ID) &&
        String(account.USER_EMAIL || '').trim().toLowerCase() === editForm.email.trim().toLowerCase()
      )
    : null

  // Format and policy errors are shown while typing, next to the field that
  // owns them, rather than only at the bottom after Save is pressed.
  const usernameLengthError = editTarget && editForm.username.trim().length > 60
    ? tr('Username is too long (max 60 characters).')
    : ''
  const emailFormatError = editTarget && editForm.email.trim() && !EMAIL_PATTERN.test(editForm.email.trim())
    ? tr('Enter a valid email address.')
    : ''
  const passwordPolicyError = editTarget && editForm.password && !isPasswordValid(editForm.password)
    ? tr('Use at least 8 characters, including a capital letter, a lowercase letter and a number.')
    : ''
  const passwordMismatchError = editTarget && editForm.password && editForm.confirm && editForm.password !== editForm.confirm
    ? tr('The two passwords do not match.')
    : ''
  const usernameFieldError = usernameConflict
    ? tr('This username is already used by {name}.', { name: displayName(usernameConflict) })
    : usernameLengthError
  const emailFieldError = emailConflict
    ? tr('This email address is already used by {name}.', { name: displayName(emailConflict) })
    : emailFormatError

  if (!isManager) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="max-w-md text-center text-[12px] text-ink-3">
          {tr('Managing accounts requires the Admin or Developer role.')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Administration')}
        title={tr('Accounts')}
        meta={`${activeCount} ${tr('active')} · ${inactiveCount} ${tr('inactive')}`}
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
            aria-label={tr('Search accounts')}
            className="field h-7 ps-6 pe-7 text-[11.5px]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label={tr('Clear search')}
              className="absolute end-1 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-[2px] text-ink-3 hover:bg-surface-muted hover:text-ink"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <FilterBar
          activeCount={(search.trim() ? 1 : 0) + (filter ? 1 : 0)}
          onClear={() => { setSearch(''); setFilter('') }}
          matchCount={filtered.length}
          matchLabel="account"
          title={tr('Filter accounts')}
        >
          <FilterField label={tr('State')}>
            <select
              className={filterInputCls}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label={tr('Filter by state')}
            >
              {FILTERS.map((option) => (
                <option key={option.id || 'all'} value={option.id}>{tr(option.label)}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label={tr('Sort by')}>
            <select
              className={filterInputCls}
              value={sort.key}
              onChange={(event) => setSort((current) => ({ ...current, key: event.target.value }))}
              aria-label={tr('Sort accounts by')}
            >
              <option value="name">{tr('Account')}</option>
              <option value="roles">{tr('Roles')}</option>
              <option value="lastSeen">{tr('Last seen')}</option>
              <option value="state">{tr('State')}</option>
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
        <span className="mono ms-auto text-[10px] text-ink-3">
          {filtered.length}/{accounts.length}
        </span>
      </div>

      {/* Active filters stay on the toolbar trigger, never over the table. */}

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface">
        <DataTable
          className="data-table accounts-table"
          label={tr('Accounts')}
          columns={[
            { key: 'c0', header: <>{tr('Account')}</> },
            { key: 'c1', width: 220, header: <>{tr('Roles')}</> },
            { key: 'c2', width: 130, header: <>{tr('Last seen')}</> },
            { key: 'c3', width: 110, header: <>{tr('State')}</> },
            { key: 'c4', width: 210 },
          ]}
        >
            {loading && accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="!h-20 text-center text-[11.5px] text-ink-3">
                  {tr('Loading accounts…')}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="!h-20 text-center text-[11.5px] text-ink-3">
                  <span className="inline-flex flex-col items-center gap-1.5">
                    <span>
                      {accounts.length === 0
                        ? tr('No account exists yet.')
                        : tr('No account matches this search or filter.')}
                    </span>
                    {accounts.length > 0 && (search.trim() || filter) && (
                      <button
                        type="button"
                        onClick={() => { setSearch(''); setFilter('') }}
                        className="text-[10.5px] font-medium text-jade-600 hover:underline"
                      >
                        {tr('Clear filters')}
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ) : (
              rows.map((account) => {
                const active = account.IS_ACTIVE !== false
                const self = Number(account.USER_ID) === Number(user?.id)
                const saving = savingId === account.USER_ID
                return (
                  <tr key={account.USER_ID} className={active ? undefined : 'opacity-70'}>
                    <td className="max-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate font-medium text-ink">{displayName(account)}</span>
                        {self && (
                          <span className="mono shrink-0 border border-line-strong px-1 text-[9px] uppercase text-ink-3">
                            {tr('You')}
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
                    <td className="mono text-[10.5px] text-ink-3">{fmtDateTime(account.LAST_SEEN_AT)}</td>
                    <td>
                      <span
                        className={`mono inline-flex h-[20px] items-center border px-1.5 text-[9px] uppercase tracking-[0.06em] ${
                          active
                            ? 'border-jade-500/45 text-jade-600'
                            : 'border-line-strong text-ink-3'
                        }`}
                      >
                        {active ? tr('Active') : tr('Inactive')}
                      </span>
                    </td>
                    <td className="!pe-2 text-end">
                      <span className="inline-flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(account)}
                          disabled={editSaving}
                          title={tr('Change the username, email or password of this account')}
                          className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-line-strong bg-surface px-2 text-[10.5px] text-ink-2 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Pencil size={10} /> {tr('Edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => (active ? setConfirmTarget(account) : setActive(account, true))}
                          disabled={saving || self}
                          title={
                            self
                              ? tr('You cannot change the state of your own account.')
                              : active
                                ? tr('Deactivate this account')
                                : tr('Activate this account')
                          }
                          className={`inline-flex h-6 items-center gap-1.5 rounded-[3px] border px-2 text-[10.5px] disabled:cursor-not-allowed disabled:opacity-40 ${
                            active
                              ? 'border-danger/30 bg-danger-bg text-danger-ink hover:brightness-110'
                              : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted'
                          }`}
                        >
                          <Power size={10} />
                          {saving
                            ? tr('Saving…')
                            : active
                              ? tr('Deactivate')
                              : tr('Activate')}
                        </button>
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
        </DataTable>

        <div className="flex items-start gap-2 border-t border-line px-5 py-2.5 text-[10.5px] text-ink-3">
          <AlertCircle size={12} className="mt-px shrink-0" />
          {tr('A deactivated account cannot sign in. Its records, messages and history are kept, and activating it again restores access.')}
        </div>
      </div>

      <Modal
        open={!!editTarget}
        onClose={closeEdit}
        title={tr('Edit account')}
        maxWidth="max-w-[460px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeEdit} disabled={editSaving}>
              {tr('Cancel')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="account-edit-form"
              loading={editSaving}
              disabled={
                !editForm.username.trim() ||
                !!usernameFieldError ||
                !!emailFieldError ||
                !!passwordPolicyError ||
                !!passwordMismatchError
              }
            >
              {tr('Save changes')}
            </Button>
          </div>
        }
      >
        {editTarget && (
          <form id="account-edit-form" onSubmit={submitEdit} className="space-y-3" noValidate>
            <div className="flex items-baseline gap-2 border-b border-line pb-2.5">
              <span className="truncate text-[12.5px] font-semibold text-ink">
                {displayName(editTarget)}
              </span>
              <span className="mono shrink-0 text-[9.5px] text-ink-3">@{editTarget.USER_USERNAME}</span>
            </div>

            <div>
              <label className="field-label" htmlFor="account-edit-username">{tr('Username')}</label>
              <input
                id="account-edit-username"
                type="text"
                value={editForm.username}
                onChange={(event) => updateEditForm({ username: event.target.value })}
                className="field"
                autoComplete="off"
                autoFocus
                aria-invalid={!!usernameFieldError}
                aria-describedby="account-edit-username-help"
              />
              <p
                id="account-edit-username-help"
                role={usernameFieldError ? 'alert' : undefined}
                className={`mt-1 text-[10px] ${usernameFieldError ? '' : 'text-ink-3'}`}
                style={usernameFieldError ? { color: 'var(--color-danger-ink)' } : undefined}
              >
                {usernameFieldError || tr('The handle this account signs in with.')}
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="account-edit-email">{tr('Email')}</label>
              <input
                id="account-edit-email"
                type="email"
                value={editForm.email}
                onChange={(event) => updateEditForm({ email: event.target.value })}
                className="field"
                autoComplete="off"
                aria-invalid={!!emailFieldError}
                aria-describedby={emailFieldError ? 'account-edit-email-help' : undefined}
              />
              {emailFieldError && (
                <p
                  id="account-edit-email-help"
                  role="alert"
                  className="mt-1 text-[10px]"
                  style={{ color: 'var(--color-danger-ink)' }}
                >
                  {emailFieldError}
                </p>
              )}
            </div>

            <div>
              <label className="field-label" htmlFor="account-edit-role">{tr('Account role')}</label>
              <select
                id="account-edit-role"
                value={editForm.role}
                onChange={(event) => updateEditForm({ role: event.target.value })}
                className="field"
                disabled={editingSelf}
              >
                <option value="">{tr('No role')}</option>
                {roles.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-ink-3">
                {editingSelf
                  ? tr('You cannot change the role of your own account.')
                  : tr('The account role decides which pages this account can open.')}
              </p>
            </div>

            <div className="border-t border-line pt-3">
              <div className="flex items-center gap-1.5">
                <KeyRound size={11} className="text-ink-3" />
                <span className="text-[11.5px] font-medium text-ink">{tr('Reset password')}</span>
              </div>
              <p className="mt-1 text-[10px] text-ink-3">
                {tr('Leave both fields empty to keep the current password.')}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="account-edit-password">{tr('New password')}</label>
                  <input
                    id="account-edit-password"
                    type="password"
                    value={editForm.password}
                    onChange={(event) => updateEditForm({ password: event.target.value })}
                    className="field"
                    autoComplete="new-password"
                    aria-invalid={!!passwordPolicyError}
                    aria-describedby={passwordPolicyError ? 'account-edit-password-error' : undefined}
                  />
                  {passwordPolicyError && (
                    <p
                      id="account-edit-password-error"
                      role="alert"
                      className="mt-1 text-[10px] leading-snug"
                      style={{ color: 'var(--color-danger-ink)' }}
                    >
                      {passwordPolicyError}
                    </p>
                  )}
                </div>
                <div>
                  <label className="field-label" htmlFor="account-edit-confirm">{tr('Confirm new password')}</label>
                  <input
                    id="account-edit-confirm"
                    type="password"
                    value={editForm.confirm}
                    onChange={(event) => updateEditForm({ confirm: event.target.value })}
                    className="field"
                    autoComplete="new-password"
                    aria-invalid={!!passwordMismatchError}
                    aria-describedby={passwordMismatchError ? 'account-edit-confirm-error' : undefined}
                  />
                  {passwordMismatchError && (
                    <p
                      id="account-edit-confirm-error"
                      role="alert"
                      className="mt-1 text-[10px] leading-snug"
                      style={{ color: 'var(--color-danger-ink)' }}
                    >
                      {passwordMismatchError}
                    </p>
                  )}
                </div>
              </div>
              <PasswordStrength value={editForm.password} className="mt-2" />
            </div>

            {editingSelf && (
              <p className="text-[10.5px] leading-relaxed text-ink-3">
                {tr('You are editing your own account: sign in with the new details next time.')}
              </p>
            )}

            {editError && (
              <p role="alert" className="text-[10.5px] leading-relaxed text-danger-ink">{editError}</p>
            )}
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmTarget}
        title={tr('Deactivate account')}
        message={`${tr('Deactivate @')}${confirmTarget?.USER_USERNAME}${tr('? They will not be able to sign in until the account is activated again.')}`}
        confirmLabel={tr('Deactivate')}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          const target = confirmTarget
          setConfirmTarget(null)
          if (target) setActive(target, false)
        }}
      />
    </div>
  )
}

export default Accounts
