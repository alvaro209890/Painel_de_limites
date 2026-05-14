type StatusBadgeProps = {
  status: 'online' | 'offline' | 'unknown' | 'warning' | 'critical' | 'ok' | 'info'
  label?: string
}

const styles: Record<StatusBadgeProps['status'], string> = {
  online: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200',
  ok: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200',
  offline: 'border-rose-300/30 bg-rose-400/10 text-rose-200',
  critical: 'border-rose-300/30 bg-rose-400/10 text-rose-200',
  warning: 'border-amber-300/30 bg-amber-400/10 text-amber-200',
  info: 'border-cyan-300/30 bg-cyan-400/10 text-cyan-200',
  unknown: 'border-slate-300/20 bg-slate-400/10 text-slate-300',
}

const defaultLabels: Record<StatusBadgeProps['status'], string> = {
  online: 'Online',
  ok: 'OK',
  offline: 'Offline',
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Info',
  unknown: 'Desconhecido',
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] ${styles[status]}`}>
      <span className="h-2 w-2 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
      {label || defaultLabels[status]}
    </span>
  )
}
