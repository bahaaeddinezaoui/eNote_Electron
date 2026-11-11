import React, { useEffect, useMemo, useRef, useState } from 'react'
import { formatDate, formatTime } from '../dateFormat'
import { useSearchParams } from 'react-router-dom'
import {
  MessageSquare, Send, Users, Search, X, Clock, AlertCircle, CheckCheck,
  Plus, Loader2, ShieldAlert
} from 'lucide-react'
import { tr } from '../i18n'
import { usePersonPhotos } from '../personPhotos'
import FilterBar, { FilterField, filterInputCls } from './ui/FilterBar'
import PhotoZoom from './ui/PhotoZoom'
import { PageIntro } from './ui/PageHeader'

const displayName = (row, fallback = 'Unknown') =>
  row?.PERSON_NAME ||
  [row?.PERSON_FIRST_NAME, row?.PERSON_LAST_NAME].filter(Boolean).join(' ') ||
  [row?.OTHER_FIRST_NAME, row?.OTHER_LAST_NAME].filter(Boolean).join(' ') ||
  row?.OTHER_USERNAME ||
  row?.USER_USERNAME ||
  fallback

// The open thread's counterpart is the one piece of the payload that does not
// arrive as uppercase columns: messagingService builds it by hand, in camelCase
// (firstName / lastName / username). displayName reads the column names, so it
// returned 'Unknown' for every conversation header — the name is resolved here
// instead.
const otherUserName = (other) =>
  [other?.firstName, other?.lastName].filter(Boolean).join(' ') ||
  other?.username ||
  'Unknown'

const fmtTime = (v) => {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : formatTime(d, { hour: '2-digit', minute: '2-digit' })
}

const fmtDay = (v) => {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? tr('Today') : formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

// "last seen" wording for the contact list and thread header.
const fmtLastSeen = (v) => {
  if (!v) return tr('never seen')
  const d = new Date(v)
  if (isNaN(d.getTime())) return tr('never seen')
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 90) return tr('active just now')
  if (diff < 3600) return tr('active {count} min ago', { count: Math.max(1, Math.floor(diff / 60)) })
  if (diff < 86400) return tr('active {count} h ago', { count: Math.floor(diff / 3600) })
  if (diff < 7 * 86400) return tr('active {count} d ago', { count: Math.floor(diff / 86400) })
  return tr('last seen {date}', { date: formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' }) })
}

const initialsOf = (name) =>
  name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'

// Direct messages: conversations with the people the contact matrix lets this
// user reach, plus a picker that shows every contactable active account with
// its presence. Sending is re-checked server-side on every message.
const DirectMessages = ({ user }) => {
  const [conversations, setConversations] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [contactsLoading, setContactsLoading] = useState(true)

  const [openId, setOpenId] = useState(null)
  const [thread, setThread] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerSearch, setPickerSearch] = useState('')

  // List controls: search over the rows already loaded, a filter over their
  // state and an order. All three work in memory, so the list never waits on
  // the server while it is being narrowed.
  const [convSearch, setConvSearch] = useState('')
  const [convFilter, setConvFilter] = useState('')
  const [convSort, setConvSort] = useState('')

  const [error, setError] = useState('')
  const [searchParams] = useSearchParams()
  const bottomRef = useRef(null)

  // Faces for the conversation list, the open thread and the contact picker,
  // read in one batch and cached by person id.
  const photos = usePersonPhotos([
    ...conversations.map((c) => ({ PERSON_ID: c.OTHER_PERSON_ID, PERSON_PHOTO: c.OTHER_PHOTO })),
    ...contacts.map((c) => ({ PERSON_ID: c.PERSON_ID, PERSON_PHOTO: c.PERSON_PHOTO })),
    { PERSON_ID: thread?.conversation?.otherUser?.personId, PERSON_PHOTO: thread?.conversation?.otherUser?.photo }
  ])

  const loadConversations = async () => {
    try {
      const res = await window.api.getDirectConversations(user.id)
      setConversations(res?.conversations || [])
    } catch (err) {
      setError(err.message || tr('Could not load your conversations.'))
    }
  }

  const loadContacts = async () => {
    setContactsLoading(true)
    try {
      const res = await window.api.getContactableUsers(user.id)
      setContacts(res?.users || [])
    } catch (err) {
      setError(err.message || tr('Could not load your contacts.'))
    } finally {
      setContactsLoading(false)
    }
  }

  const openThread = async (conversationId, { silent = false } = {}) => {
    if (!conversationId) return
    if (!silent) setThreadLoading(true)
    try {
      const res = await window.api.getDirectConversation(user.id, conversationId)
      setThread(res)
      setOpenId(conversationId)
      window.dispatchEvent(new Event('direct-messages-updated'))
      // Reading the thread clears its unread count.
      setConversations(prev => prev.map(c => (
        c.CONVERSATION_ID === conversationId ? { ...c, UNREAD_COUNT: 0 } : c
      )))
    } catch (err) {
      setError(err.message || tr('Could not open the conversation.'))
    } finally {
      setThreadLoading(false)
    }
  }

  useEffect(() => {
    const boot = async () => {
      setLoading(true)
      await Promise.all([loadConversations(), loadContacts()])
      setLoading(false)
    }
    boot()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  // Arriving from the title bar's list: `?conversation=<id>` opens that thread
  // straight away instead of leaving the reader on the empty picker.
  const requestedConversation = Number(searchParams.get('conversation')) || null
  useEffect(() => {
    if (!requestedConversation || loading || requestedConversation === openId) return
    openThread(requestedConversation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConversation, loading])

  // Keep the open thread fresh (and the list of threads) while the page is up.
  useEffect(() => {
    const timer = setInterval(() => {
      loadConversations()
      if (openId) openThread(openId, { silent: true })
    }, 15000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [thread?.messages?.length, openId])

  const startWithContact = async (contact) => {
    try {
      setError('')
      const res = await window.api.openDirectConversation(user.id, contact.USER_ID)
      setPickerOpen(false)
      setPickerSearch('')
      await loadConversations()
      await openThread(res.conversationId)
    } catch (err) {
      setError(err.message || tr('Could not start the conversation.'))
    }
  }

  const send = async (e) => {
    e?.preventDefault()
    const body = draft.trim()
    if (!body || !openId || sending) return
    setSending(true)
    try {
      await window.api.sendDirectMessage(user.id, openId, body)
      setDraft('')
      await openThread(openId, { silent: true })
      await loadConversations()
      window.dispatchEvent(new Event('direct-messages-updated'))
    } catch (err) {
      setError(err.message || tr('Could not send the message.'))
    } finally {
      setSending(false)
    }
  }

  const onDraftKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const filteredContacts = contacts.filter(c => {
    const q = pickerSearch.trim().toLowerCase()
    if (!q) return true
    return [c.PERSON_FIRST_NAME, c.PERSON_LAST_NAME, c.USER_USERNAME, c.ROLE_CODES]
      .filter(Boolean).join(' ').toLowerCase().includes(q)
  })

  const visibleConversations = useMemo(() => {
    const term = convSearch.trim().toLowerCase()
    const matches = conversations.filter(c => {
      if (convFilter === 'unread' && !(c.UNREAD_COUNT > 0)) return false
      if (convFilter === 'with-messages' && !c.LAST_BODY) return false
      if (!term) return true
      const haystack = [
        displayName(c, ''),
        c.OTHER_USERNAME,
        c.USER_USERNAME,
        c.OTHER_FIRST_NAME,
        c.OTHER_LAST_NAME,
        c.PERSON_FIRST_NAME,
        c.PERSON_LAST_NAME,
        c.LAST_BODY
      ]
      return haystack.some(value => String(value || '').toLowerCase().includes(term))
    })

    const when = (c) => {
      const stamp = new Date(c.LAST_AT || c.CREATED_AT || 0).getTime()
      return Number.isNaN(stamp) ? 0 : stamp
    }
    const sorted = [...matches]
    if (convSort === 'oldest') sorted.sort((a, b) => when(a) - when(b))
    else if (convSort === 'name') {
      sorted.sort((a, b) => displayName(a, '').localeCompare(displayName(b, '')))
    } else if (convSort === 'unread') {
      sorted.sort((a, b) => (b.UNREAD_COUNT || 0) - (a.UNREAD_COUNT || 0) || when(b) - when(a))
    } else {
      sorted.sort((a, b) => when(b) - when(a))
    }
    return sorted
  }, [conversations, convSearch, convFilter, convSort])

  const clearConversationControls = () => {
    setConvSearch('')
    setConvFilter('')
    setConvSort('')
  }

  const other = thread?.conversation?.otherUser
  const messages = thread?.messages || []
  let lastDay = ''

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-5 py-5">
      <PageIntro
        kicker={tr('Messages')}
        title={tr('Direct messages')}
        meta={`${conversations.length} ${tr('conversations')}`}
        actions={
          <button
            onClick={() => setPickerOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110"
          >
            <Plus size={12} /> {tr('New message')}
          </button>
        }
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {tr('Conversation with the people your roles are allowed to contact.')}
        </p>
      </PageIntro>

      {error && (
        <div className="bg-danger-bg border border-danger/30 text-danger-ink rounded-md p-4 text-[12.5px] font-semibold flex items-center gap-2">
          <AlertCircle size={16} /> {error}
          <button onClick={() => setError('')} className="ml-auto text-danger-ink hover:text-danger cursor-pointer">✕</button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        {/* Conversation list */}
        <div className="flex min-h-[18rem] flex-col overflow-hidden rounded-md border border-line bg-surface lg:min-h-0">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <Users size={14} className="text-ink-3" />
            <span className="kicker text-ink-2">{tr("Conversations")}</span>
            <span className="ml-auto text-[10px] font-semibold text-ink-3">
              {visibleConversations.length === conversations.length
                ? conversations.length
                : `${visibleConversations.length}/${conversations.length}`}
            </span>
          </div>

          {/* Search stays on the page; the filters and the sort live in the
              inline filter menu beside it. */}
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <div className="relative min-w-0 flex-1">
              <Search size={12} className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="text"
                value={convSearch}
                onChange={(event) => setConvSearch(event.target.value)}
                placeholder={tr('Search conversations')}
                aria-label={tr('Search conversations')}
                className="field h-7 w-full ps-6 text-[11.5px]"
              />
            </div>

          <FilterBar
            activeCount={(convSearch ? 1 : 0) + (convFilter ? 1 : 0) + (convSort ? 1 : 0)}
            onClear={clearConversationControls}
            matchCount={visibleConversations.length}
            matchLabel="conversation"
            title={tr('Filter conversations')}
          >
            <FilterField label={tr('Conversations')}>
              <select
                className={filterInputCls}
                value={convFilter}
                onChange={(event) => setConvFilter(event.target.value)}
                aria-label={tr('Filter conversations')}
              >
                <option value="">{tr('All conversations')}</option>
                <option value="unread">{tr('Unread')}</option>
                <option value="with-messages">{tr('With messages')}</option>
              </select>
            </FilterField>
            <FilterField label={tr('Sort by')}>
              <select
                className={filterInputCls}
                value={convSort}
                onChange={(event) => setConvSort(event.target.value)}
                aria-label={tr('Sort conversations')}
              >
                <option value="">{tr('Newest first')}</option>
                <option value="oldest">{tr('Oldest first')}</option>
                <option value="name">{tr('Name (A–Z)')}</option>
                <option value="unread">{tr('Unread first')}</option>
              </select>
            </FilterField>
          </FilterBar>
          </div>
          {loading ? (
            <div className="p-6 text-center text-[11px] text-ink-3 font-medium">{tr("Loading conversations...")}</div>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-[11px] text-ink-3 font-medium">{tr("No conversations yet.")}</p>
              <button
                onClick={() => setPickerOpen(true)}
                className="mt-2 kicker text-ink-2 hover:text-ink cursor-pointer"
              >{tr("Start one")}</button>
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] font-medium text-ink-3">{tr('No conversation matches.')}</p>
              <button
                onClick={clearConversationControls}
                className="mt-2 kicker text-ink-2 hover:text-ink cursor-pointer"
              >
                {tr('Clear filters')}
              </button>
            </div>
          ) : (
            <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {visibleConversations.map(c => {
                const name = displayName(c)
                const unread = c.UNREAD_COUNT || 0
                const active = c.CONVERSATION_ID === openId
                return (
                  <button
                    key={c.CONVERSATION_ID}
                    onClick={() => openThread(c.CONVERSATION_ID)}
                    className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                      active ? 'bg-selection' : 'hover:bg-surface-muted'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-surface-muted text-ink-2 text-[13px] font-semibold flex items-center justify-center shrink-0">
                        {photos[Number(c.OTHER_PERSON_ID)]
                          ? <PhotoZoom src={photos[Number(c.OTHER_PERSON_ID)]} alt={name} />
                          : initialsOf(name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[12.5px] truncate ${unread ? 'font-semibold text-ink' : 'font-semibold text-ink'}`}>
                            {name}
                          </span>
                          {unread > 0 && (
                            <span className="ml-auto min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-ember-solid text-on-ember text-[10px] font-semibold flex items-center justify-center">
                              {unread}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink-3 truncate">
                          {c.LAST_BODY || tr('No messages yet')}
                        </div>
                        <div className="text-[10px] text-ink-3 font-semibold mt-0.5">
                          {c.LAST_AT ? `${lastSpeaker(c, user.id)} · ${fmtDay(c.LAST_AT)}` : fmtLastSeen(c.OTHER_LAST_SEEN_AT)}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Thread */}
        <div className="flex min-h-[22rem] flex-col rounded-md border border-line bg-surface lg:min-h-0">
          {!openId ? (
            <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
              <div className="w-14 h-14 rounded-md bg-surface-muted flex items-center justify-center mb-3">
                <MessageSquare size={24} className="text-ink-3" />
              </div>
              <h4 className="text-[12.5px] font-semibold text-ink">{tr("Pick a conversation")}</h4>
              <p className="text-[12.5px] text-ink-3 font-medium mt-1 max-w-sm">{tr("Choose a thread on the left, or start a new one with someone you are allowed to contact.")}</p>
            </div>
          ) : threadLoading && !thread ? (
            <div className="flex-1 p-8 text-center text-[12.5px] text-ink-3 font-medium flex items-center justify-center gap-2">
              <Loader2 size={15} className="animate-spin" />{' '}{tr("Opening conversation...")}</div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-line flex items-center gap-3">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-jade-solid text-on-jade text-[16px] font-semibold flex items-center justify-center shrink-0">
                  {photos[Number(other?.personId)]
                    ? <PhotoZoom src={photos[Number(other?.personId)]} alt={otherUserName(other)} />
                    : initialsOf(otherUserName(other))}
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink truncate">{otherUserName(other)}</div>
                  <div className="text-[11px] text-ink-3 font-semibold flex items-center gap-1.5">
                    <Clock size={10} /> {fmtLastSeen(other?.lastSeenAt)}
                    {other?.roles?.length > 0 && <span>· {other.roles.join(', ')}</span>}
                  </div>
                </div>
                <span className="ml-auto kicker text-ink-3">@{other?.username}</span>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-surface-muted/40 p-4">
                {messages.length === 0 ? (
                  <p className="text-center text-[11px] text-ink-3 font-medium py-10">{tr("No messages yet — say hello.")}</p>
                ) : (
                  messages.map(m => {
                    const mine = m.SENDER_USER_ID === user.id
                    const day = fmtDay(m.CREATED_AT)
                    const showDay = day !== lastDay
                    lastDay = day
                    return (
                      <React.Fragment key={m.DIRECT_MESSAGE_ID}>
                        {showDay && (
                          <div className="text-center py-1">
                            <span className="px-2 py-0.5 rounded-full bg-surface border border-line text-[10px] font-semibold text-ink-3">
                              {day}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[78%] rounded-md px-3.5 py-2 ${
                            mine
                              ? 'bg-jade-solid text-on-jade rounded-br-md'
                              : 'bg-surface border border-line text-ink rounded-bl-md'
                          }`}>
                            <p className="text-[12.5px] whitespace-pre-wrap break-words" dir="auto">{m.MESSAGE_BODY}</p>
                            <div className={`mt-1 flex items-center gap-1.5 text-[10px] font-semibold ${mine ? 'text-on-jade/70 justify-end' : 'text-ink-3'}`}>
                              {fmtTime(m.CREATED_AT)}
                              {mine && m.SEEN_AT && <CheckCheck size={11} />}
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    )
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {thread?.canSend === false ? (
                <div className="p-4 border-t border-line flex items-center gap-2 text-[11px] font-semibold text-warning-ink bg-warning-bg">
                  <ShieldAlert size={14} />{' '}{tr("An administrator has revoked your permission to message this user.")}</div>
              ) : (
                <form onSubmit={send} className="p-3 border-t border-line flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={onDraftKeyDown}
                    rows={2}
                    maxLength={4000}
                    placeholder={tr("Write a message… (Enter to send, Shift+Enter for a new line)")}
                    className="flex-1 px-3 py-2 bg-surface-muted border border-line rounded-md outline-none focus:border-jade-500 focus:bg-surface focus:ring-4 focus:ring-jade-500/20 text-[12.5px] text-ink transition-all resize-none"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md bg-jade-solid text-on-jade text-[11px] font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                  >
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}{' '}{tr("Send")}</button>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      {/* Contact picker */}
      {pickerOpen && (
        <div className="fixed inset-0 z-40 bg-sunken/85 flex items-center justify-center p-4">
          <div className="bg-raised rounded-md border border-line w-full max-w-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-line flex items-center gap-2">
              <Users size={16} className="text-jade-600" />
              <h4 className="text-[12.5px] font-semibold text-ink">{tr("New message")}</h4>
              <button
                onClick={() => { setPickerOpen(false); setPickerSearch('') }}
                className="ml-auto text-ink-3 hover:text-ink cursor-pointer"
                aria-label={tr("Close")}
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 border-b border-line">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" size={15} />
                <input
                  autoFocus
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  placeholder={tr("Search by name, username or role…")}
                  className="w-full pl-9 pr-3 py-2 bg-surface-muted border border-line rounded-md outline-none focus:border-jade-500 focus:bg-surface focus:ring-4 focus:ring-jade-500/20 text-[12.5px] text-ink transition-all"
                />
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-line">
              {contactsLoading ? (
                <div className="p-6 text-center text-[11px] text-ink-3 font-medium">{tr("Loading people...")}</div>
              ) : contacts.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-[11px] text-ink-2 font-semibold">{tr("Your roles cannot contact anyone yet.")}</p>
                  <p className="text-[11px] text-ink-3 font-medium mt-1">{tr("An administrator decides who can message whom in Options → Message permissions.")}</p>
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="p-6 text-center text-[11px] text-ink-3 font-medium">{tr("Nobody matches that search.")}</div>
              ) : (
                filteredContacts.map(c => {
                  const name = displayName(c)
                  const roles = String(c.ROLE_CODES || '').split(',').map(r => r.trim()).filter(Boolean)
                  return (
                    <button
                      key={c.USER_ID}
                      onClick={() => startWithContact(c)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-muted transition-colors cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-jade-solid text-on-jade text-[13px] font-semibold flex items-center justify-center shrink-0">
                        {photos[Number(c.PERSON_ID)]
                          ? <PhotoZoom src={photos[Number(c.PERSON_ID)]} alt={name} />
                          : initialsOf(name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-semibold text-ink truncate">{name}</div>
                        <div className="text-[11px] text-ink-3 truncate">
                          @{c.USER_USERNAME}{roles.length > 0 ? ` · ${roles.join(', ')}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] font-semibold text-ink-3 flex items-center gap-1 justify-end">
                          <Clock size={10} /> {fmtLastSeen(c.LAST_SEEN_AT)}
                        </div>
                        {c.UNREAD_COUNT > 0 && (
                          <div className="text-[10px] font-semibold text-danger-ink mt-0.5">{c.UNREAD_COUNT}{' '}{tr("unread")}</div>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Who spoke last, for the conversation preview line.
function lastSpeaker(conversation, userId) {
  return conversation.LAST_SENDER_ID === userId ? tr('You') : displayName(conversation)
}

export default DirectMessages
