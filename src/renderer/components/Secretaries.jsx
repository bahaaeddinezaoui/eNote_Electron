import React, { useEffect, useMemo, useState } from 'react'
import { Search, UserCog, Save, AlertCircle, Check, ShieldCheck, Power } from 'lucide-react'
import { PageHeader } from './ui/PageHeader'
import SplitPane from './ui/SplitPane'
import Notice from './ui/Notice'
import { tr } from '../i18n'
import { ipcErrorMessage } from '../ipcError'

// Secretary accounts (Admin only). One screen for everything that hangs off a
// secretary account:
//   - the account itself (username, email, active),
//   - the teaching categories it may work in (user_teaching_category_scope),
//   - its rights over the conduct ledger (secretary_detail).
// Categories and rights save the moment they are toggled; the account fields
// save with the button, so a half-typed username never becomes the login.
//
// Every call is re-checked server-side for the Admin role and for the target
// being a secretary, so this page is a convenience, not the gate.

// One right per action: adding a new entry, changing one that is already on the
// record, and removing one are separate, for punishments and for rewards.
const PERMISSION_ROWS = [
  {
    key: 'canAddPunishments',
    label: 'Add punishments',
    hint: 'Add a punishment to a student in their categories.'
  },
  {
    key: 'canEditPunishments',
    label: 'Edit punishments',
    hint: 'Change a punishment already on a student record.'
  },
  {
    key: 'canDeletePunishments',
    label: 'Delete punishments',
    hint: 'Remove a punishment already on a student record.'
  },
  {
    key: 'canAddRewards',
    label: 'Add rewards',
    hint: 'Add a reward to a student in their categories.'
  },
  {
    key: 'canEditRewards',
    label: 'Edit rewards',
    hint: 'Change a reward already on a student record.'
  },
  {
    key: 'canDeleteRewards',
    label: 'Delete rewards',
    hint: 'Remove a reward already on a student record.'
  }
]

// canEditPunishments -> CAN_EDIT_PUNISHMENTS (the column the service returns)
const columnFor = (key) => key.replace(/([A-Z])/g, '_$1').toUpperCase()

const displayName = (account) =>
  [account.PERSON_FIRST_NAME_LA, account.PERSON_LAST_NAME_LA].filter(Boolean).join(' ')
  || account.USER_USERNAME

// An account may carry both roles; the categories are shared, while the conduct
// rights only ever apply to the secretary side.
const ROLE_LABELS = { SECRETARY: 'Secretary', SCHEDULER: 'Scheduler' }
const accountRoleCodes = (account) => account?.ROLE_CODES || []
const accountRoles = (account) => accountRoleCodes(account).map((code) => tr(ROLE_LABELS[code] || code)).join(' · ')
const isSecretaryAccount = (account) => accountRoleCodes(account).includes('SECRETARY')
const isSchedulerAccount = (account) => accountRoleCodes(account).includes('SCHEDULER')

const Switch = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      checked ? 'border-transparent' : 'border-line-strong bg-surface-muted'
    }`}
    style={checked ? { background: 'var(--color-jade-solid)' } : undefined}
  >
    <span
      className={`absolute top-1/2 block h-[12px] w-[12px] -translate-y-1/2 rounded-full transition-[left] ${
        checked ? 'start-[17px]' : 'start-[2px]'
      }`}
      style={{ background: checked ? 'var(--color-on-jade)' : 'var(--color-ink-3)' }}
    />
  </button>
)

const Secretaries = ({ user }) => {
  const isAdmin = user?.roles?.includes('ADMIN')

  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [notice, setNotice] = useState(null)

  // Account fields, held apart from the roster so typing is not overwritten by
  // a refresh and the Save button knows whether anything changed.
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [savingActive, setSavingActive] = useState(false)
  const [savingFlags, setSavingFlags] = useState(false)
  const [savingCategory, setSavingCategory] = useState(null)
  const [savingDepartment, setSavingDepartment] = useState(null)

  const load = async (keepId = null) => {
    if (!isAdmin) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await window.api.getSecretaries(user?.id)
      const list = res?.accounts || []
      setAccounts(list)
      setCategories(res?.categories || [])
      setDepartments(res?.departments || [])
      const next = keepId && list.some(a => a.USER_ID === keepId)
        ? keepId
        : list[0]?.USER_ID || null
      setSelectedId(next)
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = useMemo(
    () => accounts.find(a => a.USER_ID === selectedId) || null,
    [accounts, selectedId]
  )

  // Seed the form whenever a different account is opened.
  useEffect(() => {
    setUsername(selected?.USER_USERNAME || '')
    setEmail(selected?.USER_EMAIL || '')
  }, [selectedId, selected?.USER_USERNAME, selected?.USER_EMAIL])

  // The roster is already in memory: a username or email held by another
  // account is refused on the keystroke, before Save reaches the server.
  const usernameConflict = selected
    ? accounts.find((account) =>
        Number(account.USER_ID) !== Number(selected.USER_ID) &&
        String(account.USER_USERNAME || '').trim().toLowerCase() === username.trim().toLowerCase()
      )
    : null
  const emailConflict = selected && email.trim()
    ? accounts.find((account) =>
        Number(account.USER_ID) !== Number(selected.USER_ID) &&
        String(account.USER_EMAIL || '').trim().toLowerCase() === email.trim().toLowerCase()
      )
    : null

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return accounts
    return accounts.filter(a =>
      [a.USER_USERNAME, a.USER_EMAIL, displayName(a)]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(term))
    )
  }, [accounts, search])

  const patchAccount = (userId, patch) => {
    setAccounts(prev => prev.map(a => (a.USER_ID === userId ? { ...a, ...patch } : a)))
  }

  const saveAccount = async () => {
    if (!selected) return
    if (usernameConflict) {
      setNotice({ type: 'error', text: tr('This username is already used by {name}.', { name: displayName(usernameConflict) }) })
      return
    }
    if (emailConflict) {
      setNotice({ type: 'error', text: tr('This email address is already used by {name}.', { name: displayName(emailConflict) }) })
      return
    }
    setSavingAccount(true)
    try {
      await window.api.updateSecretaryAccount(user?.id, selected.USER_ID, { username, email })
      await load(selected.USER_ID)
      setNotice({ type: 'success', text: tr('Account saved.') })
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setSavingAccount(false)
    }
  }

  // Activation is a switch, not a field: it saves on its own so the account
  // state never sits half-applied behind a second button.
  const toggleActive = async (next) => {
    if (!selected) return
    setSavingActive(true)
    try {
      await window.api.updateSecretaryAccount(user?.id, selected.USER_ID, { isActive: next })
      patchAccount(selected.USER_ID, { IS_ACTIVE: next })
      setNotice({ type: 'success', text: next ? tr('Account activated.') : tr('Account deactivated.') })
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setSavingActive(false)
    }
  }

  const toggleCategory = async (categoryId) => {
    if (!selected) return
    const current = (selected.CATEGORY_IDS || []).map(Number)
    const next = current.includes(Number(categoryId))
      ? current.filter(id => id !== Number(categoryId))
      : [...current, Number(categoryId)]
    setSavingCategory(categoryId)
    try {
      await window.api.setAccountCategories(user?.id, selected.USER_ID, next)
      patchAccount(selected.USER_ID, { CATEGORY_IDS: next })
      setNotice({
        type: 'success',
        text: next.length === 0
          ? tr('This account can no longer edit any student or schedule any session.')
          : `${tr('Categories saved.')} ${next.length}/${categories.length}`
      })
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setSavingCategory(null)
    }
  }

  const toggleDepartment = async (departmentId) => {
    if (!selected) return
    const current = (selected.DEPARTMENT_IDS || []).map(Number)
    const next = current.includes(Number(departmentId))
      ? current.filter(id => id !== Number(departmentId))
      : [...current, Number(departmentId)]
    setSavingDepartment(departmentId)
    try {
      await window.api.setAccountDepartments(user?.id, selected.USER_ID, next)
      patchAccount(selected.USER_ID, { DEPARTMENT_IDS: next })
      setNotice({
        type: 'success',
        text: next.length === 0
          ? tr('This scheduler can no longer schedule any session.')
          : `${tr('Departments saved.')} ${next.length}/${departments.length}`
      })
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setSavingDepartment(null)
    }
  }

  const togglePermission = async (key) => {
    if (!selected) return
    const next = {}
    const patched = {}
    for (const row of PERMISSION_ROWS) {
      const value = row.key === key ? selected[columnFor(row.key)] !== true : selected[columnFor(row.key)] === true
      next[row.key] = value
      patched[columnFor(row.key)] = value
    }
    setSavingFlags(true)
    try {
      await window.api.setSecretaryPermissions(user?.id, selected.USER_ID, next)
      patchAccount(selected.USER_ID, patched)
      const row = PERMISSION_ROWS.find(r => r.key === key)
      setNotice({
        type: 'success',
        text: `${tr(row?.label || 'Right')}: ${next[key] ? tr('granted') : tr('withdrawn')}`
      })
    } catch (err) {
      setNotice({ type: 'error', text: ipcErrorMessage(err) })
    } finally {
      setSavingFlags(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="max-w-md text-center text-[12px] text-ink-3">
          {tr('Managing secretary accounts requires the Admin role.')}
        </p>
      </div>
    )
  }

  const grantedCount = (account) =>
    PERMISSION_ROWS.filter(({ key }) => account[columnFor(key)] === true).length

  const assignedCategories = selected ? (selected.CATEGORY_IDS || []).map(Number) : []
  const assignedDepartments = selected ? (selected.DEPARTMENT_IDS || []).map(Number) : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Administration')}
        title={tr('Secretary & scheduler accounts')}
        meta={`${accounts.length} ${accounts.length === 1 ? tr('account') : tr('accounts')}`}
        actions={
          <span className="mono hidden text-[10px] text-ink-3 md:inline">
            {tr('Categories · conduct rights')}
          </span>
        }
      />

      <SplitPane
        side="start"
        storageKey="enote-secretaries-split"
        initial={300}
        min={260}
        max={430}
        asideLabel={tr('Secretaries')}
        aside={
          <>
            <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-3.5">
              <span className="kicker">{tr('Accounts')}</span>
              <span className="mono text-[10px] text-ink-3">{filtered.length}</span>
            </div>
            <div className="shrink-0 border-b border-line p-2">
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tr('Name, username or email')}
                  aria-label={tr('Search accounts')}
                  className="field h-7 ps-6 text-[11.5px]"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="space-y-2 p-3" role="status" aria-label={tr('Loading secretaries')}>
                  {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="h-9 rounded-sm bg-surface-muted" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[11.5px] text-ink-3">
                  {accounts.length === 0
                    ? tr('No account carries the Secretary or Scheduler role yet.')
                    : tr('No account matches this search.')}
                </p>
              ) : (
                filtered.map((account) => {
                  const on = account.USER_ID === selectedId
                  const cats = (account.CATEGORY_IDS || []).length
                  const depts = (account.DEPARTMENT_IDS || []).length
                  const scheduler = isSchedulerAccount(account)
                  return (
                    <button
                      key={account.USER_ID}
                      type="button"
                      onClick={() => setSelectedId(account.USER_ID)}
                      aria-current={on ? 'true' : undefined}
                      className={`flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-start ${
                        on ? 'bg-selection' : 'hover:bg-surface-muted'
                      }`}
                      style={on ? { boxShadow: 'inset 2px 0 0 var(--color-jade-500)' } : undefined}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[3px] border border-line-strong bg-surface text-[9.5px] font-semibold text-ink-2">
                        {`${account.PERSON_FIRST_NAME_LA?.[0] || ''}${account.PERSON_LAST_NAME_LA?.[0] || ''}`.toUpperCase() || '?'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-ink">{displayName(account)}</span>
                        <span className="mono block truncate text-[9.5px] text-ink-3">
                          {accountRoles(account)} · @{account.USER_USERNAME} · {cats} {cats === 1 ? tr('category') : tr('categories')}
                          {scheduler && ` · ${depts} ${depts === 1 ? tr('department') : tr('departments')}`}
                        </span>
                      </span>
                      {account.IS_ACTIVE === false && (
                        <span className="mono shrink-0 border border-line-strong px-1 text-[9px] uppercase text-ink-3">
                          {tr('Off')}
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
            <div className="shrink-0 border-t border-line px-3.5 py-2 text-[10px] text-ink-3">
              {tr('Admin accounts are never limited by these settings.')}
            </div>
          </>
        }
      >
        {!selected ? (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-line px-4">
              <span className="kicker">{tr('Account')}</span>
              <span className="mono text-[10px] text-ink-3">{tr('NO SELECTION')}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
              <h2 className="serif max-w-[420px] text-[27px] leading-tight text-ink">
                {tr('Select an account to manage it.')}
              </h2>
              <p className="mt-2 max-w-[440px] text-[11.5px] leading-relaxed text-ink-3">
                {tr('Give an account its teaching categories, and set whether a secretary may record or delete punishments and rewards.')}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-surface">
            <div className="flex h-[64px] shrink-0 items-center gap-3 border-b border-line px-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="serif truncate text-[22px] leading-none text-ink">{displayName(selected)}</h2>
                  <span className="mono shrink-0 text-[10px] text-ink-3">№ {String(selected.PERSON_ID || 0).padStart(4, '0')}</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10.5px] text-ink-3">
                  <span>@{selected.USER_USERNAME}</span>
                  <span>{selected.PUNISHMENT_COUNT || 0} {tr('punishments')}</span>
                  <span>{selected.REWARD_COUNT || 0} {tr('rewards')}</span>
                </div>
              </div>
              <span className={`ms-auto mono shrink-0 border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] ${
                selected.IS_ACTIVE === false
                  ? 'border-line-strong text-ink-3'
                  : 'border-jade-500/45 text-jade-600'
              }`}>
                {selected.IS_ACTIVE === false ? tr('Inactive') : tr('Active')}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Account */}
              <section aria-labelledby="secretary-account">
                <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-muted px-4">
                  <span id="secretary-account" className="kicker text-[9.5px]">{tr('Account')}</span>
                  <span className="mono text-[10px] text-ink-3">{tr('SIGN-IN')}</span>
                </div>
                <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label className="field-label" htmlFor="secretary-username">{tr('Username')}</label>
                    <input
                      id="secretary-username"
                      type="text"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="field"
                      autoComplete="off"
                      aria-invalid={!!usernameConflict}
                      aria-describedby={usernameConflict ? 'secretary-username-help' : undefined}
                    />
                    {usernameConflict && (
                      <p id="secretary-username-help" role="alert" className="mt-1 text-[10px]" style={{ color: 'var(--color-danger-ink)' }}>
                        {tr('This username is already used by {name}.', { name: displayName(usernameConflict) })}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="secretary-email">{tr('Email')}</label>
                    <input
                      id="secretary-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="field"
                      autoComplete="off"
                      aria-invalid={!!emailConflict}
                      aria-describedby={emailConflict ? 'secretary-email-help' : undefined}
                    />
                    {emailConflict && (
                      <p id="secretary-email-help" role="alert" className="mt-1 text-[10px]" style={{ color: 'var(--color-danger-ink)' }}>
                        {tr('This email address is already used by {name}.', { name: displayName(emailConflict) })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={saveAccount}
                      disabled={savingAccount || !username.trim() || !email.trim() || !!usernameConflict || !!emailConflict}
                      className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-semibold text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 md:w-auto"
                    >
                      <Save size={12} /> {savingAccount ? tr('Saving…') : tr('Save account')}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
                  <Power size={12} className="shrink-0 text-ink-3" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-medium text-ink">{tr('Account is active')}</div>
                    <div className="text-[10.5px] text-ink-3">
                      {tr('An inactive account cannot sign in; its records are kept.')}
                    </div>
                  </div>
                  <Switch
                    checked={selected.IS_ACTIVE !== false}
                    onChange={toggleActive}
                    disabled={savingActive}
                    label={tr('Account is active')}
                  />
                </div>
              </section>

              {/* Editable categories */}
              <section aria-labelledby="secretary-categories" className="border-t border-line">
                <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-muted px-4">
                  <span id="secretary-categories" className="kicker text-[9.5px]">{tr('Teaching categories')}</span>
                  <span className="mono text-[10px] text-ink-3">
                    {assignedCategories.length}/{categories.length}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[11px] leading-relaxed text-ink-3">
                    {tr('A secretary can only register, edit or delete students who sit in one of these categories. A scheduler can only schedule sessions and create teaching groups in them. Saving applies on that account’s next action.')}
                  </p>
                  {categories.length === 0 ? (
                    <p className="mt-3 text-[11.5px] text-ink-3">{tr('No teaching categories exist yet.')}</p>
                  ) : (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {categories.map((category) => {
                        const on = assignedCategories.includes(Number(category.TEACHING_CATEGORY_ID))
                        const saving = savingCategory === category.TEACHING_CATEGORY_ID
                        return (
                          <button
                            key={category.TEACHING_CATEGORY_ID}
                            type="button"
                            onClick={() => toggleCategory(category.TEACHING_CATEGORY_ID)}
                            disabled={saving}
                            aria-pressed={on}
                            title={`${category.SECTION_COUNT} ${tr('sections')}`}
                            className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              on
                                ? 'border-transparent text-on-jade'
                                : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted'
                            }`}
                            style={on ? { background: 'var(--color-jade-solid)' } : undefined}
                          >
                            {on && <Check size={11} />}
                            {category.TEACHING_CATEGORY_LABEL}
                            <span className={`mono ${on ? 'opacity-70' : 'text-ink-3'}`}>
                              {category.SECTION_COUNT}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {assignedCategories.length === 0 && categories.length > 0 && (
                    <div className="mt-2.5 flex items-start gap-2 border border-danger/30 bg-danger-bg px-2.5 py-1.5 text-[10.5px] text-danger-ink">
                      <AlertCircle size={11} className="mt-px shrink-0" />
                      {tr('With no category this account cannot add or edit any student, and cannot schedule sessions.')}
                    </div>
                  )}
                </div>
              </section>

              {/* Scheduler departments. A scheduler's reach is the intersection
                  of these departments and the teaching categories above. */}
              {isSchedulerAccount(selected) && (
              <section aria-labelledby="scheduler-departments" className="border-t border-line">
                <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-muted px-4">
                  <span id="scheduler-departments" className="kicker text-[9.5px]">{tr('Departments')}</span>
                  <span className="mono text-[10px] text-ink-3">
                    {assignedDepartments.length}/{departments.length}
                  </span>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[11px] leading-relaxed text-ink-3">
                    {tr('A scheduler can only schedule sessions in a teaching group whose teaching category and whose major’s major category both fall inside their scope.')}
                  </p>
                  {departments.length === 0 ? (
                    <p className="mt-3 text-[11.5px] text-ink-3">{tr('No departments exist yet. Create one under Settings → Registers → Departments.')}</p>
                  ) : (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {departments.map((department) => {
                        const on = assignedDepartments.includes(Number(department.DEPARTMENT_ID))
                        const saving = savingDepartment === department.DEPARTMENT_ID
                        return (
                          <button
                            key={department.DEPARTMENT_ID}
                            type="button"
                            onClick={() => toggleDepartment(department.DEPARTMENT_ID)}
                            disabled={saving}
                            aria-pressed={on}
                            title={department.MAJOR_CATEGORY_LABEL || tr('No major category')}
                            className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              on
                                ? 'border-transparent text-on-jade'
                                : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted'
                            }`}
                            style={on ? { background: 'var(--color-jade-solid)' } : undefined}
                          >
                            {on && <Check size={11} />}
                            {department.DEPARTMENT_LABEL}
                            {department.MAJOR_CATEGORY_LABEL && (
                              <span className={`mono ${on ? 'opacity-70' : 'text-ink-3'}`}>
                                {department.MAJOR_CATEGORY_LABEL}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {assignedDepartments.length === 0 && departments.length > 0 && (
                    <div className="mt-2.5 flex items-start gap-2 border border-danger/30 bg-danger-bg px-2.5 py-1.5 text-[10.5px] text-danger-ink">
                      <AlertCircle size={11} className="mt-px shrink-0" />
                      {tr('With no department this scheduler cannot schedule any session.')}
                    </div>
                  )}
                </div>
              </section>
              )}

              {/* Conduct rights */}
              {isSecretaryAccount(selected) ? (
              <section aria-labelledby="secretary-rights" className="border-t border-line">
                <div className="flex h-9 items-center gap-2 border-b border-line bg-surface-muted px-4">
                  <span id="secretary-rights" className="kicker text-[9.5px]">{tr('Conduct rights')}</span>
                  <span className="mono text-[10px] text-ink-3">{grantedCount(selected)}/{PERMISSION_ROWS.length}</span>
                </div>
                <div>
                  {PERMISSION_ROWS.map(({ key, label, hint }) => {
                    const checked = selected[columnFor(key)] === true
                    return (
                      <div key={key} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                        <ShieldCheck size={13} className="shrink-0 text-ink-3" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11.5px] font-medium text-ink">{tr(label)}</div>
                          <div className="text-[10.5px] text-ink-3">{tr(hint)}</div>
                        </div>
                        <Switch
                          checked={checked}
                          onChange={() => togglePermission(key)}
                          disabled={savingFlags}
                          label={tr(label)}
                        />
                      </div>
                    )
                  })}
                </div>
                <p className="border-t border-line px-4 py-2 text-[10.5px] text-ink-3">
                  {tr('Rights are per action: an account may record a punishment without being able to delete one.')}
                </p>
              </section>
              ) : (
                <p className="border-t border-line px-4 py-3 text-[10.5px] text-ink-3">
                  {tr('Conduct rights apply to secretary accounts only.')}
                </p>
              )}

              <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[10.5px] text-ink-3">
                <UserCog size={12} />
                {tr('Names, birth dates and photos belong to the person record and are edited on the People page.')}
              </div>
            </div>
          </div>
        )}
      </SplitPane>
    </div>
  )
}

export default Secretaries
