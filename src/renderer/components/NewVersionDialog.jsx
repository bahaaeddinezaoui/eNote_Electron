import React, { useEffect, useState } from 'react'
import { formatDate } from '../dateFormat'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Sparkles } from 'lucide-react'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { useI18n } from '../i18n'

// "A new version is out." Shown once per account and per release: the main
// process returns the newest changelog entry this account has not been shown
// (user_seen_changelog), and the release is recorded the moment the dialog is
// on screen, so the same release never interrupts the same person twice.
//
// Recording on display rather than on dismissal is deliberate: the page
// underneath is fully usable, so a reader who changes screen without pressing
// either button — or who closes the window with the note open, or hits a crash —
// would otherwise be asked again on the next screen or the next launch. Every
// way out still records it too; the write is idempotent.
//
// Only the newest release is announced. Somebody who has been away for three
// versions gets one dialog; the rest of the history is one click away on the
// changelog page.
//
// The same dialog is opened on demand from Settings ("What's new"), where the
// release has already been seen — so its presentation lives in
// ReleaseNoteDialog, and only the automatic one records anything.

const pick = (lang, en, ar, fr) => {
  if (lang === 'ar') return ar || en || ''
  if (lang === 'fr') return fr || en || ''
  return en || ''
}

export const formatReleaseDate = (value) => {
  if (!value) return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(value)
  if (isNaN(d.getTime())) return ''
  return formatDate(d, { day: '2-digit', month: 'short', year: 'numeric' })
}

// Pure presentation: a release entry (changelog row + FEATURES) rendered in the
// interface language, with no fetching and no side effects.
export const ReleaseNoteDialog = ({ entry, open, onClose, footer }) => {
  const { lang, t } = useI18n()

  if (!entry) return null

  const title = pick(lang, entry.TITLE_EN, entry.TITLE_AR, entry.TITLE_FR)
  const released = formatReleaseDate(entry.RELEASE_DATE)
  const features = (entry.FEATURES || [])
    .map((f) => ({
      id: f.FEATURE_ID,
      text: pick(lang, f.FEATURE_TEXT_EN, f.FEATURE_TEXT_AR, f.FEATURE_TEXT_FR)
    }))
    .filter((f) => f.text)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Release notes')}
      maxWidth="max-w-[520px]"
      footer={footer}
    >
      <div>
        <div className="flex items-center gap-2">
          <span
            className="mono inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ background: 'var(--color-jade-50)', color: 'var(--color-jade-600)' }}
          >
            <Sparkles size={10} /> {t('Release notes')}
          </span>
          <span className="mono ms-auto text-[10px] text-ink-3">
            {released && `${t('Released')} ${released}`}
          </span>
        </div>

        <h2 className="serif mt-2.5 text-[26px] leading-none text-ink">
          {t('Version')} {entry.VERSION}
        </h2>
        {title && <p className="mt-1.5 text-[12.5px] font-medium text-ink-2">{title}</p>}

        {features.length > 0 && (
          <ul className="mt-3.5 space-y-1.5 border-t border-line pt-3">
            {features.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
                <span className="mt-1.5 h-[3px] w-[3px] shrink-0 rounded-full" style={{ background: 'var(--color-jade-500)' }} aria-hidden="true" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

const NewVersionDialog = ({ user }) => {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [entry, setEntry] = useState(null)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    window.api
      .getPendingChangelog(user.id)
      .then((res) => {
        if (!alive) return
        const next = res?.changelog || null
        if (!next) return
        setEntry(next)
        setOpen(true)
        // Shown is seen: the dialog is on screen now, and it must not come back
        // on the next route change or the next launch because nobody pressed a
        // button yet. Failure here only means the old behaviour (recorded on
        // dismissal), which the handlers below still do.
        window.api.markChangelogSeen(user.id, next.CHANGELOG_ID).catch(() => {})
      })
      // A release note is not worth interrupting a session over if it cannot be
      // read: the changelog page is always available from the sidebar.
      .catch(() => {})
    return () => { alive = false }
  }, [user?.id])

  const dismiss = (goToChangelog) => {
    if (entry && user?.id) {
      window.api.markChangelogSeen(user.id, entry.CHANGELOG_ID).catch(() => {})
    }
    setOpen(false)
    setClosing(false)
    if (goToChangelog) navigate('/changelog')
  }

  if (!entry) return null

  return (
    <ReleaseNoteDialog
      entry={entry}
      open={open}
      onClose={() => dismiss(false)}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setClosing(true)
              dismiss(true)
            }}
            disabled={closing}
          >
            {t('Open the changelog')} <ArrowRight size={12} className="rtl:rotate-180" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="mono hidden text-[9.5px] text-ink-3 sm:inline">
              {t('Announced once per account')}
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                setClosing(true)
                dismiss(false)
              }}
              disabled={closing}
            >
              {t('Got it')}
            </Button>
          </div>
        </div>
      }
    />
  )
}

export default NewVersionDialog
