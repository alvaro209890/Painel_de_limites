type MetricCardProps = {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'good' | 'warning' | 'danger' | 'cyan'
  history?: number[]
  progress?: number | null
}

const toneClass: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'from-white/[0.05] to-white/[0.01] text-white border-white/10 shadow-black/10',
  cyan: 'from-indigo-500/10 to-indigo-950/5 text-indigo-100 border-indigo-500/20 shadow-indigo-950/10',
  good: 'from-emerald-500/10 to-emerald-950/5 text-emerald-100 border-emerald-500/20 shadow-emerald-950/10',
  warning: 'from-amber-500/10 to-amber-950/5 text-amber-100 border-amber-500/20 shadow-amber-950/10',
  danger: 'from-rose-500/10 to-rose-950/5 text-rose-100 border-rose-500/20 shadow-rose-950/10',
}

const neonGlowColor: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: '#94a3b8',
  cyan: '#6366f1',
  good: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
}

export function MetricCard({ label, value, hint, tone = 'default', history = [], progress }: MetricCardProps) {
  const strokeColor = neonGlowColor[tone]

  const renderVisual = () => {
    // 1. Sparkline chart for historical data (CPU / RAM)
    if (history && history.length > 0) {
      const width = 300
      const height = 24
      const padding = 2
      
      const displayHistory = history.length >= 2 ? history : [Number(value) || 0, Number(value) || 0]
      const minVal = Math.min(...displayHistory)
      const maxVal = Math.max(...displayHistory)
      const range = maxVal - minVal
      
      const points = displayHistory.map((val, index) => {
        const x = padding + (index / (displayHistory.length - 1)) * (width - padding * 2)
        let y = height / 2
        if (range > 0) {
          y = height - padding - ((val - minVal) / range) * (height - padding * 2)
        }
        return `${x},${y}`
      }).join(' ')

      return (
        <div className="mt-3 relative h-6 w-full opacity-95">
          <svg className="overflow-visible w-full h-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            <defs>
              <filter id={`neon-glow-${tone}`} x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
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
    }

    // 2. Glowing progress bar for linear limits (Disk / Temperature)
    if (typeof progress === 'number' && !isNaN(progress)) {
      const pct = Math.min(Math.max(progress, 0), 100)
      return (
        <div className="mt-4 w-full">
          <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden border border-white/5">
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                backgroundColor: strokeColor,
                boxShadow: `0 0 8px ${strokeColor}`
              }}
            />
          </div>
        </div>
      )
    }

    // 3. Simple aesthetic baseline divider if nothing else is provided
    return (
      <div className="mt-4 h-[1px] w-full bg-white/5" />
    )
  }

  return (
    <div className={`flex flex-col rounded-2xl border bg-gradient-to-br p-4 shadow-lg transition-all hover:scale-[1.01] hover:border-white/20 ${toneClass[tone]}`}>
      {/* Label and Value Header */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span 
            className="h-1.5 w-1.5 rounded-full shrink-0" 
            style={{ 
              backgroundColor: strokeColor,
              boxShadow: `0 0 6px ${strokeColor}`
            }} 
          />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 truncate">{label}</span>
        </div>
        <span className="text-xl font-bold tracking-tight text-white shrink-0">{value}</span>
      </div>

      {/* Subtitle / Hint */}
      {hint && (
        <p className="mt-1 text-[11px] font-medium text-slate-400 truncate" title={hint}>
          {hint}
        </p>
      )}

      {/* Dynamic Visual Neon Element */}
      {renderVisual()}
    </div>
  )
}
