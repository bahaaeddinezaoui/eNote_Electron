import React, { useEffect, useState } from 'react'
import { formatDate, formatTime } from '../dateFormat'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, MessageSquare } from 'lucide-react'
import { tr, useI18n } from '../i18n'
import LockedNotice from './ui/LockedNotice'

// The title bar's messages shortcut. Closed, it only keeps the unread badge
// fresh; opened, it lists the five conversations with the most recent activity,
// each with its presence and unread count, and offers the way into the page. It
// reads the same service the Direct messages page does, so both always agree.
//
// When an administrator locks the Direct messages page, the shortcut stops
// being a window into that page: no badge, no thread previews and no traffic to
// the conversations service. The panel still opens, with the locked notice in
// place of the list, so the reason it is empty is on screen.

// A heartbeat keeps `last_seen_at` at most a minute old while the app is open,
// so anything inside this window is somebody who is actually there right now.
const ONLINE_WINDOW_MS = 2 * 60 * 1000
const PREVIEW_COUNT = 5

const nameOf = (row) =>
  [row?.OTHER_FIRST_NAME, row?.OTHER_LAST_NAME].filter(Boolean).join(' ') ||
  row?.OTHER_USERNAME ||
  tr('Unknown')

const isOnline = (lastSeenAt) => {
  const seen = Date.parse(lastSeenAt)
  return Number.isFinite(seen) && Date.now() - seen < ONLINE_WINDOW_MS
}

// Presence wording, the same thresholds the Direct messages page uses.
const presenceLabel = (lastSeenAt) => {
  const seen = Date.parse(lastSeenAt)
  if (!Number.isFinite(seen)) return tr('never seen')
  const diff = (Date.now() - seen) / 1000
  if (diff < 90) return tr('active just now')
  if (diff < 3600) return tr('active {count} min ago', { count: Math.max(1, Math.floor(diff / 60)) })
  if (diff < 86400) return tr('active {count} h ago', { count: Math.floor(diff / 3600) })
  if (diff < 7 * 86400) return tr('active {count} d ago', { count: Math.floor(diff / 86400) })
  return tr('last seen {date}', {
    date: formatDate(new Date(seen), { day: '2-digit', month: 'short', year: 'numeric' })
  })
}

const initialsOf = (name) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

// The time today, the day before: a glance at when the last message arrived.
const whenLabel = (value) => {
  const date = new Date(value)
  if (!value || isNaN(date.getTime())) return ''
  const today = new Date()
  return date.toDateString() === today.toDateString()
    ? formatTime(date, { hour: '2-digit', minute: '2-digit' })
    : formatDate(date, { day: '2-digit', month: 'short' })
}

const MessagesMenu = ({ user, active = false, locked = false }) => {
  const navigate = useNavigate()
  const { dir } = useI18n()
  const [open, setOpen] = useState(false)
  const [conversations, setConversations] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Unread badge: one slow poll, refreshed immediately whenever the messages
  // page reads or sends something.
  useEffect(() => {
    if (!user?.id || locked) return
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await window.api.getUnreadDirectCount(user.id)
        if (!cancelled) setUnread(res?.unread || 0)
      } catch {
        /* the badge is optional: the list still opens the page */
      }
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('direct-messages-updated', refresh)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('direct-messages-updated', refresh)
    }
  }, [user?.id, locked])

  // The conversations themselves are only read while the panel is open, and
  // never for a locked page.
  useEffect(() => {
    if (!open || locked) return
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await window.api.getDirectConversations(user.id)
        if (cancelled) return
        setConversations(res?.conversations || [])
        setError('')
      } catch (err) {
        if (!cancelled) setError(err.message || tr('Could not load your conversations.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    setLoading(true)
    refresh()
    const timer = setInterval(refresh, 30000)
    window.addEventListener('direct-messages-updated', refresh)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('direct-messages-updated', refresh)
    }
  }, [open, user.id, locked])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // The service already orders by latest activity, newest first.
  const preview = conversations.slice(0, PREVIEW_COUNT)
  // A locked page names itself and its state in the tooltip, matching the lock
  // mark the navigation gives it.
  const buttonLabel = locked
    ? `${tr('Direct messages')} — ${tr('locked')}`
    : unread > 0
      ? `${tr('Direct messages')} (${unread})`
      : tr('Direct messages')

  return (
    <div className="relative me-0.5">
      {open && <div className="fixed inset-0 z-30 bg-transparent" onClick={() => setOpen(false)} />}

      {open && (
        <div
          role="dialog"
          aria-label={tr('Direct messages')}
          // Anchored to the side the shortcut sits on in this language, so the
          // panel always opens inwards instead of off the window edge.
          dir={dir}
          className={`absolute top-[calc(100%+6px)] z-40 w-[23rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-md border border-line-strong bg-raised anim-plate ${
            dir === 'rtl' ? 'start-0' : 'end-0'
          }`}
          style={{ boxShadow: 'var(--shadow-e3)' }}
        >
          <div className="flex h-10 items-center gap-2 border-b border-line px-3.5">
            <MessageSquare size={13} style={{ color: 'var(--color-jade-600)' }} />
            <span className="text-[12px] font-semibold text-ink">{tr('Direct messages')}</span>
            {!locked && (
              <span className="mono text-[10px] text-ink-3">
                {unread} {tr('unread')}
              </span>
            )}
          </div>

          <div className="max-h-[55vh] divide-y divide-line overflow-y-auto">
            {locked ? (
              <LockedNotice />
            ) : loading ? (
              <p className="p-6 text-center text-[11px] text-ink-3">{tr('Loading conversations...')}</p>
            ) : error ? (
              <p className="p-6 text-center text-[11px]" style={{ color: 'var(--color-danger-ink)' }}>{error}</p>
            ) : preview.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare size={20} className="mx-auto text-ink-3" />
                <p className="mt-2 text-[11px] text-ink-3">{tr('No conversations yet.')}</p>
              </div>
            ) : (
              preview.map((conversation) => {
                const name = nameOf(conversation)
                const online = isOnline(conversation.OTHER_LAST_SEEN_AT)
                const count = conversation.UNREAD_COUNT || 0
                return (
                  <button
                    key={conversation.CONVERSATION_ID}
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      navigate(`/messages?conversation=${conversation.CONVERSATION_ID}`)
                    }}
                    className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-start ${
                      count > 0 ? 'bg-selection' : 'bg-surface hover:bg-surface-muted'
                    }`}
                  >
                    <span className="relative mt-px grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-strong text-[9.5px] font-semibold text-ink-2">
                      {initialsOf(name)}
                      {online && (
                        <span
                          aria-hidden="true"
                          className="absolute -bottom-0.5 -end-0.5 h-[7px] w-[7px] rounded-full"
                          style={{ background: 'var(--color-success)', boxShadow: '0 0 0 2px var(--color-surface)' }}
                        />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className={`truncate text-[11.5px] text-ink ${count > 0 ? 'font-semibold' : ''}`}>
                          {name}
                        </span>
                        <span className="mono ms-auto shrink-0 text-[8.5px] text-ink-3">
                          {whenLabel(conversation.LAST_AT || conversation.LAST_MESSAGE_AT || conversation.CREATED_AT)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-ink-2">
                        {conversation.LAST_BODY || tr('No messages yet')}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-ink-3">
                        <span
                          aria-hidden="true"
                          className="h-[5px] w-[5px] shrink-0 rounded-full"
                          style={{ background: online ? 'var(--color-success)' : 'var(--color-line-strong)' }}
                        />
                        <span className="mono truncate">{presenceLabel(conversation.OTHER_LAST_SEEN_AT)}</span>
                        {count > 0 && (
                          <span
                            className="mono ms-auto shrink-0 rounded-full px-1.5 py-px text-[8.5px] font-semibold leading-none"
                            style={{ background: 'var(--color-ember-solid)', color: 'var(--color-on-ember)' }}
                          >
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false)
              navigate('/messages')
            }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-[11px] font-medium text-jade-600 hover:bg-surface-muted"
          >
            {tr('Open direct messages page')} <ArrowRight size={11} className="rtl:rotate-180" />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-current={active ? 'page' : undefined}
        className={`relative grid h-8 w-8 place-items-center rounded-[3px] ${
          active ? 'bg-selection text-ink' : 'text-ink-3 hover:bg-surface-muted hover:text-ink'
        }`}
      >
        <MessageSquare size={15} strokeWidth={1.75} />
        {!locked && unread > 0 && (
          <span
            className="mono absolute -end-0.5 -top-0.5 grid h-[13px] min-w-[13px] place-items-center rounded-full px-[3px] text-[8.5px] font-semibold leading-none"
            style={{ background: 'var(--color-ember-solid)', color: 'var(--color-on-ember)' }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    </div>
  )
}

export default MessagesMenu
