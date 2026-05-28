type MetricCardProps = {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'good' | 'warning' | 'danger' | 'cyan'
  history?: number[]
}

const toneClass: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'from-white/[0.07] to-white/[0.025] text-white',
  cyan: 'from-indigo-300/15 to-indigo-950/10 text-indigo-100 border-indigo-500/20',
  good: 'from-emerald-300/15 to-emerald-950/10 text-emerald-100 border-emerald-500/20',
  warning: 'from-amber-300/15 to-amber-950/10 text-amber-100 border-amber-500/20',
  danger: 'from-rose-300/15 to-rose-950/10 text-rose-100 border-rose-500/20',
}

const neonGlowColor: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: '#ffffff',
  cyan: '#6366f1',
  good: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
}

export function MetricCard({ label, value, hint, tone = 'default', history = [] }: MetricCardProps) {
  // Generate SVG path for neon historical chart
  const sparklineSvg = (() => {
    if (!history || history.length < 2) return null
    
    const width = 120
    const height = 28
    const padding = 2
    
    const maxVal = Math.max(...history, 1)
    const points = history.map((val, index) => {
      const x = padding + (index / (history.length - 1)) * (width - padding * 2)
      const y = height - padding - (val / maxVal) * (height - padding * 2)
      return `${x},${y}`
    }).join(' ')

    const strokeColor = neonGlowColor[tone]

    return (
      <div className="relative h-7 w-[120px] self-end opacity-90 transition-opacity hover:opacity-100">
        <svg className="overflow-visible" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <filter id={`neon-glow-${tone}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <polyline
            fill="none"
            stroke={strokeColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
            filter={`url(#neon-glow-${tone})`}
          />
        </svg>
      </div>
    )
  })()

  return (
    <div className={`flex justify-between rounded-2xl border bg-gradient-to-br p-4 shadow-lg shadow-black/10 transition-all hover:scale-[1.01] hover:border-white/20 ${toneClass[tone]}`}>
      <div className="flex flex-col min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] truncate">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-400 truncate">{hint}</p>}
      </div>
      {sparklineSvg}
    </div>
  )
}
