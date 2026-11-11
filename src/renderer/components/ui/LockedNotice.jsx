import React from 'react'
import { Lock } from 'lucide-react'
import { useI18n } from '../../i18n'

// The locked-page explanation, sized for a title-bar dropdown: the shortcut
// still opens, but where the list would be it says why there is nothing to read
// and that an Administrator can open the page again. The wording is the same
// sentence the full page shows, so the two never drift apart.
export default function LockedNotice() {
  const { t } = useI18n()
  return (
    <div className="px-4 py-6 text-center">
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-[4px] border border-line bg-surface-muted text-ink-3">
        <Lock size={15} strokeWidth={1.6} />
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-2">
        {t('An administrator has locked this page. It stays in the navigation with a lock mark and opens again as soon as it is unlocked.')}
      </p>
    </div>
  )
}
