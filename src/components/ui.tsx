import type { ReactNode } from 'react'

export type Tone = 'danger' | 'warn' | 'safe' | 'info' | 'neutral'

export const TONE_HEX: Record<Tone, string> = {
  danger: '#ff4d5e',
  warn: '#ffb020',
  safe: '#34d9a5',
  info: '#63a4ff',
  neutral: '#8392ab',
}

const TONE_PILL: Record<Tone, string> = {
  danger: 'border-danger/35 bg-danger/10 text-danger',
  warn: 'border-radar/35 bg-radar/10 text-radar',
  safe: 'border-safe/35 bg-safe/10 text-safe',
  info: 'border-info/35 bg-info/10 text-info',
  neutral: 'border-white/10 bg-white/[0.03] text-muted',
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`surface ${className}`}>{children}</section>
}

export function CardHead({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4 sm:px-6">
      <div className="min-w-0">
        <h2 className="text-[12px] font-semibold tracking-[0.16em] text-chalk uppercase">{title}</h2>
        {hint ? <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted">{hint}</p> : null}
      </div>
      {right ? <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div> : null}
    </header>
  )
}

export function Pill({
  tone = 'neutral',
  children,
  dot = false,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none font-medium tracking-wide ${TONE_PILL[tone]} ${className}`}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_HEX[tone] }} /> : null}
      {children}
    </span>
  )
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  disabled = false,
  title,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'subtle'
  disabled?: boolean
  title?: string
  className?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40'
  const styles: Record<string, string> = {
    primary:
      'bg-radar text-void font-semibold shadow-[0_14px_34px_-16px_rgba(255,176,32,0.85)] hover:brightness-110 active:scale-[0.985]',
    ghost: 'border border-white/10 text-chalk hover:border-white/25 hover:bg-white/[0.045] active:scale-[0.985]',
    subtle: 'text-muted hover:bg-white/[0.045] hover:text-chalk',
  }
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function RadarMark({ size = 38, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="18" stroke="rgba(255,176,32,0.28)" strokeWidth="1.2" />
      <circle cx="20" cy="20" r="11.5" stroke="rgba(255,176,32,0.2)" strokeWidth="1" />
      <circle cx="20" cy="20" r="5" stroke="rgba(255,176,32,0.24)" strokeWidth="1" />
      <g className={active ? 'radar-sweep' : undefined} style={{ transformOrigin: '20px 20px' }}>
        <path d="M20 20 L20 2 A18 18 0 0 1 33 8 Z" fill="url(#radarFill)" />
      </g>
      <circle cx="20" cy="20" r="2.4" fill="#ffb020" />
      <circle cx="27.5" cy="13" r="1.7" fill="#ff4d5e" />
      <circle cx="13" cy="26" r="1.4" fill="#63a4ff" />
      <defs>
        <linearGradient id="radarFill" x1="20" y1="20" x2="33" y2="6" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffb020" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffb020" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <div className="surface-inset px-3.5 py-3">
      <div className="text-[10px] font-medium tracking-[0.16em] text-muted uppercase">{label}</div>
      <div className="tnum mt-1.5 font-mono text-[19px] leading-none" style={tone ? { color: TONE_HEX[tone] } : undefined}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  )
}

export function Meter({ value, max, tone = 'info' }: { value: number; max: number; tone?: Tone }) {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.abs(value) / max)
  const color = TONE_HEX[tone]
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{
          width: `${Math.max(4, ratio * 100)}%`,
          background: `linear-gradient(90deg, ${color}aa, ${color})`,
          boxShadow: `0 0 12px -2px ${color}88`,
        }}
      />
    </div>
  )
}

export function Sparkline({
  values,
  tone = 'info',
  height = 64,
  label,
}: {
  values: number[]
  tone?: Tone
  height?: number
  label?: string
}) {
  const width = 320
  if (values.length < 2) {
    return (
      <div className="surface-inset shimmer flex items-center justify-center text-[11px] text-muted" style={{ height }}>
        {label ?? 'waiting'}
      </div>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - ((v - min) / range) * (height - 12) - 6
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const color = TONE_HEX[tone]
  const id = `spark-${tone}-${height}-${values.length}`
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity="0.3" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${id})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function Dial({ probability, tone, caption }: { probability: number; tone: Tone; caption: string }) {
  const size = 178
  const radius = 74
  const circumference = 2 * Math.PI * radius
  const ratio = Math.max(0, Math.min(1, probability))
  const color = TONE_HEX[tone]
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={13} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={13}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          style={{
            transition: 'stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1), stroke 400ms',
            filter: `drop-shadow(0 0 14px ${color}66)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="tnum font-mono text-[32px] leading-none font-semibold" style={{ color }}>
          {(ratio * 100).toFixed(1)}%
        </div>
        <div className="mt-1.5 text-[10px] font-medium tracking-[0.2em] text-muted uppercase">{caption}</div>
      </div>
    </div>
  )
}

export function ConfusionMatrix({ tp, fp, tn, fn }: { tp: number; fp: number; tn: number; fn: number }) {
  const cell = (label: string, value: number, className: string) => (
    <div className={`rounded-xl border px-3 py-2.5 ${className}`}>
      <div className="text-[10px] tracking-[0.14em] uppercase opacity-80">{label}</div>
      <div className="tnum mt-1 font-mono text-xl">{value}</div>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2">
      {cell('caught rugs', tp, 'border-safe/25 bg-safe/[0.07] text-safe')}
      {cell('false alarms', fp, 'border-radar/25 bg-radar/[0.07] text-radar')}
      {cell('missed rugs', fn, 'border-danger/25 bg-danger/[0.07] text-danger')}
      {cell('clean passed', tn, 'border-white/8 bg-white/[0.03] text-muted')}
    </div>
  )
}

export function BarList({
  items,
  max,
  tone = 'danger',
}: {
  items: { label: string; value: number; note?: string }[]
  max: number
  tone?: Tone
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted">Nothing crossed the threshold.</p>
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate font-mono text-chalk">{item.label}</span>
            <span className="tnum shrink-0 font-mono text-muted">{item.note ?? item.value.toFixed(3)}</span>
          </div>
          <div className="mt-1.5">
            <Meter value={item.value} max={max} tone={tone} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function StageBar({ stages, activeIndex }: { stages: string[]; activeIndex: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {stages.map((stage, index) => {
        const done = index < activeIndex
        const active = index === activeIndex
        return (
          <li key={stage} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase transition ${
                active
                  ? 'border-radar/40 bg-radar/10 text-radar'
                  : done
                    ? 'border-safe/30 bg-safe/[0.07] text-safe'
                    : 'border-white/8 text-muted'
              }`}
            >
              {done ? '✓' : active ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-radar" /> : null}
              {stage}
            </span>
            {index < stages.length - 1 ? <span className="text-edge-2">→</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
