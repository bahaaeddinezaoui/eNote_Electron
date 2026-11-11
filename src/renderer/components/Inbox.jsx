import React, { useEffect, useMemo, useState } from 'react'
import { formatDate, formatDateTime } from '../dateFormat'
import {
  Inbox as InboxIcon, Send, Users, CheckCheck, Eye, Clock, MailOpen, Mail,
  CheckCircle2, ChevronRight, Loader2, Search, X, RefreshCw, AlertCircle, SlidersHorizontal
} from 'lucide-react'
import { tr } from '../i18n'
import { PageIntro } from './ui/PageHeader'
import Modal from './ui/Modal'
import Notice from './ui/Notice'
import ListError from './ui/ListError'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'

const DAY = 24 * 60 * 60 * 1000

const fmtDateTime = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  return formatDateTime(d, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit'
  })
}

const fmtDay = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  return formatDate(d, { year: 'numeric', month: 'short', day: '2-digit' })
}

const displayName = (row) => row?.PERSON_NAME || row?.SENDER_NAME || row?.USER_USERNAME || tr('Unknown')

// A message is addressed to role codes, stored as one comma-separated string.
const roleCodes = (value) => String(value || '')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean)

const timeOf = (value) => {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

const compareText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' })

const withinPeriod = (value, days) => {
  if (!days) return true
  const time = timeOf(value)
  return time > 0 && Date.now() - time <= Number(days) * DAY
}

const PERIODS = [
  { value: '', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' }
]

// Sorts are comparators over the rows the list already holds; the API stays
// unchanged, so a filter or a sort never costs another round trip.
const INBOX_SORTS = {
  newest: (a, b) => timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT) || b.MESSAGE_ID - a.MESSAGE_ID,
  oldest: (a, b) => timeOf(a.CREATED_AT) - timeOf(b.CREATED_AT) || a.MESSAGE_ID - b.MESSAGE_ID,
  subject: (a, b) => compareText(a.MESSAGE_SUBJECT, b.MESSAGE_SUBJECT) || timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT),
  sender: (a, b) => compareText(displayName(a), displayName(b)) || timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT),
  unseen: (a, b) => (a.SEEN_AT ? 1 : 0) - (b.SEEN_AT ? 1 : 0) || timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT)
}

const INBOX_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'unseen', label: 'Unseen first' },
  { value: 'subject', label: 'Subject A–Z' },
  { value: 'sender', label: 'Sender A–Z' }
]

const seenRatio = (message) => {
  const recipients = Number(message.RECIPIENT_COUNT) || 0
  if (!recipients) return 0
  return (Number(message.SEEN_COUNT) || 0) / recipients
}

const SENT_SORTS = {
  newest: INBOX_SORTS.newest,
  oldest: INBOX_SORTS.oldest,
  subject: INBOX_SORTS.subject,
  most: (a, b) => seenRatio(b) - seenRatio(a) || timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT),
  least: (a, b) => seenRatio(a) - seenRatio(b) || timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT)
}

const SENT_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'most', label: 'Most seen first' },
  { value: 'least', label: 'Least seen first' },
  { value: 'subject', label: 'Subject A–Z' }
]

const SENT_STATES = [
  { value: '', label: 'Any receipt' },
  { value: 'seen', label: 'Everyone saw it' },
  { value: 'partial', label: 'Partly seen' },
  { value: 'unseen', label: 'Nobody saw it' }
]

// Per-message read state, shared by the list and the detail pane.
const SeenBadge = ({ seenAt, compact = false }) => (
  seenAt ? (
    <span className={`inline-flex items-center gap-1 rounded-[3px] border border-line bg-surface-muted font-medium text-ink-3 ${compact ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2 py-0.5 text-[10.5px]'}`}>
      <Eye size={compact ? 9 : 11} /> {tr('Seen')}
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 rounded-[3px] border border-jade-500/40 bg-selection font-semibold text-ink ${compact ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2 py-0.5 text-[10.5px]'}`}>
      <Clock size={compact ? 9 : 11} /> {tr('Unseen')}
    </span>
  )
)

const RoleChips = ({ value, max = 4 }) => {
  const codes = roleCodes(value)
  if (codes.length === 0) return null
  return (
    <span className="flex flex-wrap items-center gap-1">
      {codes.slice(0, max).map((code) => (
        <span key={code} className="mono rounded-[2px] border border-line bg-surface-muted px-1 py-px text-[9px] text-ink-3">
          {code}
        </span>
      ))}
      {codes.length > max && (
        <span className="mono text-[9px] text-ink-3">+{codes.length - max}</span>
      )}
    </span>
  )
}

// A labelled field in the toolbar; the label is the small caps kicker the rest
// of the application uses above a control.
const Field = ({ label, className = '', children }) => (
  <div className={`min-w-0 ${className}`}>
    <label className="field-label">{label}</label>
    {children}
  </div>
)

// Inbox: every signed-in user reads the messages addressed to them and sees
// whether (and when) they opened them. Admins additionally compose one-way
// messages addressed to whole roles, and get seen-by receipts per message.
const InboxPage = ({ user }) => {
  const isAdmin = !!user?.roles?.includes('ADMIN')

  const [tab, setTab] = useState('inbox')
  const [messages, setMessages] = useState([])
  const [unread, setUnread] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)

  // Inbox filters and sort, all applied to the list already in memory.
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [sender, setSender] = useState('')
  const [role, setRole] = useState('')
  const [period, setPeriod] = useState('')
  const [sort, setSort] = useState('newest')

  // Compose state (admin only)
  const [roles, setRoles] = useState([])
  const [selectedRoles, setSelectedRoles] = useState([])
  const [audience, setAudience] = useState([])
  const [audienceLoading, setAudienceLoading] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [composeError, setComposeError] = useState('')

  // Sent state (admin only)
  const [sent, setSent] = useState([])
  const [sentLoading, setSentLoading] = useState(false)
  const [openSentId, setOpenSentId] = useState(null)
  const [receipts, setReceipts] = useState(null)
  const [receiptsLoading, setReceiptsLoading] = useState(false)
  const [sentQuery, setSentQuery] = useState('')
  const [sentRole, setSentRole] = useState('')
  const [sentPeriod, setSentPeriod] = useState('')
  const [sentReceipt, setSentReceipt] = useState('')
  const [sentSort, setSentSort] = useState('newest')

  const [loadError, setLoadError] = useState('')
  const showNotice = (type, text) => setNotice({ type, text })

  const loadInbox = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await window.api.getInbox(user.id)
      const list = res?.messages || []
      setMessages(list)
      setUnread(res?.unreadCount || 0)
      setSelectedId(prev => prev ?? (list[0]?.MESSAGE_ID ?? null))
    } catch (err) {
      setLoadError(err.message || tr('Failed to load your inbox.'))
      showNotice('error', err.message || tr('Failed to load your inbox.'))
    } finally {
      setLoading(false)
    }
  }

  const loadRoles = async () => {
    try {
      const res = await window.api.getMessageRoles(user.id)
      setRoles(res?.roles || [])
    } catch (err) {
      showNotice('error', err.message || tr('Failed to load roles.'))
    }
  }

  const loadSent = async () => {
    setSentLoading(true)
    try {
      const res = await window.api.getSentMessages(user.id)
      setSent(res?.messages || [])
    } catch (err) {
      showNotice('error', err.message || tr('Failed to load sent messages.'))
    } finally {
      setSentLoading(false)
    }
  }

  useEffect(() => {
    loadInbox()
    if (isAdmin) { loadRoles(); loadSent() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  // Marking a message read is the moment its "seen at" is recorded. The
  // optimistic update keeps the list responsive; the server keeps the first
  // timestamp, so re-opening never moves it.
  const openMessage = async (message) => {
    setSelectedId(message.MESSAGE_ID)
    if (message.SEEN_AT) return
    const now = new Date()
    setMessages(prev => prev.map(m => (m.MESSAGE_ID === message.MESSAGE_ID ? { ...m, SEEN_AT: now } : m)))
    setUnread(c => Math.max(0, c - 1))
    try {
      const res = await window.api.markMessageSeen(user.id, message.MESSAGE_ID)
      if (res?.seenAt) {
        setMessages(prev => prev.map(m => (m.MESSAGE_ID === message.MESSAGE_ID ? { ...m, SEEN_AT: res.seenAt } : m)))
      }
      // Keep the sidebar unread badge in step with what was just read.
      window.dispatchEvent(new Event('inbox-updated'))
    } catch (err) {
      showNotice('error', err.message || tr('Could not mark the message as seen.'))
      loadInbox()
    }
  }

  const markAllSeen = async () => {
    try {
      const res = await window.api.markAllMessagesSeen(user.id)
      setMessages(prev => prev.map(m => ({ ...m, SEEN_AT: m.SEEN_AT || new Date() })))
      setUnread(0)
      window.dispatchEvent(new Event('inbox-updated'))
      // Offline the server cannot record that these were seen: the list keeps the
      // local state, and the notice says it was not saved.
      showNotice(
        res?.offline ? 'error' : 'success',
        res?.offline
          ? tr('The server is unreachable. You can read what is saved on this computer, but changes cannot be saved until it is back.')
          : tr('All messages marked as seen.')
      )
    } catch (err) {
      showNotice('error', err.message || tr('Could not mark all messages as seen.'))
    }
  }

  const toggleRole = async (roleCode) => {
    const next = selectedRoles.includes(roleCode)
      ? selectedRoles.filter(c => c !== roleCode)
      : [...selectedRoles, roleCode]
    setSelectedRoles(next)

    if (next.length === 0) { setAudience([]); return }
    setAudienceLoading(true)
    try {
      const res = await window.api.getMessageAudience(user.id, next)
      setAudience(res?.recipients || [])
    } catch (err) {
      showNotice('error', err.message || tr('Could not resolve the audience.'))
      setAudience([])
    } finally {
      setAudienceLoading(false)
    }
  }

  const send = async (e) => {
    e.preventDefault()
    setSending(true)
    setComposeError('')
    try {
      const res = await window.api.sendMessage(user.id, { subject, body, roles: selectedRoles })
      const count = res?.recipientCount || 0
      setSubject('')
      setBody('')
      setSelectedRoles([])
      setAudience([])
      showNotice('success', tr('Message sent to {count} recipients.', { count }))
      await loadSent()
      setTab('sent')
      if (res?.messageId) openReceipts({ MESSAGE_ID: res.messageId, MESSAGE_SUBJECT: subject })
    } catch (err) {
      setComposeError(err.message || tr('Could not send the message.'))
    } finally {
      setSending(false)
    }
  }

  // The compose form lives in a modal: closing it returns to the inbox and
  // keeps the draft, so a half-written message is never lost to a stray click.
  const closeCompose = () => {
    if (sending) return
    setTab('inbox')
  }

  const openReceipts = async (message) => {
    if (openSentId === message.MESSAGE_ID) { setOpenSentId(null); setReceipts(null); return }
    setOpenSentId(message.MESSAGE_ID)
    setReceipts(null)
    setReceiptsLoading(true)
    try {
      const res = await window.api.getMessageRecipients(user.id, message.MESSAGE_ID)
      setReceipts(res)
    } catch (err) {
      showNotice('error', err.message || tr('Could not load the recipients.'))
    } finally {
      setReceiptsLoading(false)
    }
  }

  const senderOptions = useMemo(() => {
    const names = new Set(messages.map(displayName).filter(Boolean))
    return [...names].sort(compareText)
  }, [messages])

  const inboxRoles = useMemo(() => {
    const codes = new Set(messages.flatMap(m => roleCodes(m.TARGET_ROLES)))
    return [...codes].sort()
  }, [messages])

  const sentRoles = useMemo(() => {
    const codes = new Set(sent.flatMap(m => roleCodes(m.TARGET_ROLES)))
    return [...codes].sort()
  }, [sent])

  // Every filter runs over text the caller can see, so a search finds a sender
  // as readily as a subject line.
  const visibleMessages = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = messages.filter((message) => {
      if (status === 'unseen' && message.SEEN_AT) return false
      if (status === 'seen' && !message.SEEN_AT) return false
      if (sender && displayName(message) !== sender) return false
      if (role && !roleCodes(message.TARGET_ROLES).includes(role)) return false
      if (!withinPeriod(message.CREATED_AT, period)) return false
      if (!needle) return true
      return [message.MESSAGE_SUBJECT, message.MESSAGE_BODY, displayName(message), message.SENDER_USERNAME, message.TARGET_ROLES]
        .some(value => String(value ?? '').toLowerCase().includes(needle))
    })
    return [...rows].sort(INBOX_SORTS[sort] || INBOX_SORTS.newest)
  }, [messages, query, status, sender, role, period, sort])

  // Whatever the filters hide, the pane always has a message to show.
  const activeMessage = useMemo(
    () => visibleMessages.find(m => m.MESSAGE_ID === selectedId) || visibleMessages[0] || null,
    [visibleMessages, selectedId]
  )

  const visibleSent = useMemo(() => {
    const needle = sentQuery.trim().toLowerCase()
    const rows = sent.filter((message) => {
      if (sentRole && !roleCodes(message.TARGET_ROLES).includes(sentRole)) return false
      if (!withinPeriod(message.CREATED_AT, sentPeriod)) return false
      if (sentReceipt) {
        const ratio = seenRatio(message)
        if (sentReceipt === 'seen' && ratio < 1) return false
        if (sentReceipt === 'partial' && (ratio <= 0 || ratio >= 1)) return false
        if (sentReceipt === 'unseen' && ratio > 0) return false
      }
      if (!needle) return true
      return [message.MESSAGE_SUBJECT, message.MESSAGE_BODY, message.TARGET_ROLES]
        .some(value => String(value ?? '').toLowerCase().includes(needle))
    })
    return [...rows].sort(SENT_SORTS[sentSort] || SENT_SORTS.newest)
  }, [sent, sentQuery, sentRole, sentPeriod, sentReceipt, sentSort])

  const clearInboxFilters = () => {
    setQuery('')
    setStatus('')
    setSender('')
    setRole('')
    setPeriod('')
    setSort('newest')
  }

  const clearSentFilters = () => {
    setSentQuery('')
    setSentRole('')
    setSentPeriod('')
    setSentReceipt('')
    setSentSort('newest')
  }

  const tabs = [
    { id: 'inbox', label: tr('Inbox'), icon: InboxIcon, count: unread },
    ...(isAdmin ? [{ id: 'sent', label: tr('Sent'), icon: Mail, count: 0 }] : [])
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageIntro
        kicker={tr('Messages')}
        title={tr('Inbox')}
        meta={unread > 0 ? `${unread} ${tr('unread')}` : undefined}
        actions={
          <>
            <button
              type="button"
              onClick={() => { loadInbox(); if (isAdmin) loadSent() }}
              disabled={loading}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted disabled:opacity-40"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
            </button>
            {tab === 'inbox' && unread > 0 && (
              <button
                type="button"
                onClick={markAllSeen}
                className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
              >
                <CheckCheck size={12} /> {tr('Mark all seen')}
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                onClick={() => { setComposeError(''); setTab('compose') }}
                className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110"
              >
                <Send size={12} /> {tr('New message')}
              </button>
            )}
          </>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {isAdmin
            ? tr('Messages you received, and one-way messages you send to roles.')
            : tr('Messages sent to you by an administrator.')}
        </p>
      </PageIntro>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div role="tablist" aria-label={tr('Message views')} className="inline-flex items-center gap-0.5 rounded-[4px] border border-line-strong bg-surface p-0.5">
          {tabs.map(item => {
            const Icon = item.icon
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2.5 text-[11px] font-medium transition-colors ${
                  active ? 'bg-jade-solid text-on-jade' : 'text-ink-2 hover:bg-surface-muted hover:text-ink'
                }`}
              >
                <Icon size={12} />
                {item.label}
                {item.count > 0 && (
                  <span className={`mono min-w-[15px] rounded-[2px] px-1 text-[9.5px] font-semibold ${
                    active ? 'bg-on-jade text-jade-solid' : 'bg-jade-solid text-on-jade'
                  }`}>
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <span className="mono ms-auto text-[10px] text-ink-3">
          {tab === 'sent'
            ? `${visibleSent.length} / ${sent.length} ${tr('sent')}`
            : `${visibleMessages.length} / ${messages.length} ${tr('messages')}`}
        </span>
      </div>

      {tab === 'inbox' && (
        <>
          <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-[4px] border border-line bg-surface p-2.5">
            <Field label={tr('Search')} className="min-w-[180px] flex-1">
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr('Subject, message, sender')}
                  aria-label={tr('Search messages')}
                  className="field h-7 ps-6 text-[11.5px]"
                />
              </div>
            </Field>

          <FilterBar
            activeCount={[status, sender, role, period].filter(Boolean).length + (sort !== 'newest' ? 1 : 0)}
            onClear={clearInboxFilters}
            matchCount={visibleMessages.length}
            matchLabel="message"
            title={tr('Filter messages')}
          >
            <FilterField label={tr('Status')}>
              <select
                className={filterInputCls}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label={tr('Filter by read state')}
              >
                <option value="">{tr('All messages')}</option>
                <option value="unseen">{tr('Unseen')}</option>
                <option value="seen">{tr('Seen')}</option>
              </select>
            </FilterField>
            <FilterField label={tr('From')}>
              <select
                className={filterInputCls}
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                aria-label={tr('Filter by sender')}
                disabled={senderOptions.length === 0}
              >
                <option value="">{tr('Any sender')}</option>
                {senderOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </FilterField>
            <FilterField label={tr('Role')}>
              <select
                className={filterInputCls}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                aria-label={tr('Filter by addressed role')}
                disabled={inboxRoles.length === 0}
              >
                <option value="">{tr('Any role')}</option>
                {inboxRoles.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </FilterField>
            <FilterField label={tr('Period')}>
              <select
                className={filterInputCls}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-label={tr('Filter by period')}
              >
                {PERIODS.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr('Sort by')}>
              <select
                className={filterInputCls}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label={tr('Sort messages')}
              >
                {INBOX_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
            </FilterField>
          </FilterBar>
          </div>

          {loadError ? (
            <ListError label={tr('Could not load this list')} detail={loadError} onRetry={loadInbox} />
          ) : loading ? (
            <div className="flex items-center gap-2 rounded-[4px] border border-line bg-surface p-8 text-[12px] text-ink-3">
              <Loader2 size={14} className="animate-spin" /> {tr('Loading your inbox...')}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-[4px] border border-line bg-surface px-5 py-12 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-[4px] border border-line bg-surface-muted">
                <InboxIcon size={24} className="text-ink-3" />
              </div>
              <h2 className="serif mt-3 text-[17px] text-ink">{tr('Your inbox is empty')}</h2>
              <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-ink-3">
                {tr('Messages administrators send to your role will appear here.')}
              </p>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-[4px] border border-line bg-surface px-5 py-10 text-center">
              <SlidersHorizontal size={20} className="mx-auto text-ink-3" />
              <p className="mt-2 text-[12px] font-medium text-ink-2">{tr('No message matches these filters.')}</p>
              <button
                type="button"
                onClick={clearInboxFilters}
                className="mt-2 inline-flex h-7 items-center gap-1 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted hover:text-ink"
              >
                <X size={10} /> {tr('Clear filters')}
              </button>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
              <ul className="min-h-[18rem] divide-y divide-line overflow-y-auto rounded-[4px] border border-line bg-surface lg:min-h-0">
                {visibleMessages.map(message => {
                  const active = message.MESSAGE_ID === activeMessage?.MESSAGE_ID
                  const unseen = !message.SEEN_AT
                  return (
                    <li key={message.MESSAGE_ID}>
                      <button
                        type="button"
                        onClick={() => openMessage(message)}
                        aria-current={active ? 'true' : undefined}
                        className={`w-full px-3 py-2.5 text-left transition-colors ${
                          active ? 'bg-selection' : 'hover:bg-surface-muted'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${unseen ? 'bg-jade-solid' : 'bg-line-strong'}`} />
                          <span className={`min-w-0 flex-1 truncate text-[12px] ${unseen ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                            {message.MESSAGE_SUBJECT}
                          </span>
                          <span className="mono shrink-0 text-[9px] text-ink-3">{fmtDay(message.CREATED_AT)}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-3">
                          <span className="truncate">{displayName(message)}</span>
                          <SeenBadge seenAt={message.SEEN_AT} compact />
                          <RoleChips value={message.TARGET_ROLES} max={2} />
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              <div className="min-h-[22rem] overflow-y-auto rounded-[4px] border border-line bg-surface p-4 lg:min-h-0">
                {!activeMessage ? (
                  <p className="text-[12px] text-ink-3">{tr('Select a message to read it.')}</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="serif break-words text-[19px] leading-[24px] text-ink">{activeMessage.MESSAGE_SUBJECT}</h2>
                        <p className="mt-1 text-[10.5px] text-ink-3">
                          {tr('From')}{' '}
                          <span className="font-medium text-ink-2">{displayName(activeMessage)}</span>
                          {activeMessage.SENDER_USERNAME ? ` (${activeMessage.SENDER_USERNAME})` : ''}
                          {' · '}{fmtDateTime(activeMessage.CREATED_AT)}
                        </p>
                      </div>
                      <SeenBadge seenAt={activeMessage.SEEN_AT} />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 border-y border-line py-2">
                      <span className="inline-flex items-center gap-1 text-[10px] text-ink-3">
                        <Users size={11} /> {tr('Addressed to')}
                      </span>
                      <RoleChips value={activeMessage.TARGET_ROLES} max={8} />
                    </div>

                    <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2" dir="auto">
                      {activeMessage.MESSAGE_BODY}
                    </p>

                    <div className="flex items-center gap-1.5 border-t border-line pt-2.5 text-[10.5px] text-ink-3">
                      {activeMessage.SEEN_AT ? (
                        <><MailOpen size={12} className="text-jade-600" /> {tr('You first saw this message on')} {fmtDateTime(activeMessage.SEEN_AT)}.</>
                      ) : (
                        <><Mail size={12} /> {tr('Opening this message records when you saw it.')}</>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'sent' && isAdmin && (
        <>
          <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-[4px] border border-line bg-surface p-2.5">
            <Field label={tr('Search')} className="min-w-[180px] flex-1">
              <div className="relative">
                <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="text"
                  value={sentQuery}
                  onChange={(e) => setSentQuery(e.target.value)}
                  placeholder={tr('Subject, message, role')}
                  aria-label={tr('Search sent messages')}
                  className="field h-7 ps-6 text-[11.5px]"
                />
              </div>
            </Field>

          <FilterBar
            activeCount={[sentRole, sentPeriod, sentReceipt].filter(Boolean).length + (sentSort !== 'newest' ? 1 : 0)}
            onClear={clearSentFilters}
            matchCount={visibleSent.length}
            matchLabel="message"
            title={tr('Filter sent messages')}
          >
            <FilterField label={tr('Role')}>
              <select
                className={filterInputCls}
                value={sentRole}
                onChange={(e) => setSentRole(e.target.value)}
                aria-label={tr('Filter by addressed role')}
                disabled={sentRoles.length === 0}
              >
                <option value="">{tr('Any role')}</option>
                {sentRoles.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </FilterField>
            <FilterField label={tr('Period')}>
              <select
                className={filterInputCls}
                value={sentPeriod}
                onChange={(e) => setSentPeriod(e.target.value)}
                aria-label={tr('Filter by period')}
              >
                {PERIODS.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr('Receipts')}>
              <select
                className={filterInputCls}
                value={sentReceipt}
                onChange={(e) => setSentReceipt(e.target.value)}
                aria-label={tr('Filter by receipts')}
              >
                {SENT_STATES.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label={tr('Sort by')}>
              <select
                className={filterInputCls}
                value={sentSort}
                onChange={(e) => setSentSort(e.target.value)}
                aria-label={tr('Sort sent messages')}
              >
                {SENT_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{tr(option.label)}</option>
                ))}
              </select>
            </FilterField>
          </FilterBar>
          </div>

          {sentLoading ? (
            <div className="flex items-center gap-2 rounded-[4px] border border-line bg-surface p-8 text-[12px] text-ink-3">
              <Loader2 size={14} className="animate-spin" /> {tr('Loading sent messages...')}
            </div>
          ) : sent.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-[4px] border border-line bg-surface px-5 py-12 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-[4px] border border-line bg-surface-muted">
                <Send size={22} className="text-ink-3" />
              </div>
              <h2 className="serif mt-3 text-[17px] text-ink">{tr('Nothing sent yet')}</h2>
              <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-ink-3">
                {tr('Messages you send appear here with who has seen them.')}
              </p>
            </div>
          ) : visibleSent.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-[4px] border border-line bg-surface px-5 py-10 text-center">
              <SlidersHorizontal size={20} className="mx-auto text-ink-3" />
              <p className="mt-2 text-[12px] font-medium text-ink-2">{tr('No sent message matches these filters.')}</p>
              <button
                type="button"
                onClick={clearSentFilters}
                className="mt-2 inline-flex h-7 items-center gap-1 rounded-[4px] border border-line-strong bg-surface px-2 text-[11px] text-ink-2 hover:bg-surface-muted hover:text-ink"
              >
                <X size={10} /> {tr('Clear filters')}
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {visibleSent.map(message => {
                const open = openSentId === message.MESSAGE_ID
                const recipients = Number(message.RECIPIENT_COUNT) || 0
                const seenCount = Number(message.SEEN_COUNT) || 0
                const percent = recipients ? Math.round((seenCount / recipients) * 100) : 0
                return (
                  <div key={message.MESSAGE_ID} className="overflow-hidden rounded-[4px] border border-line bg-surface">
                    <button
                      type="button"
                      onClick={() => openReceipts(message)}
                      aria-expanded={open}
                      className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-surface-muted"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-ink">{message.MESSAGE_SUBJECT}</div>
                        <div className="mt-0.5 text-[10.5px] text-ink-3">
                          {fmtDateTime(message.CREATED_AT)}
                          {message.TARGET_ROLES ? ` · ${tr('to')} ${message.TARGET_ROLES}` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="mono inline-flex items-center gap-1 rounded-[3px] border border-line-strong bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-2">
                          <Eye size={10} /> {seenCount}/{recipients}
                        </span>
                        <span className="hidden h-1 w-16 overflow-hidden rounded-[1px] bg-line sm:block" aria-hidden="true">
                          <span className="block h-full bg-jade-solid" style={{ width: `${percent}%` }} />
                        </span>
                        <ChevronRight size={14} className={`text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`} />
                      </div>
                    </button>

                    {open && (
                      <div className="border-t border-line p-3.5">
                        {receiptsLoading ? (
                          <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
                            <Loader2 size={12} className="animate-spin" /> {tr('Loading recipients...')}
                          </p>
                        ) : receipts?.message?.MESSAGE_ID === message.MESSAGE_ID ? (
                          <div className="space-y-3">
                            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2" dir="auto">
                              {receipts.message.MESSAGE_BODY}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 border-y border-line py-2">
                              <span className="inline-flex items-center gap-1 text-[10px] text-ink-3">
                                <Users size={11} /> {tr('Recipients')}
                              </span>
                              <RoleChips value={message.TARGET_ROLES} max={4} />
                              <span className="mono ms-auto text-[10px] text-ink-3">
                                {receipts.seenCount} {tr('seen')} · {receipts.unseenCount} {tr('unseen')}
                              </span>
                            </div>
                            <ul className="divide-y divide-line overflow-hidden rounded-[4px] border border-line">
                              {receipts.recipients.map(recipient => (
                                <li key={recipient.MESSAGE_RECIPIENT_ID} className="flex items-center gap-3 bg-surface px-2.5 py-1.5">
                                  <div className="min-w-0">
                                    <div className="truncate text-[11px] font-medium text-ink-2">{displayName(recipient)}</div>
                                    <div className="mono truncate text-[9.5px] text-ink-3">
                                      {recipient.USER_USERNAME}{recipient.ROLE_CODES ? ` · ${recipient.ROLE_CODES}` : ''}
                                    </div>
                                  </div>
                                  <div className="ms-auto shrink-0 text-right">
                                    <SeenBadge seenAt={recipient.SEEN_AT} compact />
                                    <div className="mono mt-0.5 text-[9.5px] text-ink-3">
                                      {recipient.SEEN_AT ? fmtDateTime(recipient.SEEN_AT) : tr('Not yet')}
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p className="text-[11px] text-ink-3">{tr('Select the message again to reload its receipts.')}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={tab === 'compose' && isAdmin}
        onClose={closeCompose}
        title={tr('New message')}
        description={tr('One-way message to every active account of the roles you choose.')}
        maxWidth="max-w-[620px]"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10.5px] text-ink-3">
              {tr('Messages are one-way: recipients cannot reply.')}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={closeCompose}
                disabled={sending}
                className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted disabled:opacity-40"
              >
                {tr('Cancel')}
              </button>
              <button
                type="submit"
                form="inbox-compose"
                disabled={sending || !subject.trim() || !body.trim() || selectedRoles.length === 0}
                className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                {sending ? tr('Sending...') : tr('Send message')}
              </button>
            </div>
          </div>
        }
      >
        <form id="inbox-compose" onSubmit={send} className="space-y-3.5">
          {composeError && (
            <div className="flex items-center gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-2.5 py-2 text-[11.5px] text-danger-ink">
              <AlertCircle size={13} /> {composeError}
            </div>
          )}

          <div>
            <label htmlFor="inbox-subject" className="kicker mb-1 block text-[9px]">{tr('Subject')}</label>
            <input
              id="inbox-subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              maxLength={200}
              placeholder={tr('e.g. Mid-semester schedule change')}
              className="field text-[12px]"
            />
          </div>

          <div>
            <label htmlFor="inbox-body" className="kicker mb-1 block text-[9px]">{tr('Message')}</label>
            <textarea
              id="inbox-body"
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={7}
              maxLength={20000}
              placeholder={tr('Write the message every selected role will receive...')}
              className="w-full resize-y rounded-[4px] border border-line-strong bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-ink outline-none focus:border-jade-500 focus:ring-2 focus:ring-jade-500/20"
            />
          </div>

          <div>
            <span className="kicker mb-2 block text-[9px]">{tr('Send to roles')}</span>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {roles.map(role => {
                const checked = selectedRoles.includes(role.ROLE_CODE)
                return (
                  <button
                    type="button"
                    key={role.ROLE_ID}
                    onClick={() => toggleRole(role.ROLE_CODE)}
                    aria-pressed={checked}
                    className={`flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5 text-left ${
                      checked
                        ? 'border-jade-500/50 bg-selection text-ink'
                        : 'border-line bg-surface text-ink-2 hover:bg-surface-muted'
                    }`}
                  >
                    <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[2px] border ${
                      checked ? 'border-jade-500 bg-jade-solid text-on-jade' : 'border-line-strong'
                    }`}>
                      {checked && <CheckCircle2 size={10} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-medium">{role.ROLE_LABEL || role.ROLE_CODE}</span>
                      <span className="mono block text-[9.5px] text-ink-3">
                        {role.USER_COUNT} {role.USER_COUNT === 1 ? tr('account') : tr('accounts')}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-[4px] border border-line bg-surface-muted/40 p-2.5">
            <div className="flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">
              <Users size={11} /> {tr('Recipients')}
              <span className="mono ms-auto tracking-normal">
                {audienceLoading ? tr('Resolving...') : `${audience.length} ${audience.length === 1 ? tr('person') : tr('people')}`}
              </span>
            </div>
            {selectedRoles.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-ink-3">{tr('Select at least one role to see who will receive the message.')}</p>
            ) : audienceLoading ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-3">
                <Loader2 size={11} className="animate-spin" /> {tr('Resolving recipients...')}
              </p>
            ) : audience.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-warning-ink">{tr('No active account holds the selected role(s).')}</p>
            ) : (
              <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                {audience.map(person => (
                  <span
                    key={person.USER_ID}
                    className="inline-flex items-center gap-1 rounded-[3px] border border-line bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-2"
                  >
                    {displayName(person)}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-2 text-[10px] text-ink-3">
              {tr('Only active accounts are addressed, and your own account is never included.')}
            </p>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default InboxPage
