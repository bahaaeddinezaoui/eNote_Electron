import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, RefreshCw, ShieldAlert, Download, RotateCw } from 'lucide-react'
import WindowControls from './ui/WindowControls'
import AppMark from './ui/AppMark'
import { useI18n } from '../i18n'

// Blocking screen shown when the shared database requires a newer client than
// the one running. On Windows eNote fetches the published installer from the
// LAN share on its own, checks it against the manifest's checksum, and then
// asks for the single click that installs it and restarts. Anywhere the copy
// cannot be made — no share, no manifest, a bad checksum — it falls back to
// pointing the user at the installers folder.
const ERROR_MESSAGES = {
  'missing-file': 'The installer is not on the server share yet. Ask the administrator to publish it.',
  'no-release': 'No release is published for this computer on the server share.',
  'copy-failed': 'The installer could not be copied from the server share.',
  checksum: 'The installer did not match the expected checksum and was discarded. Ask the administrator to publish it again.'
}

const UpdateRequired = ({ status, onRecheck }) => {
  const { t, dir } = useI18n()
  const canAutoUpdate = !!status?.canAutoUpdate
  const [phase, setPhase] = useState(() => {
    if (!canAutoUpdate) return 'unavailable'
    return status?.updateReady ? 'ready' : 'downloading'
  })
  const [progress, setProgress] = useState(status?.updateReady ? 100 : 0)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState(false)
  const startedFor = useRef(null)

  // Copies the release from the share. Safe to call again: the main process
  // shares one copy and returns the finished file to every caller.
  const runDownload = useCallback(async () => {
    setError('')
    setProgress(0)
    setPhase('downloading')
    try {
      const result = await window.api.downloadUpdate()
      if (result?.ok) {
        setProgress(100)
        setPhase('ready')
      } else {
        setError(result?.error || 'copy-failed')
        setPhase('failed')
      }
    } catch {
      setError('copy-failed')
      setPhase('failed')
    }
  }, [])

  // The download starts by itself as soon as the screen appears, and again if a
  // later check points at a different release.
  useEffect(() => {
    if (status?.updateReady) {
      setProgress(100)
      setPhase('ready')
      return
    }
    if (!canAutoUpdate) return
    const unsubscribe = window.api.onUpdateProgress?.((percent) => setProgress(percent))
    if (startedFor.current !== status?.targetVersion) {
      startedFor.current = status?.targetVersion
      runDownload()
    }
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [canAutoUpdate, status?.updateReady, status?.targetVersion, runDownload])

  const install = async () => {
    setPhase('installing')
    try {
      const result = await window.api.installUpdate()
      if (!result?.ok) {
        setError(result?.error || 'copy-failed')
        setPhase('failed')
      }
      // On success the installer takes over and this window goes away.
    } catch {
      setError('copy-failed')
      setPhase('failed')
    }
  }

  const retry = () => {
    runDownload()
  }

  const openInstallers = async () => {
    setOpening(true)
    setOpenError(false)
    try {
      const result = await window.api.openUpdateInstallerFolder()
      if (!result?.opened) setOpenError(true)
    } catch {
      setOpenError(true)
    } finally {
      setOpening(false)
    }
  }

  const recheck = async () => {
    setChecking(true)
    try {
      await onRecheck?.()
    } finally {
      setChecking(false)
    }
  }

  const targetVersion = status?.targetVersion || status?.requiredVersion
  const showFallback = phase === 'unavailable' || phase === 'failed'

  return (
    <div dir={dir} className="flex h-screen flex-col overflow-y-auto bg-canvas text-ink">
      {/* The window is frameless, so this strip is the caption: it drags, and
          the caption buttons close the window even while the app is blocked. */}
      <header className="app-titlebar flex h-11 shrink-0 items-stretch border-b border-line bg-surface">
        <div className="app-drag flex items-stretch gap-2.5 border-e border-line ps-4 pe-4">
          <AppMark className="my-auto h-[24px] w-[24px]" />
          <div className="my-auto min-w-0 leading-none">
            <div className="serif truncate text-[15px] tracking-[-0.01em] text-ink">eNote</div>
            <div className="kicker mt-[3px] truncate text-[8.5px]">{t('Academic registry')}</div>
          </div>
        </div>
        <div className="min-w-0 flex-1" />
        <WindowControls />
      </header>

      <main className="grid flex-1 place-items-center px-6 py-10">
        <div className="w-full max-w-[540px]">
          <span className="mb-5 inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-line-strong bg-surface-muted text-warning-ink">
            <ShieldAlert size={17} />
          </span>

          <div className="kicker text-[9px]">{t('Update required')}</div>
          <h1 className="serif mt-1 text-[26px] leading-tight tracking-[-0.01em] text-ink">
            {phase === 'ready' || phase === 'installing'
              ? t('eNote is ready to be updated.')
              : t('This version of eNote can no longer use the server.')}
          </h1>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
            {t('The server requires version {required} or newer, and this computer is running {current}.', {
              required: status?.requiredVersion || '—',
              current: status?.currentVersion || '—'
            })}
          </p>

          {canAutoUpdate && (
            <div className="mt-5">
              {phase === 'downloading' && (
                <>
                  <div className="flex items-center justify-between text-[11px] text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Download size={12} /> {t('Copying version {version} from the server share…', { version: targetVersion })}
                    </span>
                    <span className="mono text-ink-3">{progress}%</span>
                  </div>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-jade-solid transition-[width] duration-200" style={{ width: `${progress}%` }} />
                  </div>
                </>
              )}

              {phase === 'ready' && (
                <p className="text-[12px] leading-relaxed text-ink-2">
                  {t('Version {version} has been copied and checked.', { version: targetVersion })}
                </p>
              )}

              {phase === 'installing' && (
                <p className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                  <RotateCw size={13} className="animate-spin" /> {t('Installing… eNote will close and reopen by itself.')}
                </p>
              )}

              {(phase === 'ready' || phase === 'installing') && (
                <button
                  type="button"
                  onClick={install}
                  disabled={phase === 'installing'}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-[4px] bg-jade-solid px-3 text-[12px] font-semibold text-on-jade hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCw size={13} /> {t('Restart and update')}
                </button>
              )}
            </div>
          )}

          {phase === 'failed' && (
            <p className="mt-4 text-[11.5px] leading-relaxed text-warning-ink">
              {t(ERROR_MESSAGES[error] || ERROR_MESSAGES['copy-failed'])}
            </p>
          )}

          {showFallback && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={openInstallers}
                disabled={opening}
                className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-3 text-[12px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderOpen size={13} /> {t('Open the installers folder')}
              </button>
              {canAutoUpdate && (
                <button
                  type="button"
                  onClick={retry}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-3 text-[12px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
                >
                  <Download size={13} /> {t('Try again')}
                </button>
              )}
            </div>
          )}

          <div className="mt-5 border-t border-line pt-3">
            <button
              type="button"
              onClick={recheck}
              disabled={checking}
              className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={12} className={checking ? 'animate-spin' : undefined} /> {t('Check again')}
            </button>
          </div>

          {openError && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
              {t('The installers folder could not be opened on this computer. Ask the administrator for the new version, or open the server share yourself.')}
            </p>
          )}
        </div>
      </main>
    </div>
  )
}

export default UpdateRequired
