import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, ArrowLeft, ArrowRight, BarChart3, CalendarClock, CalendarDays, ChevronDown,
  ChevronLeft, ChevronRight, ClipboardCheck, Eye, EyeOff, FileDown, HelpCircle, Lock,
  MessageSquare, Pause, Play, Scale, User, Users, WifiOff
} from 'lucide-react'

import LanguageToggle from './ui/LanguageToggle'
import ThemeToggle from './ui/ThemeToggle'
import MotionToggle from './ui/MotionToggle'
import WindowControls from './ui/WindowControls'
import Modal from './ui/Modal'
import AppMark from './ui/AppMark'
import { useI18n } from '../i18n'

// Sign-in screen: a full-height split. The editorial panel states what the
// application is; the form panel is the task itself. Both fill the window, so
// there is no floating card in the middle of an empty canvas.
//
// Everything is translated and laid out with logical properties, so Arabic
// mirrors the split without any hand-written RTL rules.

const inputCls =
  'h-11 w-full rounded-[4px] border border-line-strong bg-surface ps-10 pe-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-jade-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-jade-500)_18%,transparent)]'

const serverInputCls =
  'mt-1 h-9 w-full rounded-[4px] border border-line-strong bg-surface px-2.5 text-[12px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-jade-500 focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-jade-500)_18%,transparent)]'

// What the signed-out reader can expect once inside. Four short slides, enough
// to say the application is more than a login form without turning the panel
// into marketing copy.
const FEATURES = [
  {
    icon: CalendarDays,
    title: 'Attendance',
    body: 'Record absences session by session, with justifications and a clear per-student history.'
  },
  {
    icon: ClipboardCheck,
    title: 'Exams and marks',
    body: 'Enter marks per subject, review averages, and publish results from one place.'
  },
  {
    icon: Users,
    title: 'Student registry',
    body: 'Students, sections and teaching scopes stay in one record, not in separate spreadsheets.'
  },
  {
    icon: MessageSquare,
    title: 'Messaging and oversight',
    body: 'Announcements, page locks and an audit trail keep every change accountable.'
  },
  {
    icon: CalendarClock,
    title: 'Sessions and timetables',
    body: 'Plan lessons and follow each session record from the weekly schedule.'
  },
  {
    icon: Scale,
    title: 'Discipline records',
    body: 'Log observations, rewards and punishments against the student and the date they belong to.'
  },
  {
    icon: FileDown,
    title: 'Reports and exports',
    body: 'Print a complete student report, or export the audit log as CSV for review.'
  },
  {
    icon: BarChart3,
    title: 'Statistics overview',
    body: 'Read enrolment, attendance and results as figures instead of guesswork.'
  }
]

// The feature panel walks itself through the list on its own, like the teaser
// loop a sign-in screen usually runs. It holds while the keyboard is inside it
// and while the window is minimised, and the corner button pauses and resumes
// it by hand; otherwise it advances every few seconds, in every motion mode
// (power save simply drops the transition between slides, since index.css
// removes animations there). Choosing a slide yourself restarts the countdown,
// so the choice is not overridden a moment later. Arrow keys follow the reading
// direction, and a pointer click does not stop the loop the way keyboard focus
// does.
const AUTO_ADVANCE_MS = 6000

const FeatureCarousel = () => {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const [wantsPlay, setWantsPlay] = useState(true)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(false)
  // Bumped by a manual choice so the countdown starts again from the beginning.
  const [restart, setRestart] = useState(0)

  const total = FEATURES.length
  const feature = FEATURES[index]
  const Icon = feature.icon
  // Automatic advance is the panel's behaviour, not decoration: it runs in
  // every motion mode, so the loop never looks broken. The pause button, a
  // keyboard focus inside the panel, and a hidden window are the only stops.
  const playing = wantsPlay
  const autoAdvance = playing && !focused && !hidden

  // A minimised window has no reader: the loop stops rather than cycling
  // through slides nobody sees.
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!autoAdvance) return undefined
    const timer = setInterval(() => setIndex((current) => (current + 1) % total), AUTO_ADVANCE_MS)
    return () => clearInterval(timer)
  }, [autoAdvance, total, restart])

  const restartCountdown = () => setRestart((value) => value + 1)

  const step = (delta) => {
    setIndex((current) => (current + delta + total) % total)
    restartCountdown()
  }

  const choose = (position) => {
    setIndex(position)
    restartCountdown()
  }

  const handleKeyDown = (event) => {
    const rtl = document.documentElement.getAttribute('dir') === 'rtl'
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      step(rtl ? -1 : 1)
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      step(rtl ? 1 : -1)
    }
  }

  const arrowCls =
    'grid h-6 w-6 place-items-center rounded-[3px] border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink'

  return (
    <div
      role="group"
      aria-label={t('Application features')}
      onKeyDown={handleKeyDown}
      // Only keyboard focus holds the loop: a pointer click on a dot or an
      // arrow leaves the button focused too, and that should not freeze the
      // panel the reader just touched.
      onFocus={(event) => {
        if (event.target.matches?.(':focus-visible')) setFocused(true)
      }}
      onBlur={(event) => {
        // Moving between the carousel's own buttons is not leaving it.
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
      className="overflow-hidden rounded-[4px] border border-line bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <span className="kicker text-[9px]">{t('What is inside')}</span>
        <div className="flex items-center gap-1">
          {/* The loop runs by default, so there is always something to pause. */}
          <button
            type="button"
            onClick={() => {
              setWantsPlay((value) => !value)
              restartCountdown()
            }}
            aria-label={playing ? t('Pause slideshow') : t('Play slideshow')}
            title={playing ? t('Pause slideshow') : t('Play slideshow')}
            aria-pressed={!playing}
            className={arrowCls}
          >
            {playing ? <Pause size={11} strokeWidth={2} /> : <Play size={11} strokeWidth={2} />}
          </button>
          <button type="button" onClick={() => step(-1)} aria-label={t('Previous feature')} className={arrowCls}>
            <ChevronLeft size={13} strokeWidth={2} className="rtl:rotate-180" />
          </button>
          <button type="button" onClick={() => step(1)} aria-label={t('Next feature')} className={arrowCls}>
            <ChevronRight size={13} strokeWidth={2} className="rtl:rotate-180" />
          </button>
        </div>
      </div>

      <div key={index} className="anim-plate px-3.5 py-3.5" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <Icon size={15} strokeWidth={1.8} style={{ color: 'var(--color-jade-600)' }} aria-hidden="true" />
          <span className="mono text-[9.5px] text-ink-3">
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        </div>
        <div className="mt-2 min-h-[86px]">
          <h2 className="serif text-[21px] leading-[25px] tracking-[-0.01em] text-ink">
            {t(feature.title)}
          </h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{t(feature.body)}</p>
        </div>
        <span className="sr-only">{t('Feature {current} of {total}', { current: index + 1, total })}</span>
      </div>

      <div className="flex items-center gap-1.5 border-t border-line px-3.5 py-2">
        {FEATURES.map((item, position) => (
          <button
            key={item.title}
            type="button"
            onClick={() => choose(position)}
            aria-label={t(item.title)}
            aria-current={position === index ? 'true' : undefined}
            className={`h-1.5 rounded-full transition-all ${position === index ? 'w-5' : 'w-1.5'}`}
            style={{
              background:
                position === index ? 'var(--color-jade-solid)' : 'var(--color-line-strong)'
            }}
          />
        ))}
      </div>
    </div>
  )
}

const Login = ({ onLogin }) => {
  const { t, dir } = useI18n()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [serverStatus, setServerStatus] = useState(null)
  const [serverForm, setServerForm] = useState({ host: '', port: '5432', database: 'eNote', user: '', password: '' })
  const [serverBusy, setServerBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const [serverSaved, setServerSaved] = useState(false)

  // A workstation may be installed before it has ever reached the database. The
  // login form is then the first screen it can show, so the endpoint has to be
  // readable and editable here — otherwise the Database page that owns the
  // connection settings is unreachable until after a successful sign-in.
  useEffect(() => {
    let cancelled = false
    const loadServer = async () => {
      try {
        const status = await window.api.dbStatus()
        if (cancelled) return
        setServerStatus(status)
        setServerForm((form) => ({
          ...form,
          host: status.host || form.host,
          port: String(status.port || 5432),
          database: status.database || form.database,
          user: status.user || form.user
        }))
      } catch {
        // The status line stays at "Not connected"; the form still works.
      }
    }
    loadServer()
    return () => {
      cancelled = true
    }
  }, [])

  const connected = !!serverStatus?.connected

  // The server endpoint is an administrator concern, not part of signing in,
  // so it has no visible entry point on this screen. Ctrl+Shift+K opens it.
  // The command palette owns Ctrl/Cmd+K without Shift (in the signed-in
  // layout), so this combination is free here.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setServerError('')
      setServerOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleServerConnect = async (event) => {
    event.preventDefault()
    if (serverBusy) return
    setServerError('')
    setServerSaved(false)
    setServerBusy(true)
    try {
      const result = await window.api.connectDb({
        host: serverForm.host.trim(),
        port: Number(serverForm.port) || 5432,
        database: serverForm.database.trim() || 'eNote',
        user: serverForm.user.trim(),
        password: serverForm.password
      })
      if (!result?.success) {
        setServerError(result?.error || t('Connection failed'))
        return
      }
      const status = await window.api.dbStatus()
      setServerStatus(status)
      setServerSaved(true)
      setServerForm((form) => ({ ...form, password: '' }))
    } catch (err) {
      setServerError(err.message || t('Connection failed'))
    } finally {
      setServerBusy(false)
    }
  }

  // The sign-in service reports a code for each way it can refuse, so the message
  // can be written in the interface's language; an unknown failure falls back to
  // whatever English text came back.
  const authError = (result) => {
    switch (result?.code) {
      case 'USER_NOT_FOUND':
        return t('User not found')
      case 'SUSPENDED':
        return t('This account is suspended after too many unsuccessful sign-in attempts. An administrator can restore access.')
      case 'DEACTIVATED':
        return t('This account has been deactivated. Ask an administrator to reactivate it.')
      // Signing in from the copy of the credential this computer keeps for the
      // account that signed in last (see src/main/offlineAuth.js).
      case 'OFFLINE_NO_CREDENTIAL':
        return t('Offline sign-in is not available yet: connect to the server once.')
      case 'OFFLINE_OTHER_ACCOUNT':
        return t('While the server is unreachable, only {username} can sign in on this computer.', {
          username: result.username
        })
      case 'OFFLINE_SIGN_IN_LOCKED':
        return t('Too many wrong passwords while the server was unreachable. Connect to the server to sign in again.')
      case 'OFFLINE_CREDENTIAL_EXPIRED':
        return t('The saved sign-in on this computer is out of date. Connect to the server once to sign in again.')
      case 'INVALID_CREDENTIALS':
        if (result.offline) {
          return result.remainingAttempts === 1
            ? t('Invalid credentials. One more attempt before offline sign-in locks.')
            : t('Invalid credentials. {count} attempts before offline sign-in locks.', {
              count: result.remainingAttempts
            })
        }
        return result.remainingAttempts === 1
          ? t('Invalid credentials. One more attempt before this account is suspended.')
          : t('Invalid credentials. {count} attempts before this account is suspended.', {
            count: result.remainingAttempts
          })
      default:
        return result?.message || t('Login failed')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await window.api.login({ username, password })
      if (result.success) {
        onLogin(result.user)
      } else {
        setError(authError(result))
      }
    } catch (err) {
      console.error('Login component error:', err)
      setError(t('System error: {message}', { message: err.message || t('Unknown error') }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      {/* Window chrome: frameless window, so this strip drags it and carries
          the caption buttons. */}
      <header dir={dir} className="app-titlebar flex h-11 shrink-0 items-stretch border-b border-line bg-surface">
        <div className="app-drag flex items-center gap-1 ps-3 pe-2">
          <Link
            to="/welcome"
            aria-label={t('Overview')}
            title={t('Overview')}
            className="grid h-7 w-7 place-items-center rounded-[4px] text-ink-3 hover:bg-surface-muted hover:text-ink"
          >
            <ArrowLeft size={14} strokeWidth={1.9} className="rtl:rotate-180" />
          </Link>
          <ThemeToggle />
          <MotionToggle />
        </div>

        <div className="app-drag min-w-0 flex-1" />

        <div className="flex shrink-0 items-center gap-2 pe-3">
          <LanguageToggle withLabel />
        </div>

        <WindowControls />
      </header>

      <main className="anim-page flex min-h-0 flex-1">
        {/* ---- Editorial panel: what eNote is ---- */}
        <section className="relative hidden min-h-0 flex-1 flex-col justify-between overflow-hidden bg-sunken px-10 py-9 lg:flex xl:px-14 xl:py-12">
          <div className="flex items-center gap-3">
            <AppMark className="h-8 w-8" />
            <div className="min-w-0 leading-none">
              <div className="serif text-[17px] tracking-[-0.01em] text-ink">eNote</div>
              <div className="kicker mt-[5px] text-[9px]">{t('Academic registry')}</div>
            </div>
          </div>

          <div className="max-w-[560px]">
            <p className="serif text-[46px] leading-[1.02] tracking-[-0.02em] text-ink xl:text-[58px]">
              {t('Run the academic year')}
              <br />
              {t('without the spreadsheets.')}
            </p>
            <p className="mt-5 max-w-[430px] text-[13.5px] leading-relaxed text-ink-2">
              {t('One application, one database, one source of truth.')}
            </p>
            <div className="mt-8 max-w-[430px]">
              <FeatureCarousel />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-[11px] text-ink-3">
            <span>{t('eNote Management · internal academic platform')}</span>
          </div>
        </section>

        {/* ---- Form panel: the task ---- */}
        <section className="flex min-h-0 w-full flex-col justify-center overflow-y-auto border-line bg-surface px-6 py-8 sm:px-10 lg:w-[47%] lg:max-w-[620px] lg:shrink-0 lg:border-s xl:px-14">
          <div className="mx-auto w-full max-w-[360px]">
            {/* Compact brand for the narrow layout, where the editorial panel is hidden. */}
            <div className="mb-8 flex items-center gap-2.5 lg:hidden">
              <AppMark className="h-8 w-8" />
              <div className="min-w-0 leading-none">
                <div className="serif text-[16px] tracking-[-0.01em] text-ink">eNote</div>
                <div className="kicker mt-[5px] text-[9px]">{t('Academic registry')}</div>
              </div>
            </div>

            <div className="kicker text-[9.5px]">{t('Sign In')}</div>
            <h1 className="serif mt-2 text-[34px] leading-[38px] tracking-[-0.015em] text-ink">
              {t('Welcome back')}
            </h1>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              {t('Accounts are issued by your administrator — there is no public sign-up.')}
            </p>

            {/* The server is down: say so before the form, and say what still
                works, so nobody assumes the sign-in is broken. */}
            {serverStatus && !connected && (
              <div
                role="status"
                className="mt-6 flex items-start gap-2 rounded-[4px] border px-3 py-2.5 text-[11px] leading-relaxed"
                style={{
                  background: 'var(--color-warning-bg)',
                  borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
                  color: 'var(--color-warning-ink)'
                }}
              >
                <WifiOff size={13} strokeWidth={1.9} className="mt-px shrink-0" aria-hidden="true" />
                <span>
                  {t('The server is unreachable. You can still sign in with the account that signed in last on this computer, and read the records saved here.')}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {error && (
                <div
                  id="login-error"
                  role="alert"
                  className="flex items-start gap-2 rounded-[4px] border px-3 py-2.5 text-[11.5px] leading-relaxed"
                  style={{
                    background: 'var(--color-danger-bg)',
                    borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                    color: 'var(--color-danger-ink)'
                  }}
                >
                  <AlertCircle size={13} strokeWidth={1.9} className="mt-px shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div>
                <label htmlFor="login-username" className="field-label">{t('Username')}</label>
                <div className="relative">
                  <User
                    size={14}
                    strokeWidth={1.8}
                    className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3"
                    aria-hidden="true"
                  />
                  <input
                    id="login-username"
                    type="text"
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={inputCls}
                    placeholder={t('Enter your username')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-password" className="field-label">{t('Password')}</label>
                <div className="relative">
                  <Lock
                    size={14}
                    strokeWidth={1.8}
                    className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-3"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className={`${inputCls} pe-10`}
                    placeholder={t('Enter your password')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? t('Hide password') : t('Show password')}
                    title={showPassword ? t('Hide password') : t('Show password')}
                    aria-pressed={showPassword}
                    className="absolute end-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
                  >
                    {showPassword ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group inline-flex h-11 w-full items-center justify-center gap-2 rounded-[4px] text-[13px] font-semibold transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: 'var(--color-jade-solid)', color: 'var(--color-on-jade)' }}
              >
                {loading ? t('Signing in...') : t('Sign In')}
                {!loading && <ArrowRight size={15} strokeWidth={2} className="rtl:rotate-180" />}
              </button>
            </form>

            {/* Server connection: an administrator concern, opened only with
                Ctrl+Shift+K. Nothing on this screen points at it. */}
            <Modal
              open={serverOpen}
              onClose={() => { setServerOpen(false); setServerError('') }}
              title={t('Server settings')}
              maxWidth="max-w-md"
            >
              <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: connected ? 'var(--color-jade-solid)' : 'var(--color-danger)' }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-ink">
                      {connected
                        ? t('Connected to {host}', { host: serverStatus?.host || serverForm.host || '—' })
                        : t('Not connected')}
                    </div>
                    <div className="truncate text-[10px] text-ink-3">
                      {serverStatus?.host
                        ? `${serverStatus.database || 'eNote'} · ${serverStatus.host}:${serverStatus.port || 5432}`
                        : t('The server address is set by your administrator.')}
                    </div>
                  </div>
                </div>
              </div>

              {serverSaved && (
                <p className="mt-2 border-t border-line pt-2 text-[10px]" style={{ color: 'var(--color-jade-600)' }}>
                  {t('Connection saved. You can sign in now.')}
                </p>
              )}

              <form onSubmit={handleServerConnect} className="space-y-2.5">
                  <p className="text-[10px] leading-relaxed text-ink-3">
                    {t('Ask your administrator for these details. The connection is saved on this computer.')}
                  </p>

                  {serverError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-[4px] border px-2.5 py-2 text-[10.5px] leading-relaxed"
                      style={{
                        background: 'var(--color-danger-bg)',
                        borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
                        color: 'var(--color-danger-ink)'
                      }}
                    >
                      <AlertCircle size={12} strokeWidth={1.9} className="mt-px shrink-0" />
                      <span>{serverError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-[1fr_72px] gap-2">
                    <label className="block text-[10px] font-medium text-ink-2">
                      {t('Host')}
                      <input
                        type="text"
                        className={serverInputCls}
                        placeholder="192.214.23.15"
                        autoComplete="off"
                        spellCheck={false}
                        value={serverForm.host}
                        onChange={(e) => setServerForm((form) => ({ ...form, host: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="block text-[10px] font-medium text-ink-2">
                      {t('Port')}
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        className={serverInputCls}
                        value={serverForm.port}
                        onChange={(e) => setServerForm((form) => ({ ...form, port: e.target.value }))}
                        required
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[10px] font-medium text-ink-2">
                      {t('Database')}
                      <input
                        type="text"
                        className={serverInputCls}
                        autoComplete="off"
                        spellCheck={false}
                        value={serverForm.database}
                        onChange={(e) => setServerForm((form) => ({ ...form, database: e.target.value }))}
                        required
                      />
                    </label>
                    <label className="block text-[10px] font-medium text-ink-2">
                      {t('User')}
                      <input
                        type="text"
                        className={serverInputCls}
                        autoComplete="username"
                        spellCheck={false}
                        value={serverForm.user}
                        onChange={(e) => setServerForm((form) => ({ ...form, user: e.target.value }))}
                        required
                      />
                    </label>
                  </div>

                  <label className="block text-[10px] font-medium text-ink-2">
                    {t('Password')}
                    <input
                      type="password"
                      className={serverInputCls}
                      autoComplete="current-password"
                      value={serverForm.password}
                      onChange={(e) => setServerForm((form) => ({ ...form, password: e.target.value }))}
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={serverBusy}
                    className="inline-flex h-9 w-full items-center justify-center rounded-[4px] text-[12px] font-semibold transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ background: 'var(--color-jade-solid)', color: 'var(--color-on-jade)' }}
                  >
                    {serverBusy ? t('Connecting...') : t('Connect')}
                  </button>
              </form>
            </Modal>

            <div className="mt-6 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => setHelpOpen((value) => !value)}
                aria-expanded={helpOpen}
                aria-controls="login-help"
                className="flex items-center gap-1.5 text-[11px] font-medium transition-colors"
                style={{ color: 'var(--color-jade-600)' }}
              >
                <HelpCircle size={12} strokeWidth={1.9} />
                {t('Forgot your password?')}
                <ChevronDown
                  size={11}
                  strokeWidth={2}
                  className={`transition-transform ${helpOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {helpOpen && (
                <div
                  id="login-help"
                  role="region"
                  aria-label={t('Forgot your password?')}
                  className="mt-3 rounded-[4px] border border-line bg-canvas px-3 py-2.5"
                >
                  <p className="text-[11px] font-medium text-ink">
                    {t('Passwords are reset by an administrator — there is no self-service reset link in this application.')}
                  </p>
                  <ol className="mt-2 space-y-1.5">
                    {[
                      t('Ask an administrator to reset it: in Settings → User passwords they look your account up and set a new password. Your old one is not needed.'),
                      t('Five wrong passwords in a row suspend the account: it cannot sign in even with the correct password, and only an administrator can restore it, from Administration → Suspended accounts.'),
                      t('A successful sign-in clears the count, so the five are consecutive, not over the life of the account.')
                    ].map((step, index) => (
                      <li key={index} className="flex gap-2 text-[10.5px] leading-relaxed text-ink-2">
                        <span className="mono mt-[1px] w-4 shrink-0 text-[9px] text-ink-3">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-2 border-t border-line pt-2 text-[10px] leading-relaxed text-ink-3">
                    {t('Once you are signed in you can change your own password in Settings.')}
                  </p>
                </div>
              )}
            </div>

            <p className="mt-8 text-[10px] leading-relaxed text-ink-3">
              {t('Forgot your credentials? Contact your system administrator.')}
            </p>
          </div>
        </section>
      </main>
    </div>
  )
}

export default Login
