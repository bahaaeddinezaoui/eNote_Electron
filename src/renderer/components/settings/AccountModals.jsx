import React, { useEffect, useState } from 'react'
import { AlertCircle, Check, Lock, Save, Search } from 'lucide-react'
import { tr } from '../../i18n'
import Modal from '../ui/Modal'
import PasswordStrength from '../ui/PasswordStrength'
import { isPasswordValid } from '../../../shared/passwordPolicy'

const secondaryButton =
  'inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink'
const primaryButton =
  'inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
const dangerButton =
  'inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-danger-solid px-2.5 text-[11px] font-semibold text-[var(--color-canvas)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40'
const fieldError = { color: 'var(--color-danger-ink)' }

function UsernameModal({ open, onClose, user, savedUsername, onUsernameSaved, onMessage }) {
  const [draft, setDraft] = useState(savedUsername)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(savedUsername)
    setError('')
    setSaved(false)
  }, [open, savedUsername])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSaved(false)
    const next = draft.trim()
    if (!next) {
      setError(tr('Username is required.'))
      return
    }
    if (next.length > 60) {
      setError(tr('Username is too long (max 60 characters).'))
      return
    }
    if (next === savedUsername) return
    setSaving(true)
    try {
      await window.api.updateMyUsername(user?.id, next)
      onUsernameSaved(next)
      setSaved(true)
      onMessage(`Your username is now @${next}. Use it the next time you sign in.`)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      console.error('Failed to change own username', err)
      setError(err.message || tr('Could not change your username.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr('Your username')}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            {tr('Close')}
          </button>
          <button
            type="submit"
            form="settings-username"
            disabled={saving || !draft.trim() || draft.trim() === savedUsername}
            className={primaryButton}
          >
            {saved ? <Check size={11} /> : <Save size={11} />}
            {saving ? tr('Saving…') : saved ? tr('Username saved') : tr('Save username')}
          </button>
        </div>
      }
    >
      <p className="text-[12px] leading-relaxed text-ink-2">
        {tr('The name you sign in with. It must be unique; the change is saved immediately and the new username is the one to use from the next sign-in.')}
      </p>
      <form id="settings-username" onSubmit={submit} className="mt-3 space-y-2">
        <label className="kicker block text-[9px]">{tr('Username')}</label>
        <input
          type="text"
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(''); setSaved(false) }}
          maxLength={60}
          autoComplete="username"
          placeholder={tr('Your username')}
          className="field h-8 w-full text-[12px]"
        />
        {error && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium" style={fieldError}>
            <AlertCircle size={12} /> {error}
          </div>
        )}
        <p className="text-[10.5px] text-ink-3">
          {tr('Your display name in the roster and messages does not change with it.')}
        </p>
      </form>
    </Modal>
  )
}

function OwnPasswordModal({ open, onClose, user, onMessage }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    setCurrent('')
    setNext('')
    setConfirm('')
    setError('')
    setSaved(false)
  }, [open])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSaved(false)
    if (!isPasswordValid(next)) {
      setError(tr('Use at least 8 characters, including a capital letter, a lowercase letter and a number.'))
      return
    }
    if (next !== confirm) {
      setError(tr('The new passwords do not match.'))
      return
    }
    if (next === current) {
      setError(tr('The new password must be different from the current one.'))
      return
    }
    setSaving(true)
    try {
      await window.api.changeMyPassword(user?.id, current, next)
      setSaved(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      onMessage(tr('Your password has been changed.'))
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      console.error('Failed to change own password', err)
      setError(err.message || tr('Could not change your password.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr('Your password')}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            {tr('Close')}
          </button>
          <button
            type="submit"
            form="settings-own-password"
            disabled={saving || !current || !next || !confirm}
            className={primaryButton}
          >
            <Lock size={11} />
            {saving ? tr('Updating…') : saved ? tr('Password changed') : tr('Change password')}
          </button>
        </div>
      }
    >
      <p className="text-[12px] leading-relaxed text-ink-2">
        {tr('Change the password of your own account. Enter your current password to confirm the change; the new one takes effect immediately.')}
      </p>
      <form id="settings-own-password" onSubmit={submit} className="mt-3 space-y-2">
        <div>
          <label className="kicker mb-1 block text-[9px]">{tr('Current password')}</label>
          <input
            type="password"
            value={current}
            onChange={e => { setCurrent(e.target.value); setError(''); setSaved(false) }}
            autoComplete="current-password"
            placeholder={tr('Your current password')}
            className="field h-8 w-full text-[12px]"
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className="kicker mb-1 block text-[9px]">{tr('New password')}</label>
            <input
              type="password"
              value={next}
              onChange={e => { setNext(e.target.value); setError(''); setSaved(false) }}
              autoComplete="new-password"
              placeholder={tr('At least 8 characters')}
              className="field h-8 w-full text-[12px]"
            />
          </div>
          <div>
            <label className="kicker mb-1 block text-[9px]">{tr('Confirm new password')}</label>
            <input
              type="password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(''); setSaved(false) }}
              autoComplete="new-password"
              placeholder={tr('Repeat the new password')}
              className="field h-8 w-full text-[12px]"
            />
          </div>
        </div>
        <PasswordStrength value={next} />
        {error && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium" style={fieldError}>
            <AlertCircle size={12} /> {error}
          </div>
        )}
        <p className="text-[10.5px] text-ink-3">{tr('Only the password changes — your username is its own setting.')}</p>
      </form>
    </Modal>
  )
}

function UserPasswordModal({ open, onClose, user, onMessage }) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [selected, setSelected] = useState(null)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Start from a clean sheet each time the dialog opens.
  useEffect(() => {
    if (!open) return
    setTerm('')
    setResults([])
    setSearched(false)
    setSelected(null)
    setNext('')
    setConfirm('')
    setError('')
  }, [open])

  // Debounced account lookup, so typing a name does not query on every key.
  useEffect(() => {
    if (!open) return
    const value = term.trim()
    if (!value) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.searchUsersForPasswordReset(user?.id, value)
        setResults(res?.users || [])
        setSearched(true)
        setError('')
      } catch (err) {
        console.error('Failed to search users', err)
        setResults([])
        setError(err.message || tr('Could not search user accounts.'))
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [term, open, user?.id])

  const pick = (account) => {
    setSelected(account)
    setNext('')
    setConfirm('')
    setError('')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!selected) return
    if (!isPasswordValid(next)) {
      setError(tr('Use at least 8 characters, including a capital letter, a lowercase letter and a number.'))
      return
    }
    if (next !== confirm) {
      setError(tr('The two passwords do not match.'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await window.api.resetUserPassword(user?.id, selected.USER_ID, next)
      const username = res?.username || selected.USER_USERNAME
      onMessage(`Password updated for ${res?.name || username} (@${username}).`)
      setSelected(null)
      setNext('')
      setConfirm('')
      setTerm('')
      setResults([])
    } catch (err) {
      console.error('Failed to reset password', err)
      setError(err.message || tr('Could not update the password.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr('User passwords')}
      maxWidth="max-w-[600px]"
      footer={
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={secondaryButton}>
            {tr('Close')}
          </button>
        </div>
      }
    >
      <p className="text-[12px] leading-relaxed text-ink-2">
        {tr('Find an account by username, first name, last name or person ID, then set a new password for it. The current password is not needed — this is an administrator reset.')}
      </p>

      <div className="relative mt-3">
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
        <input
          type="text"
          value={term}
          onChange={e => { setTerm(e.target.value); setSelected(null); setError('') }}
          placeholder={tr('Username, first name, last name, or person ID…')}
          aria-label={tr('Search an account to reset the password for')}
          className="field h-7 w-full ps-7 text-[11.5px]"
        />
      </div>

      {loading ? (
        <div className="mt-3 text-[11.5px] text-ink-3">{tr('Searching accounts…')}</div>
      ) : searched && results.length === 0 ? (
        <div className="mt-3 text-[11.5px] text-ink-3">
          {tr('No account matches “')}{term.trim()}{tr('”. Try the exact username, a name, or a person ID.')}
        </div>
      ) : results.length > 0 ? (
        <div className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-[4px] border border-line">
          {results.map(account => {
            const name = [account.PERSON_FIRST_NAME, account.PERSON_LAST_NAME].filter(Boolean).join(' ')
              || account.USER_USERNAME
            const initials = name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
            const roles = String(account.ROLE_CODES || '').split(',').map(r => r.trim()).filter(Boolean)
            const isSelected = selected?.USER_ID === account.USER_ID
            return (
              <button
                key={account.USER_ID}
                type="button"
                onClick={() => pick(account)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-start ${isSelected ? 'bg-selection' : 'hover:bg-surface-muted'}`}
              >
                <span className="mono grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-muted text-[11px] font-semibold text-ink-2">
                  {initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] font-medium text-ink">{name}</span>
                    {!account.IS_ACTIVE && (
                      <span className="mono rounded-[2px] border border-line-strong px-1 text-[9px] uppercase text-ink-3">{tr('Inactive')}</span>
                    )}
                    {isSelected && (
                      <span className="mono ms-auto text-[9.5px] uppercase tracking-[0.05em]" style={{ color: 'var(--color-jade-600)' }}>
                        {tr('Selected')}
                      </span>
                    )}
                  </span>
                  <span className="mono mt-0.5 block truncate text-[10px] text-ink-3">
                    @{account.USER_USERNAME} · {tr('person #')}{account.PERSON_ID}
                    {roles.length > 0 ? ` · ${roles.join(', ')}` : ''}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {selected && (
        <form onSubmit={submit} className="mt-3 space-y-2 rounded-[4px] border border-line bg-canvas p-3">
          <div className="mono text-[10px] uppercase tracking-[0.05em] text-ink-3">
            {tr('Set a new password for @')}{selected.USER_USERNAME}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('New password')}</label>
              <input
                type="password"
                value={next}
                onChange={e => setNext(e.target.value)}
                autoComplete="new-password"
                placeholder={tr('At least 8 characters')}
                className="field h-8 w-full text-[12px]"
              />
            </div>
            <div>
              <label className="kicker mb-1 block text-[9px]">{tr('Confirm password')}</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder={tr('Repeat the password')}
                className="field h-8 w-full text-[12px]"
              />
            </div>
          </div>
          <PasswordStrength value={next} />
          {error && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium" style={fieldError}>
              <AlertCircle size={12} /> {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10.5px] text-ink-3">{tr('The user signs in with this password right away.')}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setSelected(null); setNext(''); setConfirm(''); setError('') }}
                className={secondaryButton}
              >
                {tr('Cancel')}
              </button>
              <button type="submit" disabled={saving || !next || !confirm} className={dangerButton}>
                <Lock size={11} /> {saving ? tr('Updating…') : tr('Update password')}
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  )
}

// The three credential dialogs share one lazily loaded chunk: opening any of
// them pulls it in, and the settings page keeps its own list and switches.
export default function AccountModals({ setting, canResetUsers, ...props }) {
  return (
    <>
      <UsernameModal open={setting === 'username'} {...props} />
      <OwnPasswordModal open={setting === 'password'} {...props} />
      {canResetUsers && <UserPasswordModal open={setting === 'userPasswords'} {...props} />}
    </>
  )
}
