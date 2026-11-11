import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronDown, Command, Lock, LogOut, Search } from 'lucide-react'
import { useI18n } from '../i18n'
import { buildNav, sidebarFooterItems } from '../nav'
import { accountHandle, accountInitials, accountName } from '../accountName'
import ReportBugDialog from './ReportBugDialog'

// One destination in the navigation column. The icon sits in its own tile so a
// row reads as icon + word at a glance, and the active row is a filled plate
// rather than a change of text colour alone — the current page must survive a
// glance from across the desk.
function NavItem({ item, collapsed, badge, locked }) {
  const { t } = useI18n()
  const Icon = item.icon

  // A destination can also be an action: "Report a bug" opens its dialog in
  // place, so reporting a problem never swaps the page out from under you.
  if (item.onSelect) {
    return (
      <button
        type="button"
        onClick={item.onSelect}
        title={collapsed ? item.label : undefined}
        className={[
          'motion-nav group relative flex items-center gap-2 rounded-[5px] text-[12.5px] text-ink-2 hover:bg-surface-muted hover:text-ink',
          collapsed ? 'mx-auto h-8 w-8 justify-center' : 'h-9 pe-2 ps-1.5'
        ].join(' ')}
      >
        <span className="grid h-[23px] w-[23px] shrink-0 place-items-center rounded-[4px] text-ink-3 transition-colors group-hover:text-ink-2">
          <Icon size={collapsed ? 15 : 14} strokeWidth={1.8} className="shrink-0" />
        </span>
        {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      </button>
    )
  }

  const rowClass = (isActive) =>
    [
      'motion-nav group relative flex items-center gap-2 rounded-[5px] text-[12.5px] outline-offset-1',
      collapsed ? 'mx-auto h-8 w-8 justify-center' : 'h-9 pe-2 ps-1.5',
      isActive
        ? 'bg-selection font-medium text-ink ring-1 ring-inset ring-jade-500/25'
        : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
    ].join(' ')

  return (
    <NavLink
      to={item.to}
      end={item.end}
      aria-label={locked ? `${item.label} — locked` : undefined}
      title={locked ? `${item.label} — locked` : collapsed ? item.label : undefined}
      className={({ isActive }) => rowClass(isActive)}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden="true"
              className="motion-nav-marker absolute inset-y-1.5 start-0 w-[2px] rounded-full"
              style={{ background: 'var(--color-jade-500)' }}
            />
          )}
          <span
            className={`grid shrink-0 place-items-center rounded-[4px] transition-colors ${
              collapsed ? 'h-8 w-8' : 'h-[23px] w-[23px]'
            } ${isActive ? 'text-jade-500' : 'text-ink-3 group-hover:text-ink-2'}`}
          >
            <Icon size={collapsed ? 15 : 14} strokeWidth={1.8} className="shrink-0" />
          </span>
          {collapsed ? (
            <span className="sr-only">
              {badge > 0 ? `${item.label} — ${badge} ${t('unread')}` : item.label}
            </span>
          ) : (
            <span className="truncate">{item.label}</span>
          )}
          {!collapsed && locked && (
            <Lock size={11} strokeWidth={2} className="shrink-0 text-ink-3" aria-hidden="true" />
          )}
          {!collapsed && badge > 0 && (
            <span
              key={badge}
              className="motion-badge mono ms-auto min-w-[1.15rem] rounded-[4px] bg-ember-solid px-1 text-center text-[9.5px] font-semibold leading-[1.1rem] text-on-ember"
            >
              {badge > 99 ? '99+' : badge}
            </span>
          )}
          {collapsed && locked && (
            <Lock
              size={8}
              strokeWidth={2.5}
              className="absolute end-0 top-0 text-ink-3"
              aria-hidden="true"
            />
          )}
          {collapsed && !locked && badge > 0 && (
            <span
              key={badge}
              className="motion-badge absolute end-0.5 top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-[var(--color-sunken)]"
              style={{ background: 'var(--color-ember-solid)' }}
            />
          )}
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar({ user, onLogout, onOpenCommand, isOnline, collapsed = false, lockedRoutes }) {
  const { t } = useI18n()
  const [badges, setBadges] = useState({ inbox: 0, direct: 0, library: 0 })
  const [openGroups, setOpenGroups] = useState({})
  const [bugOpen, setBugOpen] = useState(false)

  const nav = buildNav(user)
  const isStaff = user?.roles?.some((role) => ['ADMIN', 'SECRETARY', 'DIRECTOR', 'TEACHER'].includes(role))
  // The Library badge is the administrator's review queue: submissions waiting
  // for a decision, counted by the same service the Library page uses.
  const isAdmin = !!user?.roles?.includes('ADMIN')

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const refresh = async () => {
      try {
        const [inbox, direct, library] = await Promise.all([
          isStaff ? window.api.getInboxUnreadCount(user.id) : Promise.resolve({ unread: 0 }),
          // A role locked out of direct messages is refused by the main
          // process; that must not blank the other two badges.
          window.api.getUnreadDirectCount(user.id).catch(() => ({ unread: 0 })),
          isAdmin ? window.api.getLibraryReviewCount(user.id) : Promise.resolve({ pending: 0 })
        ])
        if (cancelled) return
        setBadges({
          inbox: inbox?.unread || 0,
          direct: direct?.unread || 0,
          library: library?.pending || 0
        })
      } catch {
        /* badges are optional */
      }
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('inbox-updated', refresh)
    window.addEventListener('direct-messages-updated', refresh)
    // A review saved on the Library page changes the queue immediately.
    window.addEventListener('library-updated', refresh)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('inbox-updated', refresh)
      window.removeEventListener('direct-messages-updated', refresh)
      window.removeEventListener('library-updated', refresh)
    }
  }, [user?.id, isStaff, isAdmin])

  const groupOpen = (group) =>
    openGroups[group.id] === undefined ? group.open : openGroups[group.id]

  // Same label the account menu shows: the role word itself is translated.
  const roleLine = (user?.roles?.[0] || 'Member')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

  return (
    <aside
      className="flex h-full shrink-0 select-none flex-col border-e border-line"
      style={{
        width: collapsed ? 'var(--sidebar-w-rail)' : 'var(--sidebar-w)',
        // The column is recessed below the page surface: navigation reads as the
        // rail the content sits in front of, without an extra border or shadow.
        background: 'var(--color-sunken)',
        transition: 'width 160ms cubic-bezier(.2,.8,.2,1)'
      }}
      aria-label={t('Primary navigation')}
    >
      {/* Command surface */}
      <div className={collapsed ? 'mt-2 px-2' : 'mt-2.5 px-2.5'}>
        <button
          type="button"
          onClick={onOpenCommand}
          title={t('Search and commands')}
          className={`group flex items-center gap-2 rounded-[5px] border border-line bg-surface text-ink-3 transition-colors hover:border-line-strong hover:text-ink ${
            collapsed ? 'h-8 w-8 justify-center' : 'h-8 w-full px-2'
          }`}
        >
          <Search size={13} strokeWidth={1.8} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="truncate text-[12px]">{t('Find anyone or anything')}</span>
              <span className="kbd ms-auto shrink-0">
                <Command size={8} className="inline" /> K
              </span>
            </>
          )}
        </button>
      </div>

      {/* Destinations */}
      <nav className="mt-2 min-h-0 flex-1 overflow-y-auto pb-3">
        {nav.map((group) => {
          const open = groupOpen(group)
          return (
            <div key={group.id} className="mb-0.5">
              {collapsed ? (
                <div className="mx-3 my-2 h-px bg-line" />
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenGroups((current) => ({ ...current, [group.id]: !open }))}
                  aria-expanded={open}
                  className="sticky top-0 z-10 flex h-7 w-full items-center gap-2 bg-[var(--color-sunken)] px-3 text-ink-3 transition-colors hover:text-ink-2"
                >
                  <span className="kicker text-[9px] leading-none">{t(group.label)}</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-line" />
                  <ChevronDown
                    size={10}
                    strokeWidth={2}
                    className="shrink-0"
                    style={{
                      transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
                      transition: 'transform 140ms cubic-bezier(.2,.8,.2,1)'
                    }}
                  />
                </button>
              )}
              {open && (
                <div className={`anim-stagger ${collapsed ? 'flex flex-col items-center gap-0.5' : 'space-y-0.5 px-2'}`}>
                  {group.items.map((item) => (
                    <NavItem
                      key={item.to}
                      item={{
                        ...item,
                        label: t(item.label),
                        onSelect: item.to === '/report-bug' ? () => setBugOpen(true) : undefined
                      }}
                      collapsed={collapsed}
                      badge={item.badgeKey ? badges[item.badgeKey] : 0}
                      locked={!!lockedRoutes?.has(item.to)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Pinned screens and the account */}
      <div className="shrink-0 border-t border-line">
        <div className={collapsed ? 'flex flex-col items-center gap-0.5 py-1.5' : 'space-y-0.5 px-2 py-1.5'}>
          {sidebarFooterItems(user).map((item) => (
            <NavItem
              key={item.to}
              item={{ ...item, label: t(item.label) }}
              collapsed={collapsed}
              badge={item.badgeKey ? badges[item.badgeKey] || 0 : 0}
              locked={lockedRoutes?.has(item.to)}
            />
          ))}
        </div>

        <div className={`border-t border-line ${collapsed ? 'p-2' : 'p-2.5'}`}>
          <div
            className={`flex items-center gap-2 ${
              collapsed ? 'flex-col gap-1.5' : 'rounded-[5px] border border-line bg-surface px-2 py-1.5'
            }`}
          >
            <div className="relative shrink-0">
              <div
                className="grid h-6 w-6 place-items-center rounded-[4px] border border-line-strong bg-surface-muted text-[10px] font-semibold text-ink-2"
                aria-hidden="true"
              >
                {accountInitials(user)}
              </div>
              {/* Presence: the same signal the title bar shows when the network
                  drops, stated once more where the account itself sits. */}
              <span
                className={`absolute -bottom-0.5 -end-0.5 h-1.5 w-1.5 rounded-full ring-2 ${
                  collapsed ? 'ring-[var(--color-sunken)]' : 'ring-[var(--color-surface)]'
                }`}
                style={{ background: isOnline ? 'var(--color-success)' : 'var(--color-ink-3)' }}
                aria-hidden="true"
              />
            </div>
            {!collapsed && (
              // Who is signed in: the person's names, then the handle they sign
              // in with, marked with "@", followed by the role it grants.
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[11.5px] font-medium text-ink">
                  {accountName(user) || t('Unnamed account')}
                </div>
                <div className="flex min-w-0 items-baseline gap-1 truncate text-[10px] text-ink-3">
                  {user?.username && <span className="mono truncate">{accountHandle(user)}</span>}
                  {user?.username && <span aria-hidden="true">·</span>}
                  <span className="truncate capitalize">{t(roleLine)}</span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              title={t('Log out')}
              aria-label={t('Log out')}
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-[4px] text-ink-3 opacity-80 transition-colors hover:bg-danger-bg hover:text-danger-ink hover:opacity-100 ${
                collapsed ? '' : 'ms-auto'
              }`}
            >
              <LogOut size={13} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>

      <ReportBugDialog user={user} open={bugOpen} onClose={() => setBugOpen(false)} />
    </aside>
  )
}
