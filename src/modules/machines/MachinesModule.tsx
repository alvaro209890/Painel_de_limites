import { useState, useEffect } from 'react'
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

function machineRoleLabel(role: DashboardMachine['role']) {
  if (role === 'server') return 'servidor fixo'
  if (role === 'work') return 'estação de trabalho'
  if (role === 'reserve') return 'reserva'
  return 'outro papel'
}

function machineMission(machine: DashboardMachine) {
  if (machine.role === 'server') return 'Hospeda túneis, APIs, PM2, Docker e serviços DevOps que precisam ficar ligados.'
  if (machine.role === 'work') return 'Notebook de uso diário: envia telemetria, opera arquivos/projetos e serve como posto de comando.'
  return machine.notes || 'Máquina monitorada pelo painel.'
}

// Global metric history store to persist sparkline history inside the module session
type MetricHistory = {
  cpu: number[]
  ram: number[]
}
const globalHistory: Record<string, MetricHistory> = {}

export function MachinesModule({ machines, loading, error, onRefresh }: MachinesModuleProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  // Track metric history (e.g. keeping the last 15 ticks)
  const [historyStore, setHistoryStore] = useState<Record<string, MetricHistory>>({})

  useEffect(() => {
    if (!machines || !machines.length) return

    let updated = false
    machines.forEach((m) => {
      if (m.status === 'online' && m.metrics) {
        const key = m.id
        if (!globalHistory[key]) {
          globalHistory[key] = { cpu: [], ram: [] }
        }

        const currentCpu = m.metrics.cpu.usagePercent ?? 0
        const currentRam = m.metrics.memory.usedPercent

        const h = globalHistory[key]
        
        // Push the values on every tick (even if unchanged) to keep the timeline advancing.
        // We limit to 15 ticks to show a moving chart.
        h.cpu.push(currentCpu)
        h.ram.push(currentRam)

        if (h.cpu.length > 15) h.cpu.shift()
        if (h.ram.length > 15) h.ram.shift()
        updated = true
      }
    })

    if (updated || Object.keys(historyStore).length === 0) {
      setHistoryStore({ ...globalHistory })
    }
  }, [machines])

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

  const serverMachines = machines.filter((machine) => machine.role === 'server')
  const workMachines = machines.filter((machine) => machine.role !== 'server')

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <SectionCard title="Servidor" subtitle="Onde ficam os serviços permanentes, túneis, APIs e agentes 24/7.">
          <p className="text-3xl font-semibold tracking-[-0.05em] text-white">{serverMachines.filter((machine) => machine.status === 'online').length}/{serverMachines.length || 1}</p>
          <p className="mt-1 text-sm text-slate-400">PC servidor online</p>
        </SectionCard>
        <SectionCard title="Estações" subtitle="Máquinas de trabalho que enviam heartbeat e métricas para o servidor.">
          <p className="text-3xl font-semibold tracking-[-0.05em] text-white">{workMachines.filter((machine) => machine.status === 'online').length}/{workMachines.length || 1}</p>
          <p className="mt-1 text-sm text-slate-400">notebooks/PCs monitorados</p>
        </SectionCard>
      </div>
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
      {machines.map((machine) => {
        const disk = mainDisk(machine)
        const isOnline = machine.status === 'online'
        const isEditing = editingId === machine.id
        const machineHistory = historyStore[machine.id] || { cpu: [], ram: [] }

        return (
          <SectionCard key={machine.id} className={`min-h-full ${machine.role === 'server' ? 'lg:col-span-2 xl:col-span-1' : ''}`}>
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
                    <h2 className="truncate text-2xl font-semibold tracking-[-0.04em] text-white">{machine.name}</h2>
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
                <p className="mt-1 truncate text-sm text-slate-400">{machine.hostname || machine.notes || 'Sem hostname'}</p>
                <p className="mt-3 text-sm leading-6 text-slate-400">{machineMission(machine)}</p>
                <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">{machineRoleLabel(machine.role)}</span>
                {machine.agent && <span className="mt-1 inline-block rounded-md bg-emerald-300/15 px-2 py-0.5 text-xs font-bold text-emerald-200">limits-agent ativo</span>}
                {machine.agents?.map((agent) => (
                  <span key={agent.name} title={agent.description || ''} className="mt-1 inline-block rounded-md bg-indigo-300/15 px-2 py-0.5 text-xs font-semibold text-indigo-200">
                    {agent.name} {agent.description ? `• ${agent.description}` : ''}
                  </span>
                ))}
                {renameError && isEditing && <p className="mt-1 text-xs text-rose-300">{renameError}</p>}
              </div>
              <StatusBadge status={machine.status} />
            </div>

            {isOnline && machine.metrics ? (
              <>
                <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                  <MetricCard 
                    label="CPU" 
                    value={machine.metrics.cpu.usagePercent === null ? '--' : `${machine.metrics.cpu.usagePercent}%`} 
                    hint={`${machine.metrics.cpu.cores} núcleos`} 
                    tone="cyan" 
                    history={machineHistory.cpu} 
                  />
                  <MetricCard 
                    label="RAM" 
                    value={`${machine.metrics.memory.usedPercent}%`} 
                    hint={`${machine.metrics.memory.usedGb}GB / ${machine.metrics.memory.totalGb}GB`} 
                    tone={machine.metrics.memory.usedPercent >= 80 ? 'warning' : 'good'} 
                    history={machineHistory.ram} 
                  />
                  <MetricCard 
                    label="Disco" 
                    value={disk?.percent || '--'} 
                    hint={disk ? `${disk.label} • ${disk.freeGb}GB livres` : 'Sem disco'} 
                    tone={Number(String(disk?.percent || '').replace('%', '')) >= 80 ? 'warning' : 'default'} 
                    progress={disk ? Number(String(disk.percent).replace('%', '')) : null}
                  />
                  <MetricCard 
                    label="Temp." 
                    value={machine.metrics.temperature ? `${machine.metrics.temperature.max}°C` : '--'} 
                    hint="Temperatura máxima detectada" 
                    tone={machine.metrics.temperature && machine.metrics.temperature.max >= 70 ? 'danger' : 'default'} 
                    progress={machine.metrics.temperature ? (machine.metrics.temperature.max / 100) * 100 : null}
                  />
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
    </div>
  )
}
