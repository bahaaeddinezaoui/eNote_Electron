import React, { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, PlayCircle, Video } from 'lucide-react'
import { useI18n } from '../i18n'
import { getTutorialRoles } from '../tutorials'

// The tutorial card on the landing page: one walkthrough per role, chosen with
// the arrows or the dots, exactly as the previous application presented it.
//
// The videos ship with the application (see src/renderer/assets/tutorials), so
// nothing is fetched and the card works signed-out with no database. A role
// whose recording does not exist yet keeps its place and shows a placeholder
// instead of a player — the section is complete either way.
const TutorialVideos = () => {
  const { t } = useI18n()
  const roles = useMemo(() => getTutorialRoles(), [])
  const [roleIndex, setRoleIndex] = useState(0)
  const [clipIndex, setClipIndex] = useState(0)

  const total = roles.length
  const role = roles[roleIndex]
  const clip = role?.videos?.[clipIndex] || null

  const step = (delta) => {
    setRoleIndex((current) => (current + delta + total) % total)
    setClipIndex(0)
  }

  const jumpTo = (index) => {
    setRoleIndex(index)
    setClipIndex(0)
  }

  if (!role) return null

  const arrowClass =
    'grid h-7 w-7 place-items-center rounded-[3px] border border-line-strong bg-surface text-ink-2 transition-colors hover:bg-surface-muted hover:text-ink'

  return (
    <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PlayCircle size={14} strokeWidth={1.9} style={{ color: 'var(--color-ember-600)' }} aria-hidden="true" />
            <h3 className="text-[12.5px] font-semibold text-ink">{t('Tutorial video')}</h3>
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
            {t('Watch a short walkthrough of the main features available to your role.')}
          </p>
        </div>
        <span className="mono shrink-0 text-[10.5px] text-ink-3">
          {roleIndex + 1} / {total}
        </span>
      </div>

      {clip ? (
        <video
          key={clip.url}
          src={clip.url}
          controls
          preload="metadata"
          playsInline
          className="aspect-video w-full bg-black"
        />
      ) : (
        <div className="grid aspect-video w-full place-items-center bg-surface-muted">
          <div className="px-6 text-center">
            <Video size={22} strokeWidth={1.6} className="mx-auto text-ink-3" aria-hidden="true" />
            <p className="mt-2 text-[12px] font-medium text-ink">{t('Recording coming soon')}</p>
            <p className="mx-auto mt-1 max-w-[320px] text-[11px] leading-relaxed text-ink-3">
              {t("This role's walkthrough is being recorded. The other roles are available now.")}
            </p>
          </div>
        </div>
      )}

      <div className="border-t border-line px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h4 className="serif text-[19px] leading-[24px] text-ink">{t(role.label)}</h4>
          <span className="mono ms-auto shrink-0 text-[9.5px] text-ink-3">
            {clip
              ? clip.name
              : `${String(roleIndex + 1).padStart(2, '0')} · ${t('Not recorded yet')}`}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{t(role.summary)}</p>

        {role.videos.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {role.videos.map((video, index) => (
              <button
                key={video.url}
                type="button"
                onClick={() => setClipIndex(index)}
                aria-pressed={index === clipIndex}
                className={`h-5 rounded-[3px] border px-1.5 text-[10px] ${
                  index === clipIndex
                    ? 'border-jade-600 text-jade-600'
                    : 'border-line-strong text-ink-3 hover:text-ink'
                }`}
              >
                {t('Part {number}', { number: index + 1 })}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-muted px-3 py-2">
        <button type="button" onClick={() => step(-1)} className={arrowClass} aria-label={t('Previous role')}>
          <ChevronLeft size={14} strokeWidth={2} className="rtl:rotate-180" />
        </button>

        <div className="flex items-center justify-center gap-1.5">
          {roles.map((item, index) => (
            <button
              key={item.slug}
              type="button"
              onClick={() => jumpTo(index)}
              aria-label={t(item.label)}
              aria-current={index === roleIndex ? 'true' : undefined}
              className={`h-1.5 rounded-full transition-all ${
                index === roleIndex ? 'w-4' : 'w-1.5'
              }`}
              style={{
                background:
                  index === roleIndex
                    ? 'var(--color-jade-solid)'
                    : item.videos.length > 0
                      ? 'var(--color-line-strong)'
                      : 'color-mix(in srgb, var(--color-line-strong) 45%, transparent)'
              }}
            />
          ))}
        </div>

        <button type="button" onClick={() => step(1)} className={arrowClass} aria-label={t('Next role')}>
          <ChevronRight size={14} strokeWidth={2} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}

export default TutorialVideos
