type MetricCardProps = {
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'good' | 'warning' | 'danger' | 'cyan'
}

const toneClass: Record<NonNullable<MetricCardProps['tone']>, string> = {
  default: 'from-white/[0.07] to-white/[0.025] text-white',
  cyan: 'from-indigo-300/15 to-indigo-950/10 text-indigo-100',
  good: 'from-emerald-300/15 to-emerald-950/10 text-emerald-100',
  warning: 'from-amber-300/15 to-amber-950/10 text-amber-100',
  danger: 'from-rose-300/15 to-rose-950/10 text-rose-100',
}

export function MetricCard({ label, value, hint, tone = 'default' }: MetricCardProps) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-gradient-to-br p-4 shadow-sm shadow-black/10 ${toneClass[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}
