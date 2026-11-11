import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Moon, Sun, UserRound, Settings, LogOut, ChevronRight, WifiOff, Command, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react'
import Sidebar from './Sidebar'
import ThemeToggle from './ui/ThemeToggle'
import MotionToggle from './ui/MotionToggle'
import LanguageToggle from './ui/LanguageToggle'
import DirectorNotificationFab from './DirectorNotificationFab'
import OfflineQueue from './OfflineQueue'
import OfflineStatusPanel from './OfflineStatusPanel'
import MessagesMenu from './MessagesMenu'
import NewVersionDialog from './NewVersionDialog'
import CommandPalette from './CommandPalette'
import ShortcutsDialog from './ui/ShortcutsDialog'
import WindowControls from './ui/WindowControls'
import AppMark from './ui/AppMark'
import LockedPage from './LockedPage'
import { allRoutes } from '../nav'
import { accountHandle, accountInitials, accountName } from '../accountName'
import { UserProvider } from '../userContext'
import { isPageLockedFor, usePageLocks } from '../pageLocks'
import { isTypingTarget } from '../useUnsavedChanges'
import { tr, useI18n } from '../i18n'
import { dateLocale } from '../scheduleUtils'
import { isDarkTheme, useTheme } from '../theme'

const FULL_BLEED = new Set(['/', '/student-records', '/absences', '/rewards-punishments', '/records', '/messages'])

// The stamp follows the interface language: the system locale would keep the
// weekday and month in English while the rest of the bar is Arabic or French.
const formatStamp = (date, locale) => {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  } catch {
    return ''
  }
}

const Layout = ({ children, user, onLogout, isOnline, dbStatus }) => {
  const { t, dir } = useI18n()
  // Refreshing from the title bar reloads the window: every screen re-reads its
  // data from the database, while the stored session and the current route bring
  // the same page back. The short delay is only so the spin is seen.
  const [refreshing, setRefreshing] = useState(false)
  const refreshApp = () => {
    if (refreshing) return
    setRefreshing(true)
    window.setTimeout(() => window.location.reload(), 160)
  }
  // The header keeps the caption buttons at the physical top-right, so it is
  // laid out left-to-right in every language. The navigation column is not: it
  // moves to the right in Arabic, and the block above it follows.
  const isRtl = dir === 'rtl'
  const location = useLocation()
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // What is cached on this computer: opened from the offline strip.
  const [savedOpen, setSavedOpen] = useState(false)
  // The database chip is also the recovery control: reconnect without quitting.
  const [liveDbStatus, setLiveDbStatus] = useState(null)
  const [reconnecting, setReconnecting] = useState(false)
  const db = liveDbStatus || dbStatus
  const reconnect = async () => {
    setReconnecting(true)
    try {
      await window.api.reconnectDb()
      const status = await window.api.dbStatus()
      // Keep the saved-copy information the strip reports, not just the flag.
      setLiveDbStatus({
        ...(dbStatus || {}),
        connected: !!status.connected,
        checked: true,
        source: status.source,
        lastSyncAt: status.lastSyncAt ?? dbStatus?.lastSyncAt ?? null,
        cache: status.cache || dbStatus?.cache || null
      })
    } catch (error) {
      setLiveDbStatus({ connected: false, source: error.message })
    } finally {
      setReconnecting(false)
    }
  }

  // "?" opens the keyboard reference, unless the caret is in a text field.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== '?' || isTypingTarget(event.target)) return
      event.preventDefault()
      setShortcutsOpen((open) => !open)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  // The title bar carries a clock, so it has to keep time: a render-time stamp
  // would freeze at whatever minute the window happened to open.
  const [now, setNow] = useState(() => new Date())
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem('enote-nav-collapsed') === '1'
    } catch {
      return false
    }
  })
  const menuRef = useRef(null)

  // A frameless window has no browser back button, so the title bar carries the
  // pair of arrows a desktop application is expected to have. The router still
  // owns the real history; this stack only knows how far the arrows may travel,
  // which is what lets them be disabled instead of clicking into nothing.
  const historyRef = useRef({ entries: [], index: -1 })
  const [historyNav, setHistoryNav] = useState({ canBack: false, canForward: false })

  useEffect(() => {
    const { entries, index } = historyRef.current
    if (entries[index] === location.pathname) return
    const next = entries.slice(0, index + 1)
    next.push(location.pathname)
    historyRef.current = { entries: next, index: next.length - 1 }
    setHistoryNav({ canBack: next.length > 1, canForward: false })
  }, [location.pathname])

  const stepHistory = (delta) => {
    const { entries, index } = historyRef.current
    const target = index + delta
    if (target < 0 || target >= entries.length) return
    historyRef.current = { entries, index: target }
    setHistoryNav({ canBack: target > 0, canForward: target < entries.length - 1 })
    navigate(entries[target])
  }

  // Alt+← / Alt+→: the shortcut a desktop user already has in their fingers.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        stepHistory(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        stepHistory(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const [theme, setTheme] = useTheme()
  const isDark = isDarkTheme(theme)
  // Admins set the locks; they keep the keys, so a lock never shuts them out.
  // A lock is per role now: the map holds the roles each page is closed for.
  const pageLocks = usePageLocks()
  const isDirector = !!user && user.roles?.includes('DIRECTOR')
  const isAdmin = !!user && user.roles?.includes('ADMIN')
  const isDeveloper = !!user && user.roles?.includes('DEVELOPER')
  const isTeacher = !!user && user.roles?.includes('TEACHER')
  const isStaff = !!user && user.roles?.some((role) => ['ADMIN', 'SECRETARY', 'DIRECTOR'].includes(role))

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  // Remember the navigation width across launches.
  useEffect(() => {
    try {
      localStorage.setItem('enote-nav-collapsed', navCollapsed ? '1' : '0')
    } catch {
      // storage is optional
    }
  }, [navCollapsed])

  // Presence heartbeat: keeps "last seen" meaningful while the app is open.
  useEffect(() => {
    if (!user?.id) return
    const beat = () => {
      window.api?.touchLastSeen(user.id)?.catch(() => {})
    }
    beat()
    const timer = setInterval(beat, 60000)
    return () => clearInterval(timer)
  }, [user?.id])

  // One global shortcut for the command surface.
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const routes = allRoutes(user)
  const activeRoute =
    routes.find((route) => route.to === location.pathname) ||
    routes.find((route) => route.to !== '/' && location.pathname.startsWith(route.to))
  const fullBleed = FULL_BLEED.has(location.pathname)
  // Whoever administers the locks keeps the keys: an Admin or a Developer can
  // still open a locked page, and the Settings entry that lifts the lock is
  // itself reachable to them.
  // Whoever administers the locks keeps the keys: an Admin or a Developer can
  // still open a locked page, and the Settings entry that lifts the lock is
  // itself reachable to them. For everybody else the lock applies only if one
  // of their roles is named by it.
  const isLockedRoute = (route) =>
    isPageLockedFor(pageLocks, route, user?.roles) && !isAdmin && !isDeveloper
  const isLockedHere = isLockedRoute(location.pathname)
  // The chip reads as a label ("secretary" -> "Secretary") so the dictionary
  // translates the role itself and not only the words around it.
  const roleLine = (user?.roles?.[0] || 'Member')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

  return (
    <UserProvider value={user}>
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <a href="#main" className="skip-link">
        {t('Skip to content')}
      </a>
      {/* The strip mirrors with the interface instead of being forced into one
          direction. In English and French it reads left to right, caption
          buttons at the physical top-right as the OS expects; in Arabic the
          whole bar turns around — the brand stays over the navigation column,
          which is now on the right, the history arrows and breadcrumb follow it,
          and the action cluster and caption buttons end up on the left, where
          Windows itself puts them in a right-to-left locale. Everything inside
          is written with logical properties, so this is one layout seen from the
          other end, not a second arrangement. */}
      <header dir={isRtl ? 'rtl' : 'ltr'} className="app-titlebar z-30 flex h-11 shrink-0 items-stretch border-b border-line bg-surface">
        {/* App identity: the window's own title instead of the OS caption. The
            strip is as wide as the navigation column so the seam lines up. */}
        <div
          className="app-drag flex h-full shrink-0 items-stretch overflow-hidden border-e border-line"
          style={{
            width: navCollapsed ? 'var(--sidebar-w-rail)' : 'var(--sidebar-w)',
            background: 'var(--color-sunken)',
            transition: 'width 160ms cubic-bezier(.2,.8,.2,1)'
          }}
        >
          <button
            type="button"
            onClick={() => setNavCollapsed((value) => !value)}
            title={navCollapsed ? t('Expand navigation') : t('Collapse navigation')}
            aria-label={navCollapsed ? t('Expand navigation') : t('Collapse navigation')}
            aria-pressed={navCollapsed}
            className="grid w-10 shrink-0 place-items-center text-ink-3 hover:bg-surface-muted hover:text-ink"
          >
            {navCollapsed
              ? (isRtl
                ? <PanelRightOpen size={14} strokeWidth={1.75} />
                : <PanelLeftOpen size={14} strokeWidth={1.75} />)
              : (isRtl
                ? <PanelRightClose size={14} strokeWidth={1.75} />
                : <PanelLeftClose size={14} strokeWidth={1.75} />)}
          </button>

          {!navCollapsed && (
            <div className="flex min-w-0 items-center gap-2 pe-3">
              <AppMark className="h-[24px] w-[24px]" />
              <div className="min-w-0">
                <div className="serif truncate text-[15px] leading-none tracking-[-0.01em] text-ink">eNote</div>
                <div className="kicker mt-[3px] truncate text-[8.5px] leading-none">{t('Academic registry')}</div>
              </div>
            </div>
          )}
        </div>

          {/* History arrows: two controls, 28px each, that stay disabled until
              there is somewhere to go. They are the only new chrome here — the
              bar keeps its width and everything else is unchanged. */}
          <div className="flex h-full shrink-0 items-center gap-0.5 ps-1.5">
            <button
              type="button"
              onClick={() => stepHistory(-1)}
              disabled={!historyNav.canBack}
              title={t('Back')}
              aria-label={t('Back')}
              className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-ink-3"
            >
              {isRtl ? <ArrowRight size={14} strokeWidth={1.9} /> : <ArrowLeft size={14} strokeWidth={1.9} />}
            </button>
            <button
              type="button"
              onClick={() => stepHistory(1)}
              disabled={!historyNav.canForward}
              title={t('Forward')}
              aria-label={t('Forward')}
              className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-ink-3"
            >
              {isRtl ? <ArrowLeft size={14} strokeWidth={1.9} /> : <ArrowRight size={14} strokeWidth={1.9} />}
            </button>
          </div>

          {/* The breadcrumb reads from the start of the interface language, and
              its chevron points the way the words run. */}
          <nav aria-label={t('Breadcrumb')} className="flex min-w-0 items-center gap-1.5 ps-2">
            <span className="kicker shrink-0 text-[9.5px]">{t('Registry')}</span>
            <ChevronRight
              size={11}
              strokeWidth={2}
              className={`shrink-0 text-ink-3 ${isRtl ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            {activeRoute ? (
              <span className="truncate text-[12.5px] font-medium text-ink">{t(activeRoute.label)}</span>
            ) : (
              <span className="truncate text-[12.5px] font-medium text-ink">{t('Workspace')}</span>
            )}
            {activeRoute?.group && (
              <span className="ms-1 hidden truncate text-[10.5px] text-ink-3 sm:inline">
                {t(activeRoute.group)}
              </span>
            )}
          </nav>

          <div className="ms-auto flex min-w-0 items-center gap-1.5 ps-3 pe-2">
            <span className="mono me-1 hidden whitespace-nowrap text-[10.5px] text-ink-3 lg:inline">{formatStamp(now, dateLocale())}</span>

            {!isOnline && (
              <span className="me-1 inline-flex items-center gap-1.5 border border-warning/40 bg-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-warning-ink">
                <WifiOff size={10} strokeWidth={2} />
                {t('Offline')}
              </span>
            )}

            {/* Attendance recorded while the server was away: waiting, sent, or
                waiting for a person to choose between two versions. */}
            <OfflineQueue />

            {isStaff && db?.source && (
              <span
                role="status"
                aria-live="polite"
                title={`${t('Data source')}: ${db.source}`}
                className="me-1 hidden items-center gap-1.5 px-1.5 py-0.5 text-[10px] text-ink-3 xl:inline-flex"
              >
                <span
                  className="h-[5px] w-[5px] rounded-full"
                  style={{ background: db.connected ? 'var(--color-success)' : 'var(--color-danger)' }}
                  aria-hidden="true"
                />
                {db.connected ? t('Records connected') : t('Records unavailable')}
                {!db.connected && (
                  <button
                    type="button"
                    onClick={reconnect}
                    disabled={reconnecting}
                    className="ms-1 inline-flex h-5 items-center gap-1 rounded-[2px] border border-line-strong bg-surface px-1.5 text-[9.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:opacity-60"
                  >
                    <RefreshCw size={9} className={reconnecting ? 'animate-spin' : undefined} />
                    {reconnecting ? t('Reconnecting…') : t('Reconnect')}
                  </button>
                )}
              </span>
            )}

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="me-1 hidden h-7 items-center gap-1.5 border border-line px-2 text-[10.5px] text-ink-3 hover:border-line-strong hover:text-ink-2 md:inline-flex"
              title={t('Open command palette')}
            >
              <Command size={10} strokeWidth={2} />
              {t('Search')}
              <span className="kbd ms-1">⌘K</span>
            </button>

            {/* Every account can receive inbox mail and direct messages, so the
                bell is not limited to the roles that watch absences. A locked
                page keeps its shortcut, but the shortcut never previews the
                page's content: it leads to the page's locked notice instead. */}
            {user && <DirectorNotificationFab user={user} locked={isLockedRoute('/notifications')} />}

            {/* The messages shortcut opens its own list of recent threads, the
                way the bell opens the notifications. */}
            {user && (
              <MessagesMenu
                user={user}
                active={location.pathname === '/messages'}
                locked={isLockedRoute('/messages')}
              />
            )}

            <LanguageToggle />
            <MotionToggle />
            <ThemeToggle />

            {/* Re-read everything on the page: the reliable refresh when a
                live update has been missed or a record was changed elsewhere. */}
            <button
              type="button"
              onClick={refreshApp}
              disabled={refreshing}
              title={t('Refresh')}
              aria-label={t('Refresh')}
              className="grid h-7 w-7 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink disabled:opacity-60"
            >
              <RefreshCw size={13} strokeWidth={1.75} className={refreshing ? 'animate-spin' : undefined} />
            </button>

            <div className="relative ms-1 border-s border-line ps-1.5" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-8 items-center gap-2 rounded-[3px] px-1.5 hover:bg-surface-muted"
              >
                <span className="grid h-[22px] w-[22px] place-items-center rounded-[3px] border border-line-strong text-[9.5px] font-semibold text-ink-2">
                  {accountInitials(user)}
                </span>
                {/* The person's names over the handle they sign in with, so the
                    strip says both who is signed in and which account it is. */}
                <span className="hidden min-w-0 max-w-[170px] flex-col items-start leading-tight xl:flex">
                  <span className="w-full truncate text-[11.5px] font-medium text-ink-2">
                    {accountName(user)}
                  </span>
                  {user?.username && (
                    <span className="mono w-full truncate text-[9.5px] text-ink-3">{accountHandle(user)}</span>
                  )}
                </span>
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  dir={isRtl ? 'rtl' : 'ltr'}
                  className={`absolute top-[calc(100%+6px)] z-40 w-56 rounded-md border border-line-strong bg-raised p-1 anim-plate ${
                    isRtl ? 'start-0' : 'end-0'
                  }`}
                  style={{ boxShadow: 'var(--shadow-e2)' }}
                >
                  <div className="px-2.5 py-2">
                    <div className="truncate text-[12px] font-medium text-ink">{accountName(user)}</div>
                    {user?.username && (
                      <div className="mono mt-0.5 truncate text-[10px] text-ink-3">{accountHandle(user)}</div>
                    )}
                    <div className="mt-0.5 truncate text-[10px] capitalize text-ink-3">
                      {t(roleLine)}
                      {user?.email ? ` · ${user.email}` : ''}
                    </div>
                  </div>
                  <div className="menu-sep" />
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); navigate('/profile') }}>
                    <UserRound size={13} strokeWidth={1.75} /> {t('Profile')}
                  </button>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); navigate('/settings') }}>
                    <Settings size={13} strokeWidth={1.75} /> {t('Settings')}
                  </button>
                  <div className="menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={(event) => { setTheme(isDark ? 'light' : 'dark', event.currentTarget); setMenuOpen(false) }}
                  >
                    {isDark ? <Sun size={13} strokeWidth={1.75} /> : <Moon size={13} strokeWidth={1.75} />}
                    {isDark ? t('Light appearance') : t('Dark appearance')}
                  </button>
                  <div className="menu-sep" />
                  <button type="button" role="menuitem" className="menu-item" data-danger="true" onClick={onLogout}>
                    <LogOut size={13} strokeWidth={1.75} /> {t('Log out')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Last in source order, so they sit at the end of the strip: the
              physical right in English and French, the physical left in Arabic. */}
          <div className="flex h-full shrink-0">
            <WindowControls />
          </div>
      </header>

      {/* The server is the only source of truth, so while it is unreachable the
          strip says exactly what still works: records already read on this
          computer stay readable, and nothing can be edited. Nothing is queued
          for later on purpose — a queued edit is how two secretaries end up
          disagreeing about the same student. */}
      {db?.checked && !db.connected && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning-bg px-4 py-1.5 text-[11px] text-warning-ink"
        >
          <WifiOff size={12} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          <span className="font-medium">{t('Offline — showing saved records')}</span>
          <span className="text-[10.5px] opacity-90">
            {t('The server is unreachable. You can read what is saved on this computer, but changes cannot be saved until it is back.')}
          </span>
          {db.lastSyncAt ? (
            <span className="mono text-[10px] opacity-80">
              {t('Saved records as of {when}', {
                when: formatStamp(new Date(db.lastSyncAt), dateLocale())
              })}
            </span>
          ) : null}
          <span className="border border-warning/50 px-1 py-px text-[9.5px] font-medium uppercase tracking-[0.06em]">
            {t('Read-only while offline')}
          </span>
          <button
            type="button"
            onClick={() => setSavedOpen(true)}
            className="ms-auto inline-flex h-5 items-center gap-1 rounded-[2px] border border-line-strong bg-surface px-1.5 text-[9.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
          >
            {t("What's saved")}
          </button>
          <button
            type="button"
            onClick={reconnect}
            disabled={reconnecting}
            className="ms-1 inline-flex h-5 items-center gap-1 rounded-[2px] border border-line-strong bg-surface px-1.5 text-[9.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:opacity-60"
          >
            <RefreshCw size={9} className={reconnecting ? 'animate-spin' : undefined} />
            {reconnecting ? t('Reconnecting…') : t('Reconnect')}
          </button>
        </div>
      )}

      <OfflineStatusPanel open={savedOpen} onClose={() => setSavedOpen(false)} />

      <div className="flex min-h-0 flex-1">
        {/* The mark mirrors the guard above: only a lock that names one of this
            account's roles marks a row, and an Admin or a Developer — who keep
            the keys — never sees one. A lock that names other roles is not a
            lock for them, so the sidebar stays unmarked. */}
        <Sidebar
          user={user}
          onLogout={onLogout}
          onOpenCommand={() => setPaletteOpen(true)}
          isOnline={db?.checked ? !!db.connected : isOnline}
          collapsed={navCollapsed}
          lockedRoutes={new Set([...pageLocks.keys()].filter(isLockedRoute))}
        />

        <main id="main" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col focus:outline-none">
          {/* Keyed on the route so every screen enters with its own transition.
              Power save mode removes that animation in CSS, not here. */}
          <div
            key={location.pathname}
            className={`anim-page ${
              fullBleed || isLockedHere
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                : 'page-body min-h-0 flex-1 overflow-y-auto px-5 py-5'
            }`}
          >
            {isLockedHere ? (
              <LockedPage user={user} path={location.pathname} />
            ) : (
              children
            )}
          </div>
        </main>
      </div>

      {/* One dialog per release and per account, wherever the user lands. */}
      <NewVersionDialog user={user} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        user={user}
        onLogout={onLogout}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
    </UserProvider>
  )
}

export default Layout
