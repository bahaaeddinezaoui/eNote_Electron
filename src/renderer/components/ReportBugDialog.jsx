import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Bug, Check, Loader2, Upload, X } from 'lucide-react'
import Modal from './ui/Modal'
import { tr } from '../i18n'
import { useDraft } from '../useDraft'

// Reporting a problem should never cost the user the screen they were looking
// at, so the form lives in a dialog and opens over whatever is already there.
// The history of what happened to earlier reports stays on /report-bug, which
// the footer links to.

const PRIORITIES = ['low', 'medium', 'high', 'critical']

const fieldCls =
  'w-full rounded-[4px] border border-line-strong bg-surface px-2.5 py-2 text-[12px] text-ink outline-none focus:border-jade-500 focus:ring-2 focus:ring-jade-500/20'

const labelCls = 'kicker mb-1 block text-[9px]'

const ReportBugDialog = ({ user, open, onClose, onSubmitted }) => {
  const navigate = useNavigate()
  // Only ADMIN/DEVELOPER pick a priority; every other account files as medium.
  const canSetPriority = !!user && (
    user.roles?.includes('ADMIN') || user.roles?.includes('DEVELOPER')
  )

  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [screenshotPath, setScreenshotPath] = useState('')
  const [screenshotName, setScreenshotName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  // True when the report went into the offline queue instead of the server.
  const [queued, setQueued] = useState(false)
  const [error, setError] = useState('')

  // Each opening starts a blank report: a cancelled draft must not reappear
  // under a different context later.
  useEffect(() => {
    if (!open) return
    setSubject('')
    setDescription('')
    setPriority('medium')
    setScreenshotPath('')
    setScreenshotName('')
    setError('')
    setSubmitted(false)
    setQueued(false)
  }, [open])

  // A half-written report survives closing the dialog, a refresh or an outage.
  const {
    draft: savedDraft,
    restore: restoreDraft,
    discard: discardDraft,
    clear: clearDraft
  } = useDraft({
    key: 'bug-report',
    userId: user?.id,
    value: { subject, description, priority, screenshotPath, screenshotName },
    enabled: !submitted && (subject.trim() !== '' || description.trim() !== ''),
    reloadOn: open,
    onRestore: (value) => {
      if (!value || typeof value !== 'object') return
      setSubject(String(value.subject || ''))
      setDescription(String(value.description || ''))
      if (PRIORITIES.includes(value.priority)) setPriority(value.priority)
      setScreenshotPath(String(value.screenshotPath || ''))
      setScreenshotName(String(value.screenshotName || ''))
    }
  })

  const close = () => {
    if (submitting) return
    onClose()
  }

  const pickScreenshot = async () => {
    try {
      const result = await window.api.openFileDialog()
      if (result.canceled || result.filePaths.length === 0) return
      const filePath = result.filePaths[0]
      const up = await window.api.uploadBugScreenshot(filePath, user?.id)
      if (up?.success) {
        setScreenshotPath(up.path)
        setScreenshotName(filePath.split(/[\\/]/).pop())
      }
    } catch (err) {
      setError(`${tr('Screenshot upload failed')}: ${err.message}`)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (!subject.trim() || !description.trim()) {
      setError(tr('Subject and description are required.'))
      return
    }
    setSubmitting(true)
    try {
      const res = await window.api.createBugReport(user.id, {
        REPORT_SUBJECT: subject,
        REPORT_DESCRIPTION: description,
        REPORT_PRIORITY: priority,
        REPORT_SCREENSHOT_PATH: screenshotPath || null
      })
      setQueued(!!res?.queued)
      // The report was submitted (or queued): the draft has done its job.
      clearDraft()
      setSubmitted(true)
      onSubmitted?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={tr('Report a bug')}
      description={tr('Found something broken? Describe it below and the team will take a look.')}
      maxWidth="max-w-[560px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { onClose(); navigate('/report-bug') }}
            className="text-[10.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
          >
            {tr('Your reports')}
          </button>
          <div className="flex items-center gap-1.5">
            {submitted ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-7 items-center rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110"
              >
                {tr('Close')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={close}
                  disabled={submitting}
                  className="inline-flex h-7 items-center rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted disabled:opacity-40"
                >
                  {tr('Cancel')}
                </button>
                <button
                  type="submit"
                  form="bug-report-form"
                  disabled={submitting || !subject.trim() || !description.trim()}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[4px] bg-jade-solid px-2.5 text-[11px] font-semibold text-on-jade hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Bug size={12} />}
                  {submitting ? tr('Submitting...') : tr('Submit report')}
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      {submitted ? (
        <div className="flex flex-col items-center gap-2 py-9 text-center">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-jade-500/40 bg-selection text-jade-600">
            <Check size={16} />
          </span>
          {queued ? (
            <>
              <p className="text-[12.5px] font-medium text-ink">{tr('Your bug report was saved on this computer.')}</p>
              <p className="max-w-[36ch] text-[11px] leading-relaxed text-ink-3">
                {tr('It will be sent when the server is back.')}
              </p>
            </>
          ) : (
            <>
              <p className="text-[12.5px] font-medium text-ink">{tr('Your bug report was submitted. Thank you!')}</p>
              <p className="max-w-[36ch] text-[11px] leading-relaxed text-ink-3">
                {tr('You can follow its status under Your reports.')}
              </p>
            </>
          )}
        </div>
      ) : (
        <form id="bug-report-form" onSubmit={submit} className="space-y-3.5">
          {savedDraft && (
            <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-warning/40 bg-warning-bg px-2.5 py-2 text-[11.5px] text-warning-ink">
              <span>
                {tr('Unsaved work from {when} is saved on this computer.', {
                  when: new Date(savedDraft.savedAt).toLocaleString()
                })}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={restoreDraft}
                  className="rounded-[3px] border border-line-strong bg-surface px-2 py-0.5 font-medium text-ink-2 hover:bg-surface-muted"
                >
                  {tr('Restore')}
                </button>
                <button
                  type="button"
                  onClick={discardDraft}
                  className="text-ink-3 underline-offset-2 hover:text-ink hover:underline"
                >
                  {tr('Discard')}
                </button>
              </span>
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-[4px] border border-danger/40 bg-danger-bg px-2.5 py-2 text-[11.5px] text-danger-ink">
              <AlertCircle size={13} /> {error}
            </div>
          )}

          <div>
            <label htmlFor="bug-subject" className={labelCls}>{tr('Subject')} *</label>
            <input
              id="bug-subject"
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={tr('Short summary of the problem')}
              maxLength={255}
              className={fieldCls}
            />
          </div>

          <div>
            <label htmlFor="bug-description" className={labelCls}>{tr('Description')} *</label>
            <textarea
              id="bug-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={6}
              placeholder={tr('What happened? What did you expect instead? Steps to reproduce help a lot.')}
              className={`${fieldCls} resize-y leading-relaxed`}
            />
          </div>

          <div className={`grid grid-cols-1 gap-3.5 ${canSetPriority ? 'sm:grid-cols-2' : ''}`}>
            {canSetPriority && (
              <div>
                <label htmlFor="bug-priority" className={labelCls}>{tr('Priority')}</label>
                <select
                  id="bug-priority"
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  className={`${fieldCls} capitalize`}
                >
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
            <div>
              <span className={labelCls}>{tr('Screenshot (optional)')}</span>
              {screenshotPath ? (
                <div className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-surface-muted px-2.5 py-1.5 text-[11.5px]">
                  <span className="truncate text-ink-2">{screenshotName}</span>
                  <button
                    type="button"
                    onClick={() => { setScreenshotPath(''); setScreenshotName('') }}
                    aria-label={tr('Remove screenshot')}
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-danger-bg hover:text-danger-ink"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={pickScreenshot}
                  className="inline-flex h-[34px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-dashed border-line-strong px-2.5 text-[11.5px] font-medium text-ink-3 hover:border-jade-500/60 hover:text-jade-600"
                >
                  <Upload size={13} /> {tr('Attach a screenshot')}
                </button>
              )}
            </div>
          </div>
        </form>
      )}
    </Modal>
  )
}

export default ReportBugDialog
