import React, { useCallback, useEffect, useState } from 'react'
import Modal from './ui/Modal'
import { useI18n } from '../i18n'
import { dateLocale } from '../scheduleUtils'

// What is saved on this computer, and how old each copy is.
//
// The amber strip says the records are saved copies; this says which copies, how
// many, and when they were taken — so a teacher deciding whether the roster on
// screen is current has an answer that is not a guess.

const sizeOf = (bytes) => {
  const value = Number(bytes) || 0
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  if (value >= 1024) return `${Math.round(value / 1024)} KB`
  return `${value} B`
}

const stamp = (value) => {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat(dateLocale(), {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return ''
  }
}

export default function OfflineStatusPanel({ open, onClose }) {
  const { t } = useI18n()
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const next = await window.api.getOfflineSummary()
      setSummary(next || null)
      setError('')
    } catch (err) {
      setError(t('The saved copies could not be read on this computer.'))
    }
  }, [t])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const records = summary?.records || {}
  const photos = summary?.photos || {}
  const rosters = summary?.rosters || null

  const rows = [
    {
      key: 'records',
      label: t('Records'),
      bytes: records.bytes,
      count: t('{count} results', { count: Number(records.entries) || 0 }),
      detail: records.lastSyncAt
        ? t('As of {when}', { when: stamp(records.lastSyncAt) })
        : t('Nothing saved yet.')
    },
    {
      key: 'photos',
      label: t('Photos'),
      bytes: photos.bytes,
      count: t('{count} photos', { count: Number(photos.count) || 0 }),
      detail: photos.lastUsedAt
        ? t('Last used {when}', { when: stamp(photos.lastUsedAt) })
        : t('Nothing saved yet.')
    },
    {
      key: 'rosters',
      label: t('Session rosters'),
      bytes: null,
      count: t('{count} sessions', { count: Number(rosters?.sessions) || 0 }),
      detail: rosters?.at ? t('Read {when}', { when: stamp(rosters.at) }) : t('Nothing saved yet.')
    }
  ]

  return (
    <Modal open={open} onClose={onClose} title={t('What is saved on this computer')}>
      {error ? (
        <p role="alert" className="text-[11px] leading-relaxed" style={{ color: 'var(--color-danger-ink)' }}>
          {error}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="border border-line bg-surface px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium text-ink">{row.label}</span>
                {row.bytes != null ? (
                  <span className="mono text-[10px] text-ink-3">{sizeOf(row.bytes)}</span>
                ) : null}
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-2">
                {row.count}
                <span className="text-ink-3"> · {row.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[10.5px] leading-relaxed text-ink-3">
        {t('Kept only for outages: the server is always read when it answers.')}
      </p>
    </Modal>
  )
}
