type MetricCardProps = {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'good' | 'warning' | 'danger' | 'cyan'
  history?: number[]
}

const toneClass: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'from-white/[0.07] to-white/[0.025] text-white border-white/10',
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
    // We always want to render the graph box if history is supported for the metric (i.e. we pass a history prop)
    if (!history) return null
    
    const width = 90
    const height = 28
    const padding = 2
    
    // Ensure we have at least 2 points to draw a polyline. If not, fallback to a flat placeholder line.
    const displayHistory = history.length >= 2 ? history : [Number(value) || 0, Number(value) || 0]
    
    // Scale helper: to avoid dividing by 0 or flat lines lying exactly at the top/bottom
    const minVal = Math.min(...displayHistory)
    const maxVal = Math.max(...displayHistory)
    const range = maxVal - minVal
    
    const points = displayHistory.map((val, index) => {
      const x = padding + (index / (displayHistory.length - 1)) * (width - padding * 2)
      
      // If it's a flat line, center it vertically in the height box
      let y = height / 2
      if (range > 0) {
        y = height - padding - ((val - minVal) / range) * (height - padding * 2)
      }
      return `${x},${y}`
    }).join(' ')

    const strokeColor = neonGlowColor[tone]

    return (
      <div className="relative h-7 w-[90px] shrink-0 self-end opacity-90 transition-opacity hover:opacity-100">
        <svg className="overflow-visible" width={90} height={height} viewBox={`0 0 90 ${height}`}>
          <defs>
            <filter id={`neon-glow-${tone}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.8" result="blur" />
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
    <div className={`flex justify-between gap-2 rounded-2xl border bg-gradient-to-br p-3.5 shadow-lg shadow-black/10 transition-all hover:scale-[1.01] hover:border-white/20 ${toneClass[tone]}`}>
      <div className="flex flex-col min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] truncate">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-400 truncate">{hint}</p>}
      </div>
      {sparklineSvg}
    </div>
  )
}
