import React, { useEffect, useRef, useState } from 'react'
import { formatDate } from '../dateFormat'
import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, CheckCheck, Inbox, ArrowRight } from 'lucide-react'
import { tr, useI18n } from '../i18n'
import LockedNotice from './ui/LockedNotice'
import { playNotificationSound } from '../notificationSound'
import {
  isMessageNotification,
  isSessionNotification,
  notificationKind,
  notificationTarget
} from '../notificationKinds'

// Floating bell for every signed-in account. Directors and administrators see
// every absence, observation and missed class, teachers their own missed
// classes, and everybody — students included — the inbox mail and direct
// messages addressed to them. It is a shortcut into the notifications store: the
// unread count comes from the same service as the page, and a new event pushed
// by the database refreshes it immediately (with a slow poll as a fallback for a
// dropped LISTEN connection).
//
// When an administrator locks the Notifications page, the bell stops being a
// window into that page: no badge, no previews, no chime and no popup. The panel
// still opens, with the locked notice in place of the list, so the reason it is
// empty is on screen.

const fmtWhen = (n) => {
  const date = n?.EVENT_DATE
  const time = n?.START_TIME
  if (!date && !n?.CREATED_AT) return ''
  const d = new Date(n.EVENT_AT || n.CREATED_AT || date)
  const day = isNaN(d.getTime()) ? String(date || '') : formatDate(d)
  return [day, time].filter(Boolean).join(' · ')
}

// One line of context for the operating-system notification: the same details
// the page shows — what it is, where, from whom, and when.
const recordDetail = (n) => {
  if (isMessageNotification(n.RECORD_TYPE)) {
    // The title already names the sender, so the line carries what arrived: the
    // mail's own opening words, or plainly that a message was sent. A direct
    // message's text is encrypted at rest and never reaches this payload.
    return [
      n.RECORD_TYPE === 'DIRECT_MESSAGE'
        ? tr('Sent you a direct message')
        : n.MESSAGE_EXCERPT,
      fmtWhen(n)
    ].filter(Boolean).join(' · ')
  }
  // Everything that is not a student record or a session carries its own line of
  // context already built by the database ("CA1 · DVR · Computer Science 1 ·
  // ended 2026-10-29 · 3 day(s) ago"), which is exactly what the popup needs.
  if (n.RECORD_TYPE !== 'ABSENCE' && n.RECORD_TYPE !== 'OBSERVATION' && !isSessionNotification(n.RECORD_TYPE)) {
    return [n.BODY, fmtWhen(n)].filter(Boolean).join(' · ')
  }

  return [
    n.RECORD_TYPE === 'ABSENCE'
      ? n.ABSENCE_JUSTIFICATION_LABEL
      : isSessionNotification(n.RECORD_TYPE)
        ? tr(n.STUDY_SESSION_TYPE_LABEL)
        : n.OBSERVATION_MOTIF_LABEL,
    n.SECTION_LABEL,
    n.MAJOR_LABEL,
    n.CLASSROOM_LABEL,
    isSessionNotification(n.RECORD_TYPE) ? '' : n.INSTRUCTOR_NAME,
    fmtWhen(n)
  ]
    .filter(Boolean)
    .join(' · ')
}

const DirectorNotificationFab = ({ user, locked = false }) => {
  const navigate = useNavigate()
  const { dir } = useI18n()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The bell is the one component mounted on every page for every role that can
  // receive notifications, so it also owns the chime: a rise in this account's
  // unread count rings once, whether the rise came from a live event or the slow
  // fallback poll. The first read only establishes the baseline, so opening the
  // app with unread items does not make a noise.
  const lastUnreadRef = useRef(null)

  // The same rise also raises an operating-system notification, so an event is
  // seen even when the window is behind another application. Records already
  // known to this session are what makes that possible: the first read only
  // fills the set, so signing in does not replay yesterday's unread items.
  const seenRecordsRef = useRef(null)

  const announce = (fresh) => {
    const newest = fresh[0]
    const who = newest.STUDENT_NAME || newest.INSTRUCTOR_NAME || newest.SENDER_NAME || newest.TITLE || ''
    // The heading is the name the bell sets in bold and the kind is the small
    // label beside it, so the popup keeps the same order: who, what happened,
    // which kind of record.
    const kindLabel = tr(notificationKind(newest.RECORD_TYPE).label)
    const title = fresh.length > 1
      ? `${tr('Notifications')} · ${fresh.length}`
      : who || kindLabel
    try {
      window.api.showDesktopNotification?.({
        title,
        body: recordDetail(newest),
        kind: kindLabel,
        recordKey: newest.RECORD_KEY
      })?.catch?.(() => {})
    } catch {
      // A refused or unsupported popup must never affect the bell itself.
    }
  }

  const refresh = async () => {
    try {
      const res = await window.api.getNotifications(user.id)
      const list = res?.notifications || []
      const nextUnread = res?.unreadCount || 0

      // A muted family is silent here: no row, no chime, no popup. The rows are
      // still on the notifications page, marked, so nothing disappears.
      const audible = list.filter(n => !n.MUTED)

      const seen = seenRecordsRef.current
      const fresh = seen ? audible.filter(n => !n.IS_READ && !seen.has(n.RECORD_KEY)) : []

      // The chime belongs to the kind of the newest arrival: a message, a missed
      // class and an account alert each sound like themselves.
      if (lastUnreadRef.current !== null && nextUnread > lastUnreadRef.current) {
        playNotificationSound((fresh[0] || list[0])?.RECORD_TYPE)
      }
      lastUnreadRef.current = nextUnread

      if (fresh.length > 0) announce(fresh)
      seenRecordsRef.current = new Set(list.map(n => n.RECORD_KEY))

      setNotifications(audible)
      setUnreadCount(nextUnread)
      setError('')
    } catch (err) {
      setError(err.message || tr('Could not load notifications.'))
    } finally {
      setLoading(false)
    }
  }

  const refreshRef = useRef(() => {})
  refreshRef.current = refresh

  useEffect(() => {
    if (locked) return
    refresh()
    const timer = setInterval(() => refreshRef.current(), 60000)
    const unsubscribe = window.api.onNotificationsChanged?.(() => refreshRef.current())
    return () => {
      clearInterval(timer)
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [user.id, locked])

  useEffect(() => {
    if (open && !locked) refresh()
  }, [open, locked])

  // Escape closes the panel wherever focus happens to be, so the bell behaves
  // like the rest of the title bar's surfaces.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Clicking the operating-system notification brings the window forward (the
  // main process does that) and lands on the record it was about.
  useEffect(() => {
    const unsubscribe = window.api.onNotificationOpen?.(({ recordKey }) => {
      navigate(recordKey ? `/notifications?focus=${encodeURIComponent(recordKey)}` : '/notifications')
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [navigate])

  const openNotification = async (n) => {
    setOpen(false)
    if (!n.IS_READ) {
      setNotifications(list => list.map(x => (x.RECORD_KEY === n.RECORD_KEY ? { ...x, IS_READ: true } : x)))
      setUnreadCount(c => Math.max(0, c - 1))
      // Keep the chime's baseline in step with the local change, so the next
      // refresh compares against the real count rather than a stale one.
      if (lastUnreadRef.current !== null) lastUnreadRef.current = Math.max(0, lastUnreadRef.current - 1)
      window.api.markNotificationRead(user.id, n.RECORD_KEY).catch(() => {})
    }
    // A message opens where the message is; a record opens on its own page.
    navigate(notificationTarget(n.RECORD_TYPE, n.RECORD_KEY))
  }

  const markAll = async () => {
    try {
      await window.api.markAllNotificationsRead(user.id)
      setNotifications(list => list.map(n => ({ ...n, IS_READ: true })))
      setUnreadCount(0)
      lastUnreadRef.current = 0
    } catch (err) {
      setError(err.message || tr('Could not mark all as read.'))
    }
  }

  // A locked page names itself and its state in the tooltip, matching the lock
  // mark the navigation gives it.
  const buttonLabel = locked
    ? `${tr('Notifications')} — ${tr('locked')}`
    : unreadCount > 0
      ? `${tr('Notifications')} (${unreadCount})`
      : tr('Notifications')

  // Unread first, then newest — a glance, not the full page.
  const preview = [...notifications]
    .sort((a, b) => {
      if (a.IS_READ !== b.IS_READ) return a.IS_READ ? 1 : -1
      return (Date.parse(b.CREATED_AT) || 0) - (Date.parse(a.CREATED_AT) || 0)
    })
    .slice(0, 8)

  // The trigger sits in the title bar, so the panel hangs from it rather than
  // from a corner of the window: `end-0` puts its edge under the button and it
  // opens towards the middle of the strip.
  return (
    <div className="relative">
      {open && <div className="fixed inset-0 z-30 bg-transparent" onClick={() => setOpen(false)} />}

      {open && (
        <div
          // Hangs from the bell towards the middle of the strip: the bell sits at
          // the end of the bar in English and at the start in Arabic.
          dir={dir}
          className={`absolute top-[calc(100%+6px)] z-40 w-[23rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-md border border-line-strong bg-raised anim-plate ${
            dir === 'rtl' ? 'start-0' : 'end-0'
          }`}
          style={{ boxShadow: 'var(--shadow-e3)' }}
        >
          <div className="flex h-10 items-center gap-2 border-b border-line px-3.5">
            <BellRing size={13} style={{ color: 'var(--color-jade-600)' }} />
            <span className="text-[12px] font-semibold text-ink">{tr('Notifications')}</span>
            {!locked && (
              <span className="mono text-[10px] text-ink-3">
                {unreadCount} {tr('unread')}
              </span>
            )}
            {!locked && (
              <button
                type="button"
                onClick={markAll}
                disabled={unreadCount === 0}
                title={tr('Mark all as read')}
                className="mono ms-auto inline-flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCheck size={12} /> {tr('Mark all')}
              </button>
            )}
          </div>

          <div className="max-h-[55vh] divide-y divide-line overflow-y-auto">
            {locked ? (
              <LockedNotice />
            ) : loading ? (
              <p className="p-6 text-center text-[11px] text-ink-3">{tr('Loading notifications…')}</p>
            ) : error ? (
              <p className="p-6 text-center text-[11px]" style={{ color: 'var(--color-danger-ink)' }}>{error}</p>
            ) : preview.length === 0 ? (
              <div className="p-8 text-center">
                <Inbox size={20} className="mx-auto text-ink-3" />
                <p className="mt-2 text-[11px] text-ink-3">{tr('No notifications yet.')}</p>
              </div>
            ) : (
              preview.map(n => {
                const isMessage = isMessageNotification(n.RECORD_TYPE)
                const isLibrary = n.RECORD_TYPE === 'LIBRARY_REVIEW' || n.RECORD_TYPE === 'LIBRARY_REVIEW_REQUEST'
                const kind = notificationKind(n.RECORD_TYPE)
                const KindIcon = kind.icon
                return (
                  <button
                    key={n.RECORD_KEY}
                    type="button"
                    onClick={() => openNotification(n)}
                    className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-start ${
                      n.IS_READ ? 'bg-surface hover:bg-surface-muted' : 'bg-selection hover:bg-selection'
                    }`}
                  >
                    <span
                      className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded-[3px] border"
                      style={{ borderColor: kind.border, background: kind.background, color: kind.color }}
                    >
                      <KindIcon size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {!n.IS_READ && <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: 'var(--color-ember-solid)' }} />}
                        <span className={`truncate text-[11.5px] ${n.IS_READ ? 'text-ink' : 'font-semibold text-ink'}`}>
                          {isLibrary
                            ? (n.DOCUMENT_LABEL || tr('Library document'))
                            : (n.STUDENT_NAME || n.INSTRUCTOR_NAME || n.SENDER_NAME || n.TITLE)}
                        </span>
                        <span className="mono ms-auto shrink-0 text-[8.5px] uppercase tracking-[0.06em] text-ink-3">
                          {tr(kind.label)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-ink-2">
                        {isMessage ? (
                          <>
                            {n.SENDER_NAME || tr('Message')}
                            {n.MESSAGE_EXCERPT ? ` · ${n.MESSAGE_EXCERPT}` : ''}
                          </>
                        ) : (
                          <>
                            {isLibrary ? (
                              <>
                                {n.RECORD_TYPE === 'LIBRARY_REVIEW_REQUEST'
                                  ? tr('Waiting for review')
                                  : n.RECORD_STATUS === 'PUBLISHED'
                                    ? tr('Published')
                                    : n.RECORD_STATUS === 'REJECTED'
                                      ? tr('Rejected')
                                      : ''}
                                {n.RECORD_NOTE ? ` · ${n.RECORD_NOTE}` : ''}
                              </>
                            ) : n.RECORD_TYPE === 'ABSENCE'
                              ? n.ABSENCE_JUSTIFICATION_LABEL
                              : isSessionNotification(n.RECORD_TYPE)
                                ? tr(n.STUDY_SESSION_TYPE_LABEL)
                                : n.OBSERVATION_MOTIF_LABEL}
                            {n.SECTION_LABEL ? ` · ${n.SECTION_LABEL}` : ''}
                            {n.MAJOR_LABEL ? ` · ${n.MAJOR_LABEL}` : ''}
                          </>
                        )}
                      </span>
                      <span className="mono mt-0.5 block truncate text-[9.5px] text-ink-3">{fmtWhen(n)}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); navigate('/notifications') }}
            className="flex w-full items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-[11px] font-medium text-jade-600 hover:bg-surface-muted"
          >
            {tr('Open notifications page')} <ArrowRight size={11} className="rtl:rotate-180" />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`relative grid h-7 w-7 place-items-center rounded-[3px] hover:bg-surface-muted ${
          !locked && unreadCount > 0 ? 'text-ink' : 'text-ink-3 hover:text-ink'
        }`}
        title={buttonLabel}
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {!locked && unreadCount > 0 ? <BellRing size={15} strokeWidth={1.75} /> : <Bell size={15} strokeWidth={1.75} />}
        {!locked && unreadCount > 0 && (
          <span
            className="mono absolute -top-1 -end-1.5 grid h-[15px] min-w-[15px] place-items-center rounded-full px-1 text-[8.5px] font-semibold leading-none"
            style={{ background: 'var(--color-ember-solid)', color: 'var(--color-on-ember)' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  )
}

export default DirectorNotificationFab
