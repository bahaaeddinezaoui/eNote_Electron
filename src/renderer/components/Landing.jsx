import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, PlayCircle, ShieldCheck } from 'lucide-react'
import LanguageToggle from './ui/LanguageToggle'
import MotionToggle from './ui/MotionToggle'
import ThemeToggle from './ui/ThemeToggle'
import WindowControls from './ui/WindowControls'
import AppMark from './ui/AppMark'
import TutorialVideos from './TutorialVideos'
import { useI18n } from '../i18n'

// Public landing page: the first screen a signed-out user sees. One statement,
// one way in, and the tutorial walkthroughs. Everything else lives behind the
// sign-in, so the page stays short on purpose.
//
// Visual language: flat pine surfaces, hairlines instead of cards-on-cards, one
// serif display face, jade for action.

const Landing = () => {
  const { t, dir } = useI18n()

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-canvas text-ink">
      {/* Window chrome. The window is frameless, so this strip is the caption:
          it drags, and the caption buttons sit at the end of the strip — the
          physical top-right in English and French, the top-left in Arabic, the
          same way the in-app title bar mirrors. */}
      <header
        dir={dir}
        className="app-titlebar sticky top-0 z-20 flex h-11 shrink-0 items-stretch border-b border-line bg-surface"
      >
        <div className="app-drag flex items-stretch gap-2.5 border-e border-line ps-4 pe-4">
          <AppMark className="my-auto h-[24px] w-[24px]" />
          <div className="my-auto min-w-0 leading-none">
            <div className="serif truncate text-[15px] tracking-[-0.01em] text-ink">eNote</div>
            <div className="kicker mt-[3px] truncate text-[8.5px]">{t('Academic registry')}</div>
          </div>
        </div>

        <div className="min-w-0 flex-1" />

        <div className="flex shrink-0 items-center gap-2 pe-3">
          <LanguageToggle withLabel />
          <MotionToggle />
          <ThemeToggle />
          <Link
            to="/login"
            className="inline-flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-semibold text-ink transition-colors hover:bg-surface-muted"
          >
            {t('Sign in')} <ArrowRight size={12} strokeWidth={2} />
          </Link>
        </div>

        <WindowControls />
      </header>

      <main className="anim-page mx-auto w-full max-w-[1180px] flex-1 px-6 pb-14 lg:px-8">
        {/* Hero on the inline start, walkthroughs on the inline end. The grid
            follows the document direction, so the tutorial column sits on the
            right in English and French and on the left in Arabic without a
            direction-specific rule. */}
        <div className="anim-stagger grid gap-10 border-b border-line py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:items-center lg:gap-12 lg:py-14">
          <section>
            <h1 className="serif max-w-[560px] text-[38px] leading-[1.04] tracking-[-0.02em] text-ink sm:text-[46px] lg:text-[42px] xl:text-[50px]">
              {t('Run the academic year')}
              <br />
              {t('without the spreadsheets.')}
            </h1>

            <p className="mt-5 max-w-xl text-[14px] leading-relaxed text-ink-2">
              {t('One application, one database, one source of truth.')}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Link
                to="/login"
                className="inline-flex h-9 items-center gap-1.5 rounded-[4px] px-4 text-[12.5px] font-semibold transition-[filter] hover:brightness-110"
                style={{ background: 'var(--color-jade-solid)', color: 'var(--color-on-jade)' }}
              >
                {t('Sign in to your account')} <ArrowRight size={14} strokeWidth={2} className="rtl:rotate-180" />
              </Link>
              <a
                href="#tutorials"
                className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-3.5 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-muted"
              >
                <PlayCircle size={14} strokeWidth={1.9} style={{ color: 'var(--color-ember-600)' }} aria-hidden="true" />
                {t('Tutorial videos')}
              </a>
            </div>

            <p className="mt-5 flex items-center gap-2 text-[11px] text-ink-3">
              <ShieldCheck size={13} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--color-jade-500)' }} />
              {t('Accounts are issued by your administrator — there is no public sign-up.')}
            </p>
          </section>

          {/* Tutorial videos: one walkthrough per role. The files live in
              src/renderer/assets/tutorials/<role>/ — see the README there. */}
          <section id="tutorials" aria-label={t('Tutorial videos')} className="scroll-mt-16">
            <div className="mb-4">
              <div className="kicker text-[9.5px]">{t('Guides')}</div>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <h2 className="serif text-[26px] leading-[30px] tracking-[-0.015em] text-ink">
                  {t('Tutorial videos')}
                </h2>
                <p className="max-w-[260px] text-[11.5px] leading-relaxed text-ink-3">
                  {t('Pick your role: each walkthrough covers the pages that role actually uses.')}
                </p>
              </div>
            </div>
            <TutorialVideos />
          </section>
        </div>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-2 px-6 py-4 text-[11px] text-ink-3 lg:px-8">
          <span>{t('eNote Management · internal academic platform')}</span>
          <a href="#tutorials" className="hover:text-ink">{t('Tutorial videos')}</a>
        </div>
      </footer>
    </div>
  )
}

export default Landing
