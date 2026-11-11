import React from 'react'
import PageGuide from './PageGuide'

// Page masthead: the only h1 of a screen. Kicker carries context (section,
// term, record type), actions sit on the baseline rule. Rendered by every page,
// whether it draws itself full-bleed (Overview, Student Records) or inside the
// layout's padded body — index.css bleeds `.masthead` out to the page edges so
// both contexts put the rule on the same grid.
// `guideEdge` places the page's Guide button inside the action cluster:
// "inner" (default) keeps it nearest the title, "outer" puts it on the far side
// of the masthead — the right edge in English and French, the left edge in
// Arabic, because the header mirrors with the language.
export function PageHeader({ title, kicker, meta, actions, children, guideEdge = 'inner' }) {
  const guideAtOuter = guideEdge === 'outer'
  return (
    <header className="masthead flex min-h-[var(--masthead-h)] shrink-0 flex-wrap items-end justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
      <div className="min-w-0">
        {kicker && <div className="kicker mb-1 truncate">{kicker}</div>}
        <div className="flex items-baseline gap-3">
          <h1 className="serif truncate text-[31px] leading-[34px] text-ink">{title}</h1>
          {meta && <span className="mono shrink-0 text-[10.5px] text-ink-3">{meta}</span>}
        </div>
        {children}
      </div>
      {/* The guide is part of every masthead: one click to the steps for this
          page, written for the signed-in account's role. justify-end only bites
          when the cluster wraps — it keeps the wrapped line, and so the guide,
          on the outer edge instead of dropping it back towards the title. */}
      <div
        className={`flex shrink-0 flex-wrap items-center gap-1.5 ${guideAtOuter ? 'justify-end' : ''}`}
      >
        {!guideAtOuter && <PageGuide />}
        {actions}
        {guideAtOuter && <PageGuide />}
      </div>
    </header>
  )
}

// Flush masthead: kept as the name for pages that render inside the layout's
// padded body. It is the same masthead as PageHeader — the bleed is CSS (see
// the `.page-body .masthead` rule), so every screen's header is identical.
export function PageIntro(props) {
  return <PageHeader {...props} />
}

// Section plate header. 36px, hairline under, title + count on the left, any
// action on the right. Deliberately not a card heading with an icon chip.
export function PanelHeader({ title, meta, actions, id }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-muted px-3">
      <h2 id={id} className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-2">
        {title}
      </h2>
      {meta != null && <span className="mono text-[10.5px] text-ink-3">{meta}</span>}
      {actions && <div className="ms-auto flex items-center gap-1.5">{actions}</div>}
    </div>
  )
}

export function Panel({ children, className = '' }) {
  return <section className={`overflow-hidden rounded-md border border-line bg-surface ${className}`}>{children}</section>
}

// Static state mark: a shape plus a word. Never colour alone.
export function StateMark({ tone = 'neutral', children, className = '' }) {
  const color =
    tone === 'good'
      ? 'var(--color-success)'
      : tone === 'warn'
        ? 'var(--color-warning)'
        : tone === 'bad'
          ? 'var(--color-danger)'
          : 'var(--color-ink-3)'
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}
