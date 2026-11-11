import React, { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate, formatDateTime } from '../dateFormat'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CheckCheck, Calendar, Clock, MapPin, Users,
  MessageSquare, Send, Trash2, ChevronDown, Inbox, AlertCircle, UserRound, Tag,
  Check, ArrowRight
} from 'lucide-react'
import { PageHeader } from './ui/PageHeader'
import Notice from './ui/Notice'
import PhotoZoom from './ui/PhotoZoom'
import ListError from './ui/ListError'
import { tr } from '../i18n'
import { initialsOfName, usePersonPhotos } from '../personPhotos'
import {
  NOTIFICATION_GROUPS,
  groupOf,
  isCommentableNotification,
  isMessageNotification,
  isSessionNotification,
  notificationKind,
  notificationTarget
} from '../notificationKinds'

// Notifications for the signed-in account. Every row comes from the
// app_notification store and is addressed to a role — sometimes narrowed to one
// person — so the same page serves every kind: absences and observations for
// directors, and a teacher's own missed classes for the teacher (directors and
// administrators see every missed class). A new event arrives live over
// LISTEN/NOTIFY, and the page also re-reads when it is opened.

const fmtDate = (v) => {
  if (!v) return '—'
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return formatDate(new Date(+m[1], +m[2] - 1, +m[3]), { day: '2-digit', month: 'short', year: 'numeric' })
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : formatDate(d)
}

const fmtClock = (v) => {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? String(v) : formatDateTime(d)
}

// One tab per family of notifications rather than one per kind: nineteen kinds
// would be nineteen buttons. The families come from notificationKinds.jsx, so a
// new kind lands in its family without touching this page.
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  ...NOTIFICATION_GROUPS
]

const REMINDER = 'TEACHER_REMINDER'

const Notifications = ({ user }) => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState(null)
  const [tab, setTab] = useState('all')
  const [expandedKey, setExpandedKey] = useState(searchParams.get('focus') || '')
  const [comments, setComments] = useState({})
  const [commentsLoading, setCommentsLoading] = useState({})
  const [drafts, setDrafts] = useState({})
  const [postingKey, setPostingKey] = useState('')
  const [savingAll, setSavingAll] = useState(false)
  const [confirmingKey, setConfirmingKey] = useState('')

  // Commenting stays a director feature (the service re-checks the role).
  const canComment = !!user?.roles?.includes('DIRECTOR')

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true)
    setLoadError('')
    try {
      const res = await window.api.getNotifications(user.id)
      setNotifications(res?.notifications || [])
      setUnreadCount(res?.unreadCount || 0)
    } catch (err) {
      setLoadError(err.message || tr('Failed to load notifications.'))
      setNotice({ type: 'error', text: err.message || tr('Failed to load notifications.') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Live: the main process relays the database's NOTIFY.
  const reloadRef = useRef(() => {})
  reloadRef.current = () => load(true)
  useEffect(() => {
    const unsubscribe = window.api.onNotificationsChanged?.(() => reloadRef.current())
    return () => { if (typeof unsubscribe === 'function') unsubscribe() }
  }, [])

  useEffect(() => {
    const focus = searchParams.get('focus')
    if (focus) setExpandedKey(focus)
  }, [searchParams])

  // Opening a notification from the bell deep-links to it already expanded, so
  // its comments (and its read state) have to be fetched without a click.
  useEffect(() => {
    if (!expandedKey) return
    const target = notifications.find(n => n.RECORD_KEY === expandedKey)
    if (target && !isMessageNotification(target.RECORD_TYPE) && !isSessionNotification(target.RECORD_TYPE) && canComment && !comments[expandedKey]) loadComments(expandedKey)
    if (target && !target.IS_READ) markRead(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedKey])

  const loadComments = async (key) => {
    setCommentsLoading(c => ({ ...c, [key]: true }))
    try {
      const res = await window.api.getNotificationComments(user.id, key)
      setComments(c => ({ ...c, [key]: res?.data || [] }))
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to load comments.') })
    } finally {
      setCommentsLoading(c => ({ ...c, [key]: false }))
    }
  }

  const markRead = async (notification) => {
    if (notification.IS_READ) return
    setNotifications(list => list.map(n =>
      n.RECORD_KEY === notification.RECORD_KEY ? { ...n, IS_READ: true } : n
    ))
    setUnreadCount(c => Math.max(0, c - 1))
    try {
      const res = await window.api.markNotificationRead(user.id, notification.RECORD_KEY)
      // Offline the read cannot be recorded on the server. The page keeps what it
      // is showing, but says the change was not saved instead of pretending it
      // was.
      if (res?.offline) {
        setNotice({
          type: 'error',
          text: tr('The server is unreachable. You can read what is saved on this computer, but changes cannot be saved until it is back.')
        })
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to mark the notification as read.') })
    }
  }

  const toggle = async (notification) => {
    const key = notification.RECORD_KEY

    // A message is not a record with comments: opening it goes to the message.
    if (isMessageNotification(notification.RECORD_TYPE)) {
      await markRead(notification)
      navigate(notificationTarget(notification.RECORD_TYPE, key))
      return
    }

    if (expandedKey === key) {
      setExpandedKey('')
      setSearchParams({}, { replace: true })
      return
    }
    setExpandedKey(key)
    setSearchParams({ focus: key }, { replace: true })
    await markRead(notification)
    if (!isSessionNotification(notification.RECORD_TYPE) && canComment && !comments[key]) await loadComments(key)
  }

  // "The class was held, I simply had nothing to record." Only the teacher the
  // session belongs to (or an administrator) is allowed; the service verifies it
  // and the register trigger drops the alarm from everyone's feed.
  const confirmSession = async (notification) => {
    const sessionId = notification.STUDY_SESSION_ID
      || parseInt(String(notification.RECORD_KEY).split(':')[1], 10)
    if (!sessionId) return
    setConfirmingKey(notification.RECORD_KEY)
    try {
      await window.api.markSessionAttended(user.id, sessionId)
      setNotifications(list => list.filter(n => n.RECORD_KEY !== notification.RECORD_KEY))
      setExpandedKey('')
      setNotice({ type: 'success', text: tr('Session confirmed as held.') })
      await load(true)
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to confirm the session.') })
    } finally {
      setConfirmingKey('')
    }
  }

  const handleMarkAll = async () => {
    setSavingAll(true)
    try {
      const res = await window.api.markAllNotificationsRead(user.id)
      setNotifications(list => list.map(n => ({ ...n, IS_READ: true })))
      setUnreadCount(0)
      setNotice(
        res?.offline
          ? {
              type: 'error',
              text: tr('The server is unreachable. You can read what is saved on this computer, but changes cannot be saved until it is back.')
            }
          : { type: 'success', text: tr('Everything is marked as read.') }
      )
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to mark all notifications as read.') })
    } finally {
      setSavingAll(false)
    }
  }

  const handlePost = async (notification) => {
    const key = notification.RECORD_KEY
    const text = (drafts[key] || '').trim()
    if (!text) return
    setPostingKey(key)
    try {
      const res = await window.api.addNotificationComment(user.id, key, text)
      setDrafts(d => ({ ...d, [key]: '' }))
      setNotifications(list => list.map(n =>
        n.RECORD_KEY === key ? { ...n, COMMENT_COUNT: (n.COMMENT_COUNT || 0) + 1 } : n
      ))
      // A queued comment is not on the server yet, so re-reading the list would
      // only drop it from view. It goes out with the rest of the queue.
      if (res?.queued) {
        setNotice({
          type: 'success',
          text: tr('Saved on this computer. It will be sent when the server is back.')
        })
      } else {
        await loadComments(key)
      }
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to post the comment.') })
    } finally {
      setPostingKey('')
    }
  }

  const handleDeleteComment = async (notification, comment) => {
    const key = notification.RECORD_KEY
    try {
      await window.api.deleteNotificationComment(user.id, comment.DIRECTOR_COMMENT_ID)
      setComments(c => ({ ...c, [key]: (c[key] || []).filter(x => x.DIRECTOR_COMMENT_ID !== comment.DIRECTOR_COMMENT_ID) }))
      setNotifications(list => list.map(n =>
        n.RECORD_KEY === key ? { ...n, COMMENT_COUNT: Math.max(0, (n.COMMENT_COUNT || 0) - 1) } : n
      ))
    } catch (err) {
      setNotice({ type: 'error', text: err.message || tr('Failed to delete the comment.') })
    }
  }

  const counts = useMemo(() => {
    const byFamily = Object.fromEntries(
      NOTIFICATION_GROUPS.map(group => [group.id, notifications.filter(n => groupOf(n.RECORD_TYPE) === group.id).length])
    )
    return {
      ...byFamily,
      all: notifications.length,
      unread: notifications.filter(n => !n.IS_READ).length
    }
  }, [notifications])

  const visible = useMemo(() => {
    if (tab === 'all') return notifications
    if (tab === 'unread') return notifications.filter(n => !n.IS_READ)
    return notifications.filter(n => groupOf(n.RECORD_TYPE) === tab)
  }, [notifications, tab])

  // A notification about a student shows that student's face; the rows are
  // read in one batch and cached by person id, so re-filtering costs nothing
  // and an account without a photo keeps its monogram.
  const studentPhotos = usePersonPhotos(useMemo(
    () => visible.map((n) => ({ PERSON_ID: n.PERSON_ID, PERSON_PHOTO: n.STUDENT_PHOTO })),
    [visible]
  ))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <PageHeader
        kicker={tr('Signals')}
        title={tr('Notifications')}
        meta={`${unreadCount} ${tr('unread')}`}
        actions={
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={savingAll || unreadCount === 0}
            className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong px-2.5 text-[11px] font-medium text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCheck size={12} /> {savingAll ? tr('Marking…') : tr('Mark all read')}
          </button>
        }
      />

      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-surface px-5 py-2">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`inline-flex h-7 items-center gap-1.5 rounded-[4px] border px-2.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'border-transparent text-on-jade'
                  : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted'
              }`}
              style={active ? { background: 'var(--color-jade-solid)' } : undefined}
            >
              {tr(t.label)}
              <span className={`mono text-[10px] ${active ? 'opacity-75' : 'text-ink-3'}`}>
                {counts[t.id] || 0}
              </span>
            </button>
          )
        })}
        <span className="mono ms-auto text-[10px] text-ink-3">
          {tr('Live · updates as records are entered')}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        {loadError ? (
          <div className="p-3">
            <ListError label={tr('Could not load this list')} detail={loadError} onRetry={() => load()} />
          </div>
        ) : loading ? (
          <div className="space-y-2 p-5" role="status" aria-label={tr('Loading notifications')}>
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-16 rounded-md bg-surface-muted" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
            <Inbox size={22} className="text-ink-3" />
            <h2 className="serif mt-3 text-[22px] leading-tight text-ink">
              {tab === 'unread' ? tr('Nothing unread.') : tr('No notifications yet.')}
            </h2>
            <p className="mt-1.5 max-w-sm text-[11.5px] leading-relaxed text-ink-3">
              {tr('Absences and observations recorded by teachers arrive here the moment they are saved.')}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map(n => {
              const isAbsence = n.RECORD_TYPE === 'ABSENCE'
              const isReminder = n.RECORD_TYPE === REMINDER
              const isSession = isSessionNotification(n.RECORD_TYPE)
              const isCommentable = isCommentableNotification(n.RECORD_TYPE)
              const isMessage = isMessageNotification(n.RECORD_TYPE)
              const isLibrary = n.RECORD_TYPE === 'LIBRARY_REVIEW' || n.RECORD_TYPE === 'LIBRARY_REVIEW_REQUEST'
              const kind = notificationKind(n.RECORD_TYPE)
              const KindIcon = kind.icon
              const key = n.RECORD_KEY
              const expanded = expandedKey === key
              const list = comments[key] || []
              const slot = [n.START_TIME, n.END_TIME].filter(Boolean).join(' – ')
              // Both session kinds are answered the same way: the teacher (or an
              // administrator) confirms the class was held, which writes the
              // register row and withdraws the reminder or the alarm.
              const mayConfirm = isSession && (
                n.AUDIENCE_PERSON_ID === user.personId ||
                user.roles?.includes('ADMIN') ||
                user.roles?.includes('DIRECTOR')
              )
              return (
                <li
                  key={key}
                  id={`notification-${key}`}
                  className={n.IS_READ ? 'bg-surface' : 'bg-selection/60'}
                  style={!n.IS_READ ? { boxShadow: 'inset 2px 0 0 var(--color-ember-solid)' } : undefined}
                >
                  <button
                    type="button"
                    onClick={() => toggle(n)}
                    className="flex w-full items-start gap-3 px-5 py-3 text-start hover:bg-surface-muted"
                    aria-expanded={expanded}
                  >
                    <span
                      className="mt-px grid h-7 w-7 shrink-0 place-items-center rounded-[3px] border"
                      style={{ borderColor: kind.border, background: kind.background, color: kind.color }}
                    >
                      <KindIcon size={13} />
                    </span>

                    {n.PERSON_ID && (
                      <span
                        className="mono mt-px grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-[3px] border border-line-strong text-[14px] leading-none text-ink-3"
                        aria-hidden="true"
                      >
                        {studentPhotos[Number(n.PERSON_ID)]
                          ? <PhotoZoom src={studentPhotos[Number(n.PERSON_ID)]} alt={n.STUDENT_NAME || ''} />
                          : (initialsOfName(n.STUDENT_NAME) || <UserRound size={14} />)}
                      </span>
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className="mono text-[9.5px] uppercase tracking-[0.08em]"
                          style={{ color: kind.text }}
                        >
                          {tr(kind.label)}
                        </span>
                        {!n.IS_READ && (
                          <span className="mono border px-1 text-[8.5px] uppercase tracking-[0.06em]"
                            style={{ borderColor: 'var(--color-ember-500)', color: 'var(--color-ember-600)' }}>
                            {tr('New')}
                          </span>
                        )}
                        {n.MUTED && (
                          <span
                            className="mono border border-line-strong px-1 text-[8.5px] uppercase tracking-[0.06em] text-ink-3"
                            title={tr('This family is muted in Settings: the notification is listed here but never rings.')}
                          >
                            {tr('Muted')}
                          </span>
                        )}
                        <span className={`truncate text-[13px] ${n.IS_READ ? 'text-ink' : 'font-semibold text-ink'}`}>
                          {isLibrary
                            ? (n.DOCUMENT_LABEL || tr('Library document'))
                            : (n.STUDENT_NAME || n.INSTRUCTOR_NAME || n.SENDER_NAME || n.TITLE)}
                        </span>
                        <span className="mono ms-auto shrink-0 text-[10px] text-ink-3">
                          {fmtClock(n.CREATED_AT)}
                        </span>
                      </span>

                      <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
                        {n.EVENT_DATE && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={10} /> {fmtDate(n.EVENT_DATE)}
                          </span>
                        )}
                        {slot && (
                          <span className="inline-flex items-center gap-1">
                            <Clock size={10} /> <span className="mono">{slot}</span>
                          </span>
                        )}
                        {n.SECTION_LABEL && (
                          <span className="inline-flex items-center gap-1">
                            <Users size={10} /> {n.SECTION_LABEL}
                          </span>
                        )}
                        {n.MAJOR_LABEL && (
                          <span className="inline-flex items-center gap-1">
                            <Tag size={10} /> {n.MAJOR_LABEL}
                          </span>
                        )}
                        {n.TEACHING_GROUP_LABEL && (
                          <span className="inline-flex items-center gap-1">
                            <Users size={10} /> {n.TEACHING_GROUP_LABEL}
                          </span>
                        )}
                        {n.CLASSROOM_LABEL && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={10} /> {n.CLASSROOM_LABEL}
                          </span>
                        )}
                        {n.INSTRUCTOR_NAME && (
                          <span className="inline-flex items-center gap-1">
                            <UserRound size={10} /> {n.INSTRUCTOR_NAME}
                          </span>
                        )}
                      </span>

                      <span className="mt-1 block truncate text-[11px] text-ink-2">
                        {isLibrary ? (
                          <>
                            {n.RECORD_TYPE === 'LIBRARY_REVIEW_REQUEST'
                              ? tr('Waiting for review')
                              : n.RECORD_STATUS === 'PUBLISHED'
                                ? tr('Published')
                                : n.RECORD_STATUS === 'REJECTED'
                                  ? tr('Rejected')
                                  : ''}
                            {n.RECORD_NOTE && <span className="text-ink-3"> — “{n.RECORD_NOTE}”</span>}
                          </>
                        ) : isMessage ? (
                          <>
                            <span className="text-ink-3">{tr(n.RECORD_TYPE === 'DIRECT_MESSAGE' ? 'From' : 'Sent by')}: </span>
                            {n.SENDER_NAME || '—'}
                            {n.MESSAGE_EXCERPT && <span className="text-ink-3"> — “{n.MESSAGE_EXCERPT}”</span>}
                          </>
                        ) : isSession ? (
                          <>
                            <span className="text-ink-3">{tr('Session type')}: </span>
                            {n.STUDY_SESSION_TYPE_LABEL ? tr(n.STUDY_SESSION_TYPE_LABEL) : '—'}
                          </>
                        ) : isCommentable ? (
                          <>
                            <span className="text-ink-3">{tr(isAbsence ? 'Justification' : 'Motif')}: </span>
                            {(isAbsence ? n.ABSENCE_JUSTIFICATION_LABEL : n.OBSERVATION_MOTIF_LABEL) || '—'}
                            {n.RECORD_NOTE && <span className="text-ink-3"> — “{n.RECORD_NOTE}”</span>}
                          </>
                        ) : (
                          <>{n.BODY || n.RECORD_NOTE || ''}</>
                        )}
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-1 text-ink-3">
                      <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      {isCommentable && (
                        <span className="mono inline-flex items-center gap-1 text-[10px]">
                          <MessageSquare size={10} /> {n.COMMENT_COUNT || 0}
                        </span>
                      )}
                    </span>
                  </button>

                  {expanded && !isMessage && (
                    <div className="border-t border-line bg-surface px-5 py-3">
                      {isSession ? (
                        <div className="space-y-2.5">
                          <p className="max-w-2xl text-[11.5px] leading-relaxed text-ink-2">
                            {isReminder
                              ? tr('This session has started and nothing has been recorded for it yet. Record an absence or an observation, or confirm the session was held with nothing to report. The reminder is withdrawn as soon as you do.')
                              : tr('No absence and no observation was recorded for this session, so it is treated as a class that was not taken. If the session was held and there was simply nothing to report, confirm it and the alert is withdrawn for everyone.')}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="mono text-[10px] text-ink-3">
                              {[n.EVENT_DATE, slot].filter(Boolean).join(' · ')}
                            </span>
                            {mayConfirm && (
                              <button
                                type="button"
                                onClick={() => confirmSession(n)}
                                disabled={confirmingKey === key}
                                className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-semibold text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Check size={12} />
                                {confirmingKey === key ? tr('Confirming…') : tr('The session was held')}
                              </button>
                            )}
                          </div>
                        </div>
                      ) : isCommentable ? (
                        <>
                      <div className="flex items-center gap-2">
                        <span className="kicker text-[9.5px]">{tr('Comments')}</span>
                        <span className="mono text-[10px] text-ink-3">{list.length}</span>
                      </div>

                      {commentsLoading[key] ? (
                        <p className="mt-2 text-[11.5px] text-ink-3">{tr('Loading comments…')}</p>
                      ) : list.length === 0 ? (
                        <p className="mt-2 text-[11.5px] text-ink-3">{tr('No comments yet.')}</p>
                      ) : (
                        <ul className="mt-2 space-y-2">
                          {list.map(c => (
                            <li key={c.DIRECTOR_COMMENT_ID} className="flex items-start gap-2 border border-line bg-canvas px-2.5 py-2">
                              <span className="mono mt-px grid h-5 w-5 shrink-0 place-items-center rounded-[3px] border border-line-strong text-[9px] text-ink-2">
                                {(c.DIRECTOR_NAME || '?').charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-medium text-ink">{c.DIRECTOR_NAME}</span>
                                  <span className="mono text-[9.5px] text-ink-3">{fmtClock(c.CREATED_AT)}</span>
                                </div>
                                <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-2">{c.COMMENT_TEXT}</p>
                              </div>
                              {c.DIRECTOR_PERSON_ID === user.personId && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(n, c)}
                                  className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                                  title={tr('Delete comment')}
                                  aria-label={tr('Delete comment')}
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {canComment && (
                      <div className="mt-2.5 flex items-end gap-2">
                        <textarea
                          value={drafts[key] || ''}
                          onChange={e => setDrafts(d => ({ ...d, [key]: e.target.value }))}
                          placeholder={tr('Write a comment on this record…')}
                          rows={2}
                          maxLength={2000}
                          className="field min-h-[54px] flex-1 resize-y text-[11.5px]"
                        />
                        <button
                          type="button"
                          onClick={() => handlePost(n)}
                          disabled={postingKey === key || !(drafts[key] || '').trim()}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-3 text-[11.5px] font-semibold text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Send size={12} /> {postingKey === key ? tr('Posting…') : tr('Post')}
                        </button>
                      </div>
                      )}
                        </>
                      ) : (
                        <div className="space-y-2.5">
                          <p className="max-w-2xl text-[11.5px] leading-relaxed text-ink-2">
                            {isLibrary
                              ? (n.RECORD_TYPE === 'LIBRARY_REVIEW_REQUEST'
                                  ? tr('Waiting for review')
                                  : n.RECORD_STATUS === 'PUBLISHED'
                                    ? tr('Published')
                                    : n.RECORD_STATUS === 'REJECTED'
                                      ? tr('Rejected')
                                      : n.BODY || '—')
                              : (n.BODY || '—')}
                          </p>
                          {isLibrary && n.RECORD_NOTE && (
                            <p className="max-w-2xl border-s-2 border-line-strong ps-2 text-[11.5px] leading-relaxed text-ink-2">
                              “{n.RECORD_NOTE}”
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="mono text-[10px] text-ink-3">{fmtClock(n.CREATED_AT)}</span>
                            <button
                              type="button"
                              onClick={() => navigate(notificationTarget(n.RECORD_TYPE, key))}
                              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-semibold text-ink hover:bg-surface-muted"
                            >
                              <ArrowRight size={12} /> {tr('Open')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!loading && visible.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-5 py-2 text-[10.5px] text-ink-3">
          <AlertCircle size={11} />
          {tr('Absences and observations are recorded against the student; these notifications mirror them. A class that has started with no attendance taken raises a reminder to its teacher, which becomes a missed class once the slot ends. Muted families stay listed here but are never counted or announced; change them in Settings.')}
        </div>
      )}
    </div>
  )
}

export default Notifications
