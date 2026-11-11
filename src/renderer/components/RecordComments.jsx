import React, { useEffect, useRef, useState } from 'react'
import { formatDateTime } from '../dateFormat'
import { MessageSquare, Send, Trash2, Lock } from 'lucide-react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useI18n } from '../i18n'

// Director comments on one absence or observation.
//
// The thread belongs to the record, not to the notification that announced it:
// every director reads and writes the same list, whoever recorded the absence
// and whoever opened the notification first. The store is director_comment,
// addressed by the record's stable key (see migration_app_notification.sql),
// and only the author may delete their own comment.
//
// `readOnly` gives the same thread to a reader who is not a director — an Admin
// consulting a week's records. The composer and the delete buttons disappear and
// the footer says why; the server refuses writes from anyone without DIRECTOR in
// any case.

const fmtWhen = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return String(value)
  return formatDateTime(d, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

const RecordComments = ({ user, open, onClose, recordKey, title, detail, onCountChange, readOnly = false }) => {
  const { t } = useI18n()
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!open || !recordKey) return
    setLoading(true)
    setError('')
    setDraft('')
    setComments([])
    window.api.getNotificationComments(user.id, recordKey)
      .then(res => {
        if (!alive.current) return
        const list = res?.data || []
        setComments(list)
        onCountChange?.(list.length)
      })
      .catch(err => { if (alive.current) setError(err.message || t('Failed to load comments.')) })
      .finally(() => { if (alive.current) setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recordKey])

  const post = async () => {
    const text = draft.trim()
    if (!text || posting) return
    setPosting(true)
    setError('')
    try {
      const res = await window.api.addNotificationComment(user.id, recordKey, text)
      const added = res?.comment
      if (added) {
        setComments(list => {
          const next = [...list, added]
          onCountChange?.(next.length)
          return next
        })
      }
      setDraft('')
    } catch (err) {
      setError(err.message || t('Failed to post the comment.'))
    } finally {
      setPosting(false)
    }
  }

  const remove = async (comment) => {
    setError('')
    try {
      await window.api.deleteNotificationComment(user.id, comment.DIRECTOR_COMMENT_ID)
      setComments(list => {
        const next = list.filter(c => c.DIRECTOR_COMMENT_ID !== comment.DIRECTOR_COMMENT_ID)
        onCountChange?.(next.length)
        return next
      })
    } catch (err) {
      setError(err.message || t('Failed to delete the comment.'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ? `${t('Comments')} · ${title}` : t('Comments')}
      maxWidth="max-w-[560px]"
      footer={
        <div className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
          <Lock size={11} />
          {readOnly
            ? t('Read-only: only directors can add or delete comments.')
            : t('Visible to every director. Only the author can delete a comment.')}
        </div>
      }
    >
      {detail && (
        <p className="mono mb-3 border-s-2 border-line-strong ps-2 text-[10.5px] leading-relaxed text-ink-2">
          {detail}
        </p>
      )}

      {error && (
        <p className="mb-2.5 border border-danger/40 bg-danger-bg px-2.5 py-1.5 text-[11px] text-danger-ink">{error}</p>
      )}

      {loading ? (
        <p className="py-6 text-center text-[11.5px] text-ink-3">{t('Loading comments…')}</p>
      ) : comments.length === 0 ? (
        <div className="py-6 text-center">
          <MessageSquare size={18} className="mx-auto text-ink-3" />
          <p className="mt-2 text-[11.5px] text-ink-3">{t('No comments on this record yet.')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {comments.map(c => (
            <li key={c.DIRECTOR_COMMENT_ID} className="flex items-start gap-2 border border-line bg-canvas px-2.5 py-2">
              <span className="mono mt-px grid h-5 w-5 shrink-0 place-items-center rounded-[3px] border border-line-strong text-[9px] text-ink-2">
                {(c.DIRECTOR_NAME || '?').charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium text-ink">{c.DIRECTOR_NAME}</span>
                  <span className="mono text-[9.5px] text-ink-3">{fmtWhen(c.CREATED_AT)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-2">{c.COMMENT_TEXT}</p>
              </div>
              {!readOnly && c.DIRECTOR_PERSON_ID === user.personId && (
                <button
                  type="button"
                  onClick={() => remove(c)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                  title={t('Delete comment')}
                  aria-label={t('Delete comment')}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('Write a comment on this record…')}
            rows={3}
            maxLength={2000}
            className="field min-h-[64px] flex-1 resize-y text-[11.5px]"
          />
          <Button size="md" onClick={post} disabled={posting || !draft.trim()} loading={posting}>
            {!posting && <Send size={12} />} {t('Post')}
          </Button>
        </div>
      )}
    </Modal>
  )
}

export default RecordComments
