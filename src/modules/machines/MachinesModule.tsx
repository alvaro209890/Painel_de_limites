import { useState } from 'react'
import { MetricCard } from '../../components/MetricCard'
import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { DashboardMachine } from '../../types/dashboard'
import { renameMachine } from '../../api/client'
import { formatDate, formatDuration } from '../../utils/format'

type MachinesModuleProps = {
  machines: DashboardMachine[]
  loading?: boolean
  error?: string | null
  onRefresh?: () => void
}

function mainDisk(machine: DashboardMachine) {
  return machine.metrics?.disks?.[0] || null
}

export function MachinesModule({ machines, loading, error, onRefresh }: MachinesModuleProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  async function handleRename(machineId: string) {
    if (!editName.trim()) return
    setRenameBusy(true)
    setRenameError(null)
    try {
      await renameMachine(machineId, editName.trim())
      setEditingId(null)
      onRefresh?.()
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Erro ao renomear')
    } finally {
      setRenameBusy(false)
    }
  }

  function startEdit(machine: DashboardMachine) {
    setEditingId(machine.id)
    setEditName(machine.name)
    setRenameError(null)
  }

  if (loading) return <SectionCard title="Máquinas"><p className="text-slate-400">Carregando máquinas...</p></SectionCard>
  if (error) return <SectionCard title="Máquinas"><p className="text-rose-200">{error}</p></SectionCard>

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {machines.map((machine) => {
        const disk = mainDisk(machine)
        const isOnline = machine.status === 'online'
        const isEditing = editingId === machine.id

        return (
          <SectionCard key={machine.id} className="min-h-full">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-xl border border-cyan-300/30 bg-black/30 px-3 py-2 text-lg font-black text-white outline-none ring-cyan-300/30 transition focus:ring-4"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(machine.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      disabled={renameBusy}
                      maxLength={100}
                    />
                    <button
                      className="rounded-xl bg-emerald-300 px-3 py-2 font-black text-slate-950 hover:bg-emerald-200 disabled:opacity-50 text-sm"
                      onClick={() => handleRename(machine.id)}
                      disabled={renameBusy || !editName.trim()}
                      type="button"
                    >
                      ✔
                    </button>
                    <button
                      className="rounded-xl border border-slate-400/30 px-3 py-2 text-sm font-black text-slate-300 hover:bg-slate-400/10"
                      onClick={() => setEditingId(null)}
                      disabled={renameBusy}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-black text-white truncate">{machine.name}</h2>
                    <button
                      className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs font-bold text-slate-400 hover:bg-white/10 hover:text-slate-200 transition"
                      onClick={() => startEdit(machine)}
                      type="button"
                      title="Renomear"
                    >
                      ✎
                    </button>
                  </div>
                )}
                <p className="mt-1 text-sm text-slate-400 truncate">{machine.hostname || machine.notes || 'Sem hostname'}</p>
                {machine.agent && <span className="mt-1 inline-block rounded-md bg-emerald-300/15 px-2 py-0.5 text-xs font-bold text-emerald-200">agent remoto</span>}
                {renameError && isEditing && <p className="mt-1 text-xs text-rose-300">{renameError}</p>}
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
                {machine.agent ? (
                  <>
                    <p className="font-semibold text-amber-200">Offline — sem heartbeat recente</p>
                    <p className="mt-2">Último heartbeat: {formatDate(machine.lastSeenAt)}. O agent pode estar parado ou o PC desligado.</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-slate-200">Aguardando agent/heartbeat.</p>
                    <p className="mt-2">Instale o limits-agent nesse PC. Veja <code className="rounded bg-black/30 px-1 py-0.5 text-cyan-200">docs/agent-setup.md</code></p>
                  </>
                )}
              </div>
            )}
          </SectionCard>
        )
      })}
    </div>
  )
}
