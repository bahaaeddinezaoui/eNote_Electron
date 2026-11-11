import React from 'react'
import { Gauge, Leaf } from 'lucide-react'
import { useMotion } from '../../motion'
import { useI18n } from '../../i18n'

// Header control for the interface motion mode. Performance keeps the crafted
// animations and transitions; power save turns every one of them off.
const MotionToggle = () => {
  const [mode, setMode] = useMotion()
  const { t } = useI18n()
  const powerSaving = mode === 'powersave'
  const label = powerSaving ? t('Switch to performance mode') : t('Switch to power save mode')

  return (
    <button
      type="button"
      onClick={() => setMode(powerSaving ? 'performance' : 'powersave')}
      aria-label={label}
      aria-pressed={powerSaving}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
    >
      <span key={mode} className="motion-icon">
        {powerSaving ? <Leaf size={15} strokeWidth={1.75} /> : <Gauge size={15} strokeWidth={1.75} />}
      </span>
    </button>
  )
}

export default MotionToggle
