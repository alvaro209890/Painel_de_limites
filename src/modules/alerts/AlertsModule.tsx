import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { DashboardAlert } from '../../types/dashboard'
import { formatDate } from '../../utils/format'

type AlertsModuleProps = {
  alerts: DashboardAlert[]
  loading?: boolean
  error?: string | null
}

const severityOrder: DashboardAlert['severity'][] = ['critical', 'warning', 'info']
const severityLabel: Record<DashboardAlert['severity'], string> = {
  critical: 'Críticos',
  warning: 'Atenção',
  info: 'Informativos',
}

export function AlertsModule({ alerts, loading, error }: AlertsModuleProps) {
  if (loading) return <SectionCard title="Alertas"><p className="text-slate-400">Carregando alertas...</p></SectionCard>
  if (error) return <SectionCard title="Alertas"><p className="text-rose-200">{error}</p></SectionCard>

  if (!alerts.length) {
    return (
      <SectionCard title="Alertas" subtitle="Nenhum alerta crítico agora.">
        <div className="rounded-3xl border border-emerald-300/20 bg-emerald-400/10 p-6 text-emerald-100">
          <p className="text-2xl font-black">Tudo saudável por enquanto ✅</p>
          <p className="mt-2 text-sm text-emerald-200/80">Discos, APIs, PCs e serviços não geraram alertas no último check.</p>
        </div>
      </SectionCard>
    )
  }

  return (
    <div className="space-y-5">
      {severityOrder.map((severity) => {
        const group = alerts.filter((alert) => alert.severity === severity)
        if (!group.length) return null
        return (
          <SectionCard key={severity} title={severityLabel[severity]} subtitle={`${group.length} alerta(s)`}>
            <div className="space-y-3">
              {group.map((alert) => (
                <article key={alert.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-black text-white">{alert.title}</h3>
                    <StatusBadge status={alert.severity} />
                  </div>
                  <p className="text-sm text-slate-300">{alert.message}</p>
                  <p className="mt-2 text-xs text-slate-500">Módulo: {alert.module} • {formatDate(alert.createdAt)}</p>
                </article>
              ))}
            </div>
          </SectionCard>
        )
      })}
    </div>
  )
}
