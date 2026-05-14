import { MetricCard } from '../../components/MetricCard'
import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { DashboardMachine } from '../../types/dashboard'
import { formatDate, formatDuration } from '../../utils/format'

type MachinesModuleProps = {
  machines: DashboardMachine[]
  loading?: boolean
  error?: string | null
}

function mainDisk(machine: DashboardMachine) {
  return machine.metrics?.disks?.[0] || null
}

export function MachinesModule({ machines, loading, error }: MachinesModuleProps) {
  if (loading) return <SectionCard title="Máquinas"><p className="text-slate-400">Carregando máquinas...</p></SectionCard>
  if (error) return <SectionCard title="Máquinas"><p className="text-rose-200">{error}</p></SectionCard>

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {machines.map((machine) => {
        const disk = mainDisk(machine)
        const isOnline = machine.status === 'online'
        return (
          <SectionCard key={machine.id} className="min-h-full">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-white">{machine.name}</h2>
                <p className="mt-1 text-sm text-slate-400">{machine.hostname || machine.notes || 'Sem hostname'}</p>
              </div>
              <StatusBadge status={machine.status} />
            </div>

            {isOnline && machine.metrics ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <MetricCard label="CPU" value={machine.metrics.cpu.usagePercent === null ? '--' : `${machine.metrics.cpu.usagePercent}%`} hint={`${machine.metrics.cpu.cores} núcleos`} tone="cyan" />
                  <MetricCard label="RAM" value={`${machine.metrics.memory.usedPercent}%`} hint={`${machine.metrics.memory.usedGb}GB / ${machine.metrics.memory.totalGb}GB`} tone={machine.metrics.memory.usedPercent >= 80 ? 'warning' : 'good'} />
                  <MetricCard label="Disco" value={disk?.percent || '--'} hint={disk ? `${disk.label} • ${disk.freeGb}GB livres` : 'Sem disco'} tone={Number(String(disk?.percent || '').replace('%', '')) >= 80 ? 'warning' : 'default'} />
                  <MetricCard label="Temp." value={machine.metrics.temperature ? `${machine.metrics.temperature.max}°C` : '--'} hint="máxima detectada" tone="default" />
                </div>
                <p className="mt-4 text-xs text-slate-500">Uptime: {formatDuration(machine.metrics.uptime)} • Último sinal: {formatDate(machine.lastSeenAt)}</p>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-slate-400">
                <p className="font-semibold text-slate-200">Aguardando agent/heartbeat.</p>
                <p className="mt-2">Quando o agent for instalado nesse PC, ele vai aparecer aqui com CPU, RAM, disco e status em tempo real.</p>
              </div>
            )}
          </SectionCard>
        )
      })}
    </div>
  )
}
