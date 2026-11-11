import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, AtSign, CalendarDays, Fingerprint, RefreshCw, Settings, ShieldCheck
} from 'lucide-react'
import { PageIntro, Panel, PanelHeader } from './ui/PageHeader'
import PhotoZoom from './ui/PhotoZoom'
import { tr, useI18n } from '../i18n'

// Read-only view of the signed-in account: who the account belongs to, what it
// may do, and the way to the Settings page that owns the editable parts.
//
// The page borrows the rest of the application's grammar — PageIntro masthead,
// hairline panels, kicker labels, tabular identifiers — so it does not read as a
// separate product. Everything here is either data or an action; there is no
// decorative card, no colour-only state, and no field the reader cannot act on.

const DATE_LOCALES = { en: 'en-GB', ar: 'ar-DZ', fr: 'fr-FR' }

const formatDate = (value, lang) => {
  if (!value) return null
  const date = new Date(value)
  if (isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString(DATE_LOCALES[lang] || DATE_LOCALES.en, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

const roleLabel = (role) => tr(
  String(role || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
)

// One label/value pair. `dt`/`dd` keep the page readable to a screen reader as a
// list of facts rather than a row of loose text.
const Field = ({ label, value, mono = false, breakAll = false }) => (
  <div className="min-w-0">
    <dt className="kicker text-[9px]">{label}</dt>
    <dd
      className={`mt-1 text-[12.5px] leading-snug text-ink ${mono ? 'mono text-[11.5px]' : ''} ${
        breakAll ? 'break-words' : 'truncate'
      }`}
      title={typeof value === 'string' ? value : undefined}
    >
      {value || '—'}
    </dd>
  </div>
)

const Profile = ({ user }) => {
  const { t, lang } = useI18n()
  const [profile, setProfile] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadProfile = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await window.api.getMyProfile(user.id)
      const next = res?.profile || null
      setProfile(next)

      // Photos are files on this machine, read through the main process: the
      // renderer gets a data URL and never a path the CSP would refuse.
      if (next?.photo) {
        try {
          const photos = await window.api.readPersonPhotos([next.photo])
          setPhotoUrl(photos?.dataUrls?.[0] || null)
        } catch {
          setPhotoUrl(null)
        }
      } else {
        setPhotoUrl(null)
      }
    } catch (err) {
      setError(err.message || tr('Could not load your profile.'))
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user?.id) loadProfile()
  }, [user?.id])

  const fullName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.username
    : ''
  const initials = profile
    ? `${(profile.firstName || '?').charAt(0)}${(profile.lastName || '').charAt(0)}`.toUpperCase()
    : '?'
  // The account role first (what this login may do), then the person's own
  // roles (who they are here). The card shows both, each as a description.
  const accountRole = profile?.accountRole || (Array.isArray(profile?.roles) ? profile.roles[0] : '') || ''
  const roles = [...new Set([accountRole, ...(profile?.personRoles || [])].filter(Boolean))]
  const sexLabel =
    profile?.sex === 'F' ? t('Female') : profile?.sex === 'M' ? t('Male') : null

  const settingsAction = (
    <Link
      to="/settings"
      className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
    >
      <Settings size={13} strokeWidth={1.75} />
      {t('Open settings')}
    </Link>
  )

  return (
    <div className="space-y-4">
      <PageIntro
        kicker={t('Account')}
        title={t('My Profile')}
        meta={t('Read-only')}
        actions={settingsAction}
      >
        <p className="mt-1 max-w-2xl text-[12px] leading-snug text-ink-2">
          {t('Your account information')}
        </p>
      </PageIntro>

      {error ? (
        <Panel>
          <div
            role="alert"
            className="flex flex-col items-start gap-3 px-4 py-5 sm:flex-row sm:items-center"
            style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-ink)' }}
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium">{t('Could not load your profile.')}</p>
              <p className="mt-0.5 text-[11px] leading-snug opacity-90">{error}</p>
            </div>
            <button
              type="button"
              onClick={loadProfile}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              <RefreshCw size={11} />
              {t('Try again')}
            </button>
          </div>
        </Panel>
      ) : loading ? (
        <div
          className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start"
          aria-busy="true"
        >
          <span className="sr-only">{t('Loading profile...')}</span>
          <div className="h-[360px] rounded-md border border-line bg-surface" />
          <div className="space-y-4">
            <div className="h-[190px] rounded-md border border-line bg-surface" />
            <div className="h-[130px] rounded-md border border-line bg-surface" />
          </div>
        </div>
      ) : !profile ? (
        <Panel>
          <div className="flex flex-col items-start gap-3 px-4 py-5">
            <p className="text-[12px] text-ink-2">{t('No profile data is available.')}</p>
            <button
              type="button"
              onClick={loadProfile}
              className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              <RefreshCw size={11} />
              {t('Try again')}
            </button>
          </div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
          {/* ---- Identity ---- */}
          <Panel>
            <div className="flex flex-col items-center px-5 py-6 text-center">
              {photoUrl ? (
                <PhotoZoom
                  src={photoUrl}
                  alt={fullName}
                  className="h-28 w-28 rounded-full border border-line object-cover"
                />
              ) : (
                <div
                  className="grid h-28 w-28 place-items-center rounded-full border border-line text-[34px] font-semibold"
                  style={{ background: 'var(--color-surface-muted)', color: 'var(--color-ink-2)' }}
                  aria-hidden="true"
                >
                  {initials}
                </div>
              )}

              <h2 className="serif mt-4 max-w-full break-words text-[23px] leading-[28px] tracking-[-0.01em] text-ink">
                {fullName || '—'}
              </h2>
              <p className="mono mt-1 flex items-center gap-1 text-[11px] text-ink-3">
                <AtSign size={11} strokeWidth={1.9} aria-hidden="true" />
                {profile.username || '—'}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                {roles.length === 0 ? (
                  <span className="text-[10.5px] text-ink-3">{t('No role assigned')}</span>
                ) : (
                  roles.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center gap-1 rounded-[3px] border border-line-strong bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-ink-2"
                    >
                      <ShieldCheck size={10} strokeWidth={2} style={{ color: 'var(--color-jade-600)' }} aria-hidden="true" />
                      {roleLabel(role)}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div className="border-t border-line px-5 py-4">
              <h3 className="kicker text-[9px]">{t('Account')}</h3>
              <dl className="mt-2.5 space-y-3">
                <Field label={t('Username')} value={profile.username ? `@${profile.username}` : null} mono breakAll />
                <Field
                  label={t('Person ID')}
                  value={profile.personId ? `#${String(profile.personId).padStart(4, '0')}` : null}
                  mono
                />
                <Field label={t('Member since')} value={formatDate(profile.createdAt, lang)} />
              </dl>
            </div>
          </Panel>

          {/* ---- Details and the way to edit them ---- */}
          <div className="space-y-4">
            <Panel>
              <PanelHeader title={t('Personal information')} />
              <dl className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2">
                <Field label={t('First name')} value={profile.firstName} breakAll />
                <Field label={t('Last name')} value={profile.lastName} breakAll />
                <div className="min-w-0">
                  <dt className="kicker text-[9px]">{t('Birthdate')}</dt>
                  <dd className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink">
                    <CalendarDays size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
                    {formatDate(profile.birthdate, lang) || '—'}
                  </dd>
                </div>
                <Field label={t('Sex')} value={sexLabel} />
              </dl>
              <p className="border-t border-line px-4 py-2.5 text-[10.5px] leading-relaxed text-ink-3">
                {t('Personal details are maintained by the administration.')}
              </p>
            </Panel>

            <Panel>
              <PanelHeader title={t('Security')} />
              <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12px] leading-snug text-ink">
                    {t('Your username and password are managed on the Settings page.')}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">
                    {t('There is no self-service password reset: ask an administrator.')}
                  </p>
                </div>
                <Link
                  to="/settings"
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[11.5px] font-semibold text-on-jade hover:brightness-110"
                >
                  <Fingerprint size={13} strokeWidth={1.9} aria-hidden="true" />
                  {t('Open settings')}
                </Link>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}

export default Profile
