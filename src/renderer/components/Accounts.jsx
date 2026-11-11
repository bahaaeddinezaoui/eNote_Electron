import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { formatDate } from '../dateFormat'
import DataTable from './ui/DataTable'
import { Search, Power, RefreshCw, AlertCircle, Pencil, KeyRound, X, UserPlus } from 'lucide-react'
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
import { useIdentifierConflicts, conflictMessage } from '../studentIdentifiers'
import { personIdError, personIdValue } from '../../shared/personId'
import { formatLatinFirstName, formatLatinLastName } from '../../shared/personNames'

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

const initialsOf = (person) =>
  [person.PERSON_FIRST_NAME, person.PERSON_LAST_NAME]
    .filter(Boolean)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '?'

// A suggested handle is built from the Latin name only; it is a suggestion the
// administrator can replace, never a value the account is created with.
const suggestUsername = (person) => {
  const slug = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  return [slug(person.PERSON_FIRST_NAME_LA), slug(person.PERSON_LAST_NAME_LA)]
    .filter(Boolean)
    .join('.')
}

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

// The blank registration form behind "New person". The id is typed in, like
// everywhere else (person_id has no sequence default any more).
const EMPTY_NEW_PERSON = {
  PERSON_ID: '',
  PERSON_FIRST_NAME_LA: '',
  PERSON_FIRST_NAME_AR: '',
  PERSON_LAST_NAME_LA: '',
  PERSON_LAST_NAME_AR: '',
  PERSON_BIRTHDATE: '',
  PERSON_SEX: 'M'
}

const FILTERS = [
  { id: '', label: 'All accounts' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' }
]

const Accounts = ({ user }) => {
  const isManager = !!user && (user.roles?.includes('ADMIN') || user.roles?.includes('DEVELOPER'))
  const location = useLocation()
  const navigate = useNavigate()

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
  // The new-account dialog: the person being given an account, the roster
  // search behind the picker, and the form that sets the credentials.
  const [createOpen, setCreateOpen] = useState(false)
  const [personTerm, setPersonTerm] = useState('')
  const [candidates, setCandidates] = useState([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [createForm, setCreateForm] = useState({ role: '', username: '', email: '', password: '', confirm: '' })
  const [createError, setCreateError] = useState('')
  const [createSaving, setCreateSaving] = useState(false)
  const [usernameTouched, setUsernameTouched] = useState(false)
  // Which half of the dialog is open: somebody already on file, or a person
  // being registered now, together with their account.
  const [personMode, setPersonMode] = useState('existing')
  const [newPerson, setNewPerson] = useState({ ...EMPTY_NEW_PERSON })
  // Accounts arrive in creation order; the header sorts them without a round trip.
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' })
  // A person card on the Personnel page navigates here with the record in the
  // router state; the dialog opens on it once the page's roles have loaded.
  const pendingPersonRef = useRef(null)
  const handledPreselectRef = useRef(null)

  // A new person's id is checked while it is typed, against every person in
  // the registry — the same debounced check the Personnel form uses.
  const { conflicts: newPersonIdConflicts, checking: newPersonIdChecking } = useIdentifierConflicts({
    userId: user?.id,
    personId: null,
    values: { PERSON_ID: newPerson.PERSON_ID },
    enabled: createOpen && personMode === 'new'
  })
  const newPersonIdConflict = conflictMessage(newPersonIdConflicts, 'PERSON_ID', tr)

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

  // Opening the dialog starts from a clean sheet; every opening loads the
  // roster again, so somebody registered a moment ago can be given an account.
  useEffect(() => {
    if (!createOpen) return
    const pending = pendingPersonRef.current
    pendingPersonRef.current = null
    setPersonTerm('')
    setSelectedPerson(pending || null)
    setCandidates([])
    setCreateForm({
      role: pending ? ((pending.PERSON_ROLE_CODES || []).find((code) => roles.includes(code)) || '') : '',
      username: pending ? suggestUsername(pending) : '',
      email: '',
      password: '',
      confirm: ''
    })
    setCreateError('')
    setUsernameTouched(false)
    setPersonMode('existing')
    setNewPerson({ ...EMPTY_NEW_PERSON })
  }, [createOpen])

  // The Personnel page hands over the person it wants an account for. The
  // instruction is consumed once, so a reload or a later visit to this page
  // does not reopen the dialog on its own.
  useEffect(() => {
    const target = location.state?.createAccountFor
    if (!target || !isManager || loading) return
    const key = String(target.PERSON_ID)
    if (handledPreselectRef.current === key) return
    handledPreselectRef.current = key
    pendingPersonRef.current = target
    setCreateOpen(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate, isManager, loading])

  // Debounced person lookup: the roster is far too large to filter in the
  // renderer, so the narrowed list is asked for by name, name fragment or id.
  useEffect(() => {
    if (!createOpen) return
    let cancelled = false
    setCandidatesLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.searchAccountCandidates(user?.id, personTerm)
        if (cancelled) return
        setCandidates(res?.people || [])
      } catch (err) {
        if (cancelled) return
        setCandidates([])
        setCreateError(ipcErrorMessage(err))
      } finally {
        if (!cancelled) setCandidatesLoading(false)
      }
    }, personTerm ? 300 : 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [createOpen, personTerm, user?.id])

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

  // ---- New account -------------------------------------------------------
  // Picking a person suggests the role they already hold on their own record:
  // that is the role the account is usually meant to carry.
  const pickPerson = (person) => {
    const preferredRole = (person.PERSON_ROLE_CODES || []).find((code) => roles.includes(code)) || ''
    setSelectedPerson(person)
    setCreateForm((current) => ({
      ...current,
      role: preferredRole,
      username: usernameTouched ? current.username : suggestUsername(person)
    }))
    setCreateError('')
  }

  const openCreate = () => {
    setNotice(null)
    setCreateOpen(true)
  }

  const closeCreate = () => {
    if (createSaving) return
    setCreateOpen(false)
  }

  const updateCreateForm = (patch) => {
    setCreateForm((current) => ({ ...current, ...patch }))
    setCreateError('')
  }

  const creatingNewPerson = personMode === 'new'

  // Switching sides starts the other half clean: a role suggested by an
  // existing person must not be carried onto somebody who does not hold it.
  const choosePersonMode = (mode) => {
    if (mode === personMode) return
    setPersonMode(mode)
    setCreateError('')
    if (mode === 'new') {
      setSelectedPerson(null)
      setCreateForm((current) => ({ ...current, role: '' }))
    }
  }

  const updateNewPerson = (patch) => {
    setNewPerson((current) => ({ ...current, ...patch }))
    setCreateError('')
  }

  const newPersonIdMessage = newPerson.PERSON_ID
    ? (personIdError(newPerson.PERSON_ID) || newPersonIdConflict)
    : ''

  // The account list is already in memory, so a duplicate username or email is
  // refused on the keystroke rather than after the server round trip.
  const createUsernameConflict = createForm.username.trim()
    ? accounts.find((account) =>
        String(account.USER_USERNAME || '').trim().toLowerCase() === createForm.username.trim().toLowerCase()
      )
    : null
  const createEmailConflict = createForm.email.trim()
    ? accounts.find((account) =>
        String(account.USER_EMAIL || '').trim().toLowerCase() === createForm.email.trim().toLowerCase()
      )
    : null
  const createUsernameError = createUsernameConflict
    ? tr('This username is already used by {name}.', { name: displayName(createUsernameConflict) })
    : createForm.username.trim().length > 60
      ? tr('Username is too long (max 60 characters).')
      : ''
  const createEmailError = createEmailConflict
    ? tr('This email address is already used by {name}.', { name: displayName(createEmailConflict) })
    : createForm.email.trim() && !EMAIL_PATTERN.test(createForm.email.trim())
      ? tr('Enter a valid email address.')
      : ''
  const createPasswordError = createForm.password && !isPasswordValid(createForm.password)
    ? tr('Use at least 8 characters, including a capital letter, a lowercase letter and a number.')
    : ''
  const createConfirmError = createForm.password && createForm.confirm && createForm.password !== createForm.confirm
    ? tr('The two passwords do not match.')
    : ''
  const createReady = (creatingNewPerson
    ? !personIdError(newPerson.PERSON_ID)
      && !newPersonIdConflict
      && !!newPerson.PERSON_FIRST_NAME_LA.trim()
      && !!newPerson.PERSON_LAST_NAME_LA.trim()
    : !!selectedPerson)
    && !!createForm.role && !!createForm.username.trim()
    && !!createForm.password && !!createForm.confirm
    && !createUsernameError && !createEmailError && !createPasswordError && !createConfirmError

  const submitCreate = async (event) => {
    event.preventDefault()
    if (!creatingNewPerson && !selectedPerson) return setCreateError(tr('Choose a person'))
    if (!createForm.role) return setCreateError(tr('Choose a role'))
    if (creatingNewPerson) {
      const idProblem = personIdError(newPerson.PERSON_ID)
      if (idProblem) return setCreateError(idProblem)
      if (newPersonIdConflict) return setCreateError(newPersonIdConflict)
      if (!newPerson.PERSON_FIRST_NAME_LA.trim()) return setCreateError(tr('The first name is required.'))
      if (!newPerson.PERSON_LAST_NAME_LA.trim()) return setCreateError(tr('The last name is required.'))
    }

    const username = createForm.username.trim()
    const email = createForm.email.trim()
    const password = createForm.password

    if (!username) return setCreateError(tr('Username is required.'))
    if (username.length > 60) {
      return setCreateError(tr('Username is too long (max 60 characters).'))
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      return setCreateError(tr('Enter a valid email address.'))
    }
    if (!password) return setCreateError(tr('A password is required for a new account.'))
    if (!isPasswordValid(password)) {
      return setCreateError(tr('Use at least 8 characters, including a capital letter, a lowercase letter and a number.'))
    }
    if (password !== createForm.confirm) {
      return setCreateError(tr('The two passwords do not match.'))
    }
    if (createUsernameConflict) {
      return setCreateError(tr('This username is already used by {name}.', { name: displayName(createUsernameConflict) }))
    }
    if (createEmailConflict) {
      return setCreateError(tr('This email address is already used by {name}.', { name: displayName(createEmailConflict) }))
    }

    setCreateSaving(true)
    setCreateError('')
    try {
      const res = creatingNewPerson
        ? await window.api.createPersonWithAccount(user?.id, {
            person: {
              PERSON_ID: personIdValue(newPerson.PERSON_ID),
              PERSON_FIRST_NAME_LA: newPerson.PERSON_FIRST_NAME_LA.trim(),
              PERSON_FIRST_NAME_AR: newPerson.PERSON_FIRST_NAME_AR.trim(),
              PERSON_LAST_NAME_LA: newPerson.PERSON_LAST_NAME_LA.trim(),
              PERSON_LAST_NAME_AR: newPerson.PERSON_LAST_NAME_AR.trim(),
              PERSON_BIRTHDATE: newPerson.PERSON_BIRTHDATE || null,
              PERSON_SEX: newPerson.PERSON_SEX
            },
            roleCode: createForm.role,
            username,
            email,
            password
          })
        : await window.api.createAccount(user?.id, {
            personId: selectedPerson.PERSON_ID,
            roleCode: createForm.role,
            username,
            email,
            password
          })
      setNotice({ type: 'success', text: `${tr('Account created:')} @${res?.username || username}` })
      setCreateOpen(false)
      await load()
    } catch (err) {
      setCreateError(ipcErrorMessage(err))
    } finally {
      setCreateSaving(false)
    }
  }

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2 text-[11px] font-semibold text-on-jade hover:brightness-110"
            >
              <UserPlus size={11} /> {tr('New account')}
            </button>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted disabled:opacity-40"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
            </button>
          </div>
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

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title={tr('Create account')}
        maxWidth="max-w-[540px]"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeCreate} disabled={createSaving}>
              {tr('Cancel')}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="account-create-form"
              loading={createSaving}
              disabled={!createReady}
            >
              {tr('Create account')}
            </Button>
          </div>
        }
      >
        <form id="account-create-form" onSubmit={submitCreate} className="space-y-3" noValidate>
          <p className="text-[11.5px] leading-relaxed text-ink-2">
            {tr('Pick a person already on file or register a new one, choose the account role, then set the sign-in details.')}
          </p>

          <div>
            <span className="field-label">{tr('Person')}</span>
            <div className="mb-1.5 flex gap-1">
              <button
                type="button"
                onClick={() => choosePersonMode('existing')}
                className={`h-6 rounded-[3px] border px-2 text-[10.5px] font-medium ${
                  personMode === 'existing'
                    ? 'border-line-strong bg-selection text-ink'
                    : 'border-line bg-surface text-ink-3 hover:text-ink'
                }`}
              >
                {tr('Existing person')}
              </button>
              <button
                type="button"
                onClick={() => choosePersonMode('new')}
                className={`h-6 rounded-[3px] border px-2 text-[10.5px] font-medium ${
                  personMode === 'new'
                    ? 'border-line-strong bg-selection text-ink'
                    : 'border-line bg-surface text-ink-3 hover:text-ink'
                }`}
              >
                {tr('New person')}
              </button>
            </div>
            {creatingNewPerson ? (
              <div className="rounded-[4px] border border-line bg-canvas p-2.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="account-new-person-id">{tr('Person ID')}</label>
                    <input
                      id="account-new-person-id"
                      type="text"
                      inputMode="numeric"
                      maxLength={12}
                      value={newPerson.PERSON_ID}
                      onChange={(event) => updateNewPerson({ PERSON_ID: event.target.value.replace(/\D/g, '').slice(0, 12) })}
                      placeholder={tr('12 digits')}
                      className="field"
                      autoFocus
                      aria-invalid={!!newPersonIdMessage}
                    />
                    <p
                      className={`mt-1 text-[10px] leading-snug ${newPersonIdMessage ? '' : 'text-ink-3'}`}
                      style={newPersonIdMessage ? { color: 'var(--color-danger-ink)' } : undefined}
                    >
                      {newPersonIdMessage || (newPersonIdChecking
                        ? tr('Checking availability…')
                        : tr('Twelve digits. It can be corrected later, and the change follows the person everywhere.'))}
                    </p>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="account-new-person-birthdate">{tr('Birthdate')}</label>
                    <input
                      id="account-new-person-birthdate"
                      type="date"
                      value={newPerson.PERSON_BIRTHDATE}
                      onChange={(event) => updateNewPerson({ PERSON_BIRTHDATE: event.target.value })}
                      className="field"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="account-new-person-first">{tr('First Name')}</label>
                    <input
                      id="account-new-person-first"
                      type="text"
                      value={newPerson.PERSON_FIRST_NAME_LA}
                      onChange={(event) => updateNewPerson({ PERSON_FIRST_NAME_LA: formatLatinFirstName(event.target.value) })}
                      className="field"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="account-new-person-last">{tr('Last Name')}</label>
                    <input
                      id="account-new-person-last"
                      type="text"
                      value={newPerson.PERSON_LAST_NAME_LA}
                      onChange={(event) => updateNewPerson({ PERSON_LAST_NAME_LA: formatLatinLastName(event.target.value) })}
                      className="field"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="account-new-person-first-ar">{tr('First name (Arabic)')}</label>
                    <input
                      id="account-new-person-first-ar"
                      type="text"
                      dir="rtl"
                      value={newPerson.PERSON_FIRST_NAME_AR}
                      onChange={(event) => updateNewPerson({ PERSON_FIRST_NAME_AR: event.target.value })}
                      className="field"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="account-new-person-last-ar">{tr('Last name (Arabic)')}</label>
                    <input
                      id="account-new-person-last-ar"
                      type="text"
                      dir="rtl"
                      value={newPerson.PERSON_LAST_NAME_AR}
                      onChange={(event) => updateNewPerson({ PERSON_LAST_NAME_AR: event.target.value })}
                      className="field"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="account-new-person-sex">{tr('Sex')}</label>
                    <select
                      id="account-new-person-sex"
                      value={newPerson.PERSON_SEX}
                      onChange={(event) => updateNewPerson({ PERSON_SEX: event.target.value })}
                      className="field"
                    >
                      <option value="M">{tr('Male')}</option>
                      <option value="F">{tr('Female')}</option>
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-snug text-ink-3">
                  {tr('The person is registered and the account is created together; if either fails, neither is saved.')}
                </p>
              </div>
            ) : selectedPerson ? (
              <div className="rounded-[4px] border border-line bg-canvas p-2.5">
                <div className="flex items-center gap-2">
                  <span className="mono grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-muted text-[10.5px] font-semibold text-ink-2">
                    {initialsOf(selectedPerson)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-ink">
                      {displayName(selectedPerson)}
                    </span>
                    <span className="mono block truncate text-[9.5px] text-ink-3">
                      {tr('person #')}{selectedPerson.PERSON_ID}
                      {(selectedPerson.PERSON_ROLE_CODES || []).length > 0
                        ? ` · ${(selectedPerson.PERSON_ROLE_CODES || []).join(', ')}`
                        : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedPerson(null)}
                    className="shrink-0 text-[10.5px] font-medium text-jade-600 hover:underline"
                  >
                    {tr('Change person')}
                  </button>
                </div>
                <p className="mono mt-1.5 text-[9.5px] uppercase tracking-[0.04em] text-ink-3">
                  {selectedPerson.EXISTING_ACCOUNTS > 0
                    ? tr('Existing accounts: {count}', { count: selectedPerson.EXISTING_ACCOUNTS })
                    : tr('No account yet')}
                </p>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    type="text"
                    value={personTerm}
                    onChange={(event) => setPersonTerm(event.target.value)}
                    placeholder={tr('Search a person by name or person ID…')}
                    aria-label={tr('Search a person by name or person ID…')}
                    className="field h-8 ps-6 text-[11.5px]"
                    autoFocus
                  />
                </div>
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-[4px] border border-line">
                  {candidatesLoading ? (
                    <p className="px-3 py-2 text-[11px] text-ink-3">{tr('Searching people…')}</p>
                  ) : candidates.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-ink-3">{tr('No person matches this search.')}</p>
                  ) : (
                    candidates.map((person) => (
                      <button
                        key={person.PERSON_ID}
                        type="button"
                        onClick={() => pickPerson(person)}
                        className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2 text-start last:border-b-0 hover:bg-surface-muted"
                      >
                        <span className="mono grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-muted text-[10.5px] font-semibold text-ink-2">
                          {initialsOf(person)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-medium text-ink">
                            {displayName(person)}
                          </span>
                          <span className="mono mt-0.5 block truncate text-[9.5px] text-ink-3">
                            {tr('person #')}{person.PERSON_ID}
                            {(person.PERSON_ROLE_CODES || []).length > 0
                              ? ` · ${(person.PERSON_ROLE_CODES || []).join(', ')}`
                              : ''}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {(selectedPerson || creatingNewPerson) && (
            <>
              <div>
                <label className="field-label" htmlFor="account-create-role">{tr('Account role')}</label>
                <select
                  id="account-create-role"
                  value={createForm.role}
                  onChange={(event) => updateCreateForm({ role: event.target.value })}
                  className="field"
                >
                  <option value="">{tr('Choose a role')}</option>
                  {roles.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] leading-snug text-ink-3">
                  {tr('The account role decides which pages this account can open.')}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-ink-3">
                  {tr('The account role is also recorded on the person’s file, so the roster and the account agree.')}
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="account-create-username">{tr('Username')}</label>
                <input
                  id="account-create-username"
                  type="text"
                  value={createForm.username}
                  onChange={(event) => { setUsernameTouched(true); updateCreateForm({ username: event.target.value }) }}
                  className="field"
                  autoComplete="off"
                  aria-invalid={!!createUsernameError}
                />
                {createUsernameError ? (
                  <p role="alert" className="mt-1 text-[10px]" style={{ color: 'var(--color-danger-ink)' }}>
                    {createUsernameError}
                  </p>
                ) : (
                  <p className="mt-1 text-[10px] text-ink-3">{tr('The handle this account signs in with.')}</p>
                )}
              </div>

              <div>
                <label className="field-label" htmlFor="account-create-email">{tr('Email')}</label>
                <input
                  id="account-create-email"
                  type="email"
                  value={createForm.email}
                  onChange={(event) => updateCreateForm({ email: event.target.value })}
                  className="field"
                  autoComplete="off"
                  aria-invalid={!!createEmailError}
                />
                {createEmailError && (
                  <p role="alert" className="mt-1 text-[10px]" style={{ color: 'var(--color-danger-ink)' }}>
                    {createEmailError}
                  </p>
                )}
              </div>

              <div className="border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <KeyRound size={11} className="text-ink-3" />
                  <span className="text-[11.5px] font-medium text-ink">{tr('Sign-in password')}</span>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="account-create-password">{tr('New password')}</label>
                    <input
                      id="account-create-password"
                      type="password"
                      value={createForm.password}
                      onChange={(event) => updateCreateForm({ password: event.target.value })}
                      className="field"
                      autoComplete="new-password"
                      aria-invalid={!!createPasswordError}
                    />
                    {createPasswordError && (
                      <p role="alert" className="mt-1 text-[10px] leading-snug" style={{ color: 'var(--color-danger-ink)' }}>
                        {createPasswordError}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="field-label" htmlFor="account-create-confirm">{tr('Confirm new password')}</label>
                    <input
                      id="account-create-confirm"
                      type="password"
                      value={createForm.confirm}
                      onChange={(event) => updateCreateForm({ confirm: event.target.value })}
                      className="field"
                      autoComplete="new-password"
                      aria-invalid={!!createConfirmError}
                    />
                    {createConfirmError && (
                      <p role="alert" className="mt-1 text-[10px] leading-snug" style={{ color: 'var(--color-danger-ink)' }}>
                        {createConfirmError}
                      </p>
                    )}
                  </div>
                </div>
                <PasswordStrength value={createForm.password} className="mt-2" />
              </div>
            </>
          )}

          {createError && (
            <p role="alert" className="text-[10.5px] leading-relaxed text-danger-ink">{createError}</p>
          )}
        </form>
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
