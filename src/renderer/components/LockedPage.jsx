import React from 'react'
import { Lock } from 'lucide-react'
import { allRoutes } from '../nav'
import { useI18n } from '../i18n'

// Shown in place of a page an administrator has locked. The page keeps its
// place in the sidebar (with a lock mark) so the navigation stays stable and
// the reason it will not open is visible.
export default function LockedPage({ user, path }) {
  const { t } = useI18n()
  const route = allRoutes(user).find((item) => item.to === path)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <div className="max-w-md text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-[4px] border border-line bg-surface text-ink-3">
          <Lock size={20} strokeWidth={1.5} />
        </div>
        <div className="kicker mt-5 text-[9.5px]">{t('Locked page')}</div>
        <h2 className="serif mt-1.5 text-[22px] leading-tight text-ink">
          {route ? t(route.label) : t('This page')}
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          {t('An administrator has locked this page. It stays in the navigation with a lock mark and opens again as soon as it is unlocked.')}
        </p>
      </div>
    </div>
  )
}
