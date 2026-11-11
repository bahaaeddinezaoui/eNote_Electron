// Dependency-free SVG charts used by the Student History analytics dashboard.

// ---- Trend chart (multi-series line + area) -------------------------------
// series: [{ name, color, values: number[] }], labels: string[]
export function TrendChart({ series, labels, height = 220 }) {
  const W = 640
  const H = height
  const padL = 34
  const padR = 12
  const padT = 14
  const padB = 26
  const n = labels.length

  const maxVal = Math.max(1, ...series.flatMap(s => s.values))

  if (n === 0) return null

  const xFor = (i) => padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1))
  const yFor = (v) => padT + (1 - v / maxVal) * (H - padT - padB)

  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {gridLines.map(g => {
        const y = padT + g * (H - padT - padB)
        return (
          <g key={g}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--color-line)" strokeWidth="1" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-3)" fontWeight="600">
              {Math.round(maxVal * (1 - g))}
            </text>
          </g>
        )
      })}

      {series.map((s, si) => {
        const pts = s.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ')
        const areaPts = `${padL},${yFor(0)} ${pts} ${xFor(n - 1)},${yFor(0)}`
        return (
          <g key={si}>
            {s.area !== false && (
              <polygon points={areaPts} fill={s.color} opacity="0.08" />
            )}
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (
              <circle key={i} cx={xFor(i)} cy={yFor(v)} r="3" fill="var(--color-surface)" stroke={s.color} strokeWidth="2" />
            ))}
          </g>
        )
      })}

      {labels.map((l, i) => {
        // Thin out labels when they would collide.
        const step = Math.ceil(n / 8)
        if (i % step !== 0 && i !== n - 1) return null
        return (
          <text key={i} x={xFor(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--color-ink-3)" fontWeight="600">
            {l}
          </text>
        )
      })}
    </svg>
  )
}

// ---- Horizontal bar chart --------------------------------------------------
// data: [{ label, value, color? }], total used for percentage fill
export function HBarChart({ data }) {
  const maxVal = Math.max(1, ...data.map(d => d.value))
  if (data.length === 0) return null
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-semibold text-ink-3 truncate pr-2" title={d.label}>{d.label}</span>
            <span className="font-bold text-ink-3 shrink-0">{d.value}</span>
          </div>
          <div className="h-2.5 bg-surface-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(d.value / maxVal) * 100}%`, backgroundColor: d.color || 'var(--color-jade-500)' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Donut chart -----------------------------------------------------------
// data: [{ label, value, color }]
export function DonutChart({ data, size = 160, centerLabel, centerValue }) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const r = 60
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 160 160" className="shrink-0">
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--color-surface-muted)" strokeWidth="20" />
        {total > 0 && data.map((d, i) => {
          const frac = d.value / total
          const dash = frac * c
          const el = (
            <circle
              key={i}
              cx="80" cy="80" r={r} fill="none"
              stroke={d.color}
              strokeWidth="20"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          )
          offset += dash
          return el
        })}
        <text x="80" y="76" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--color-ink)">
          {centerValue !== undefined ? centerValue : total}
        </text>
        <text x="80" y="94" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--color-ink-3)" letterSpacing="1">
          {centerLabel || 'TOTAL'}
        </text>
      </svg>
      <div className="space-y-2 min-w-0">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="font-semibold text-ink-3">{d.label}</span>
            <span className="font-bold text-ink-3 ml-auto">{d.value}</span>
            <span className="text-ink-3 font-medium">
              {total > 0 ? `${Math.round((d.value / total) * 100)}%` : '0%'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Vertical bar chart (per-period comparison) ----------------------------
// data: [{ label, value, color? }]
export function VBarChart({ data, height = 200 }) {
  const maxVal = Math.max(1, ...data.map(d => d.value))
  const H = height
  const padB = 24
  const barArea = H - padB - 16

  if (data.length === 0) return null

  return (
    <svg viewBox={`0 0 640 ${H}`} className="w-full" style={{ height }}>
      {data.map((d, i) => {
        const slot = 640 / data.length
        const barW = Math.min(36, slot * 0.6)
        const x = i * slot + (slot - barW) / 2
        const h = (d.value / maxVal) * barArea
        const y = H - padB - h
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(h, d.value > 0 ? 2 : 0)} rx="6" fill={d.color || 'var(--color-jade-500)'} opacity="0.9" />
            {d.value > 0 && (
              <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--color-ink-2)">
                {d.value}
              </text>
            )}
            <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--color-ink-3)">
              {d.label}
            </text>
          </g>
        )
      })}
      <line x1="0" y1={H - padB} x2="640" y2={H - padB} stroke="var(--color-line)" strokeWidth="1" />
    </svg>
  )
}
