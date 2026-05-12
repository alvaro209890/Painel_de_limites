import { useEffect, useMemo, useState } from 'react'
import './App.css'

type WindowInfo = {
  label: string
  usedPercent: number
  remainingPercent: number
  windowSeconds: number
  resetAfterSeconds: number
  resetAt: string
  elapsedSeconds: number
}

type LimitsPayload = {
  usage: {
    checkedAt: string
    account: { email: string | null; planType: string; userId: string }
    status: { allowed: boolean; limitReached: boolean; reachedType: string | null }
    windows: { primary: WindowInfo | null; secondary: WindowInfo | null }
    credits: {
      has_credits: boolean
      unlimited: boolean
      balance: string
      overage_limit_reached: boolean
      approx_local_messages?: [number, number]
      approx_cloud_messages?: [number, number]
    } | null
  }
  local: {
    totals: { threads: number; tokens: number; last_used: number | null }
    byModel: Array<{ model: string; provider: string; threads: number; tokens: number; last_used: number }>
    recentThreads: Array<{ title: string; model: string; provider: string; cwd: string; tokens_used: number; updated_at: number }>
  }
}

type PcMetricsPayload = {
  ok: boolean
  checkedAt: string
  metrics: {
    cpu: { model: string; cores: number; usagePercent: number | null; loadAvg: number[] }
    memory: { totalGb: number; usedGb: number; freeGb: number; usedPercent: number }
    disks: Array<{ device: string; mount: string; label: string; sizeGb: number; usedGb: number; freeGb: number; percent: string }>
    temperature: { max: number; sensors: Array<{ name: string; temp: number }> } | null
    uptime: number
  }
}

const numberFmt = new Intl.NumberFormat('pt-BR')
const percentFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const days = Math.floor(safe / 86400)
  const hours = Math.floor((safe % 86400) / 3600)
  const minutes = Math.floor((safe % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h ${minutes}min`
  if (hours > 0) return `${hours}h ${minutes}min`
  return `${minutes}min`
}

function formatUptime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const days = Math.floor(safe / 86400)
  const hours = Math.floor((safe % 86400) / 3600)
  const minutes = Math.floor((safe % 3600) / 60)

  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}min`)
  return parts.join(' ')
}

function formatDate(value?: string | number | null) {
  if (!value) return 'Sem dados'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
}

type TabId = 'codex' | 'pc'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'codex', label: 'Codex', icon: '🤖' },
  { id: 'pc', label: 'PC Metrics', icon: '💻' },
]

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav className="flex gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1 shadow-lg sm:gap-2" role="tablist">
      {TABS.map((tab) => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all sm:flex-none sm:px-6 sm:py-3 ${
              isActive
                ? 'bg-gradient-to-br from-cyan-300/20 to-emerald-300/20 text-white shadow-sm shadow-cyan-950/30'
                : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
            }`}
            type="button"
          >
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function App() {
  const [tab, setTab] = useState<TabId>('codex')
  const [data, setData] = useState<LimitsPayload | null>(null)
  const [pcData, setPcData] = useState<PcMetricsPayload['metrics'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pcError, setPcError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pcLoading, setPcLoading] = useState(true)

  async function loadLimits() {
    try {
      setError(null)
      const response = await fetch('/api/limits')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Falha ao consultar limites')
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  async function loadPcMetrics() {
    try {
      setPcError(null)
      const response = await fetch('/api/pc-metrics')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Falha ao consultar metricas')
      setPcData(payload.metrics)
    } catch (err) {
      setPcError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setPcLoading(false)
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      loadLimits()
      loadPcMetrics()
    }, 0)
    const timer = window.setInterval(() => {
      loadLimits()
      loadPcMetrics()
    }, 60_000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [])

  const totalModelTokens = useMemo(() => {
    return data?.local.byModel.reduce((sum, item) => sum + Number(item.tokens || 0), 0) || 0
  }, [data])

  const primary = data?.usage.windows.primary
  const secondary = data?.usage.windows.secondary

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#080a0f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.12),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.8),rgba(2,6,23,0.95))]" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-5 px-3 py-4 sm:gap-8 sm:px-8 sm:py-8 lg:px-10">
        <header className="flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur sm:rounded-[2rem] sm:p-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 inline-flex max-w-full rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cyan-200 sm:text-xs sm:tracking-[0.24em]">
              Dashboard
            </p>
            <h1 className="max-w-3xl text-3xl font-black tracking-tight text-white sm:text-6xl">
              Servidor Interno
            </h1>
            <p className="mt-4 max-w-2xl text-sm text-slate-300 sm:text-lg">
              {tab === 'codex'
                ? 'Acompanha a janela das proximas 5 horas, limite secundario, creditos e metricas locais por modelo usando o login do Codex neste PC.'
                : 'Monitoramento em tempo real de CPU, RAM, discos, temperatura e uptime deste servidor.'}
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm text-slate-300 md:items-end">
            {tab === 'codex' && <StatusPill allowed={data?.usage.status.allowed} loading={loading} />}
            {tab === 'codex' && <span>Conta: {data?.usage.account.email || 'Carregando...'}</span>}
            {tab === 'codex' && <span>Plano: {data?.usage.account.planType || '-'}</span>}
            <button
              onClick={() => { loadLimits(); loadPcMetrics() }}
              className="w-full rounded-xl bg-cyan-300 px-4 py-3 font-bold text-slate-950 transition hover:bg-cyan-200 sm:w-auto sm:py-2"
              type="button"
            >
              Atualizar agora
            </button>
          </div>
        </header>

        <TabBar active={tab} onChange={setTab} />

        {tab === 'codex' && error && (
          <section className="rounded-3xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">
            <strong>Erro ao carregar limites:</strong> {error}
          </section>
        )}

        {tab === 'pc' && pcError && (
          <section className="rounded-3xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">
            <strong>Erro ao carregar metricas:</strong> {pcError}
          </section>
        )}

        {/* ─── Codex Tab ─── */}
        {tab === 'codex' && (
          <>
            <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
              <LimitHero window={primary} loading={loading} />
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                <MetricCard label="Limite semanal restante" value={secondary ? `${percentFmt.format(secondary.remainingPercent)}%` : '--'} detail={secondary ? `reseta em ${formatDuration(secondary.resetAfterSeconds)}` : 'Sem dados'} />
                <MetricCard label="Tokens locais registrados" value={numberFmt.format(data?.local.totals.tokens || 0)} detail={`${numberFmt.format(data?.local.totals.threads || 0)} conversas no historico`} />
                <MetricCard label="Creditos extras" value={data?.usage.credits?.balance ?? '--'} detail={data?.usage.credits?.has_credits ? 'creditos ativos' : 'sem creditos extras'} />
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-3">
              <InfoPanel title="Janela principal" window={primary} />
              <InfoPanel title="Janela secundaria" window={secondary} />
              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                <h2 className="text-lg font-bold text-white">Estado da conta</h2>
                <div className="mt-5 space-y-4 text-sm text-slate-300">
                  <Row label="Uso bloqueado" value={data?.usage.status.limitReached ? 'Sim' : 'Nao'} />
                  <Row label="Tipo de bloqueio" value={data?.usage.status.reachedType || 'Nenhum'} />
                  <Row label="Ultima leitura" value={formatDate(data?.usage.checkedAt)} />
                  <Row label="Ultimo uso local" value={formatDate(data?.local.totals.last_used)} />
                </div>
              </section>
            </section>

            <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-white">Gastos por modelo</h2>
                    <p className="text-sm text-slate-400">Baseado no SQLite local do Codex.</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">{numberFmt.format(totalModelTokens)} tokens</span>
                </div>
                <div className="space-y-4">
                  {(data?.local.byModel || []).map((item) => (
                    <ModelBar key={`${item.provider}-${item.model}`} item={item} total={totalModelTokens} />
                  ))}
                  {!data?.local.byModel.length && <p className="text-slate-400">Nenhuma metrica local encontrada ainda.</p>}
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                <h2 className="text-xl font-bold text-white">Conversas recentes</h2>
                <p className="mt-1 text-sm text-slate-400">Ajuda a entender onde o consumo local foi gerado.</p>
                <div className="mt-5 space-y-3">
                  {(data?.local.recentThreads || []).map((thread, index) => (
                    <article key={`${thread.updated_at}-${index}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <h3 className="line-clamp-2 font-semibold text-slate-100">{thread.title || 'Sem titulo'}</h3>
                        <span className="shrink-0 rounded-full bg-cyan-300/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
                          {numberFmt.format(thread.tokens_used || 0)} tokens
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">{thread.provider}/{thread.model} • {formatDate(thread.updated_at)}</p>
                      <p className="mt-2 truncate text-xs text-slate-500">{thread.cwd}</p>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          </>
        )}

        {/* ─── PC Metrics Tab ─── */}
        {tab === 'pc' && (
          <>
            {pcLoading && !pcData && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-center text-slate-400">
                Carregando metricas do sistema...
              </div>
            )}

            {pcData && (
              <>
                <section className="mb-5 grid gap-5 lg:grid-cols-3">
                  <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="text-2xl">⚡</span>
                      <div>
                        <h3 className="text-lg font-bold text-white">CPU</h3>
                        <p className="text-xs text-slate-400">{pcData.cpu.model}</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm text-slate-400">Uso</span>
                        <span className="text-xl font-black text-white">
                          {pcData.cpu.usagePercent !== null ? `${pcData.cpu.usagePercent}%` : '--'}
                        </span>
                      </div>
                      <Bar value={pcData.cpu.usagePercent ?? 0} color="from-cyan-300 to-purple-400" />
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-slate-300">
                      <Row label="Nucleos" value={String(pcData.cpu.cores)} />
                      <Row label="Load (1/5/15m)" value={pcData.cpu.loadAvg.join(' / ')} />
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="text-2xl">🧠</span>
                      <div>
                        <h3 className="text-lg font-bold text-white">RAM</h3>
                        <p className="text-xs text-slate-400">{pcData.memory.totalGb}GB DDR3?</p>
                      </div>
                    </div>
                    <div className="mb-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm text-slate-400">Uso</span>
                        <span className="text-xl font-black text-white">{pcData.memory.usedPercent}%</span>
                      </div>
                      <Bar value={pcData.memory.usedPercent} color="from-emerald-300 to-cyan-400" />
                    </div>
                    <div className="space-y-2 text-sm text-slate-300">
                      <Row label="Usado" value={`${pcData.memory.usedGb}GB`} />
                      <Row label="Livre" value={`${pcData.memory.freeGb}GB`} />
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="text-2xl">⏰</span>
                      <div>
                        <h3 className="text-lg font-bold text-white">Sistema</h3>
                        <p className="text-xs text-slate-400">Uptime</p>
                      </div>
                    </div>
                    <div className="mt-6">
                      <div className="text-center">
                        <div className="text-4xl font-black text-white">{formatUptime(pcData.uptime)}</div>
                      </div>
                    </div>
                    {pcData.temperature && (
                      <div className="mt-5 space-y-2 text-sm">
                        <p className="text-sm text-slate-400">Temperatura</p>
                        <div className="flex items-center gap-2">
                          <span className={`text-2xl font-black ${pcData.temperature.max > 70 ? 'text-red-400' : pcData.temperature.max > 50 ? 'text-amber-300' : 'text-emerald-300'}`}>
                            {pcData.temperature.max}°C
                          </span>
                          <span className="text-xs text-slate-500">max</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {pcData.temperature.sensors.filter(s => s.temp > 0).map((s, i) => (
                            <span key={i} className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-400">
                              {s.name.replace(/_/g, ' ')}: {s.temp}°C
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                </section>

                <section className="grid gap-5 lg:grid-cols-2">
                  {pcData.disks.map((disk) => {
                    const pct = parseInt(disk.percent)
                    return (
                      <section key={disk.mount} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                        <div className="mb-4 flex items-center gap-3">
                          <span className="text-2xl">{disk.label?.includes('HDD') ? '💾' : '💿'}</span>
                          <div>
                            <h3 className="text-lg font-bold text-white">{disk.label}</h3>
                            <p className="text-xs text-slate-400">{disk.device} • {disk.sizeGb}GB</p>
                          </div>
                        </div>
                        <div className="mb-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm text-slate-400">Uso</span>
                            <span className={`text-xl font-black ${pct > 85 ? 'text-red-400' : pct > 65 ? 'text-amber-300' : 'text-white'}`}>
                              {disk.percent}
                            </span>
                          </div>
                          <Bar value={pct} color="from-violet-300 to-pink-400" />
                        </div>
                        <div className="space-y-2 text-sm text-slate-300">
                          <Row label="Usado" value={`${disk.usedGb}GB`} />
                          <Row label="Livre" value={`${disk.freeGb}GB`} />
                        </div>
                      </section>
                    )
                  })}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}

// ─── Shared sub-components ───────────────────────────────────────

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-3 overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${color}`}
        style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  )
}

function StatusPill({ allowed, loading }: { allowed?: boolean; loading: boolean }) {
  if (loading) return <span className="rounded-full bg-white/10 px-3 py-1 text-sm text-slate-300">Carregando...</span>
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-bold ${allowed ? 'bg-emerald-400/15 text-emerald-200' : 'bg-red-400/15 text-red-200'}`}>
      {allowed ? 'Uso liberado' : 'Limite atingido'}
    </span>
  )
}

function LimitHero({ window, loading }: { window?: WindowInfo | null; loading: boolean }) {
  const used = window?.usedPercent ?? 0
  const remaining = window?.remainingPercent ?? 0
  return (
    <section className="relative overflow-hidden rounded-3xl border border-cyan-200/10 bg-slate-900/80 p-4 shadow-2xl shadow-cyan-950/20 sm:rounded-[2rem] sm:p-8">
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-cyan-300/10 blur-3xl" />
      <div className="relative grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
        <div className="mx-auto md:mx-0">
          <Gauge value={used} />
        </div>
        <div className="min-w-0 text-center md:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200 sm:text-sm sm:tracking-[0.24em]">Proximas 5 horas</p>
          <h2 className="mt-3 text-3xl font-black text-white sm:text-5xl">
            {loading ? 'Carregando...' : `${percentFmt.format(remaining)}% restante`}
          </h2>
          <p className="mt-4 max-w-xl text-slate-300">
            {window ? `Voce usou ${percentFmt.format(used)}% da janela atual. O limite reseta em ${formatDuration(window.resetAfterSeconds)}.` : 'Aguardando dados do Codex.'}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Usado" value={`${percentFmt.format(used)}%`} />
            <MiniStat label="Reset" value={window ? formatDuration(window.resetAfterSeconds) : '--'} />
            <MiniStat label="Horario" value={window ? formatDate(window.resetAt).split(', ')[1] || formatDate(window.resetAt) : '--'} />
          </div>
        </div>
      </div>
    </section>
  )
}

function Gauge({ value }: { value: number }) {
  const radius = 72
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference
  return (
    <div className="relative grid h-40 w-40 place-items-center sm:h-48 sm:w-48">
      <svg className="h-40 w-40 -rotate-90 sm:h-48 sm:w-48" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth="16" fill="none" />
        <circle cx="90" cy="90" r={radius} stroke="url(#usage)" strokeWidth="16" fill="none" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
        <defs>
          <linearGradient id="usage" x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="#22d3ee" />
            <stop offset="1" stopColor="#22c55e" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-black text-white sm:text-4xl">{percentFmt.format(value)}%</div>
        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">usado</div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
      <p className="text-sm text-slate-400">{label}</p>
      <strong className="mt-2 block break-words text-2xl font-black text-white sm:text-3xl">{value}</strong>
      <span className="mt-2 block text-sm text-slate-400">{detail}</span>
    </section>
  )
}

function InfoPanel({ title, window }: { title: string; window?: WindowInfo | null }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <div className="mt-5 space-y-4 text-sm text-slate-300">
        <Row label="Usado" value={window ? `${percentFmt.format(window.usedPercent)}%` : '--'} />
        <Row label="Restante" value={window ? `${percentFmt.format(window.remainingPercent)}%` : '--'} />
        <Row label="Duracao" value={window ? formatDuration(window.windowSeconds) : '--'} />
        <Row label="Reseta em" value={window ? formatDuration(window.resetAfterSeconds) : '--'} />
        <Row label="Reset exato" value={window ? formatDate(window.resetAt) : '--'} />
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-white/10 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-slate-400">{label}</span>
      <strong className="break-words text-left text-slate-100 sm:text-right">{value}</strong>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <strong className="mt-2 block text-lg text-white">{value}</strong>
    </div>
  )
}

function ModelBar({ item, total }: { item: { model: string; provider: string; threads: number; tokens: number; last_used: number }; total: number }) {
  const percent = total > 0 ? (Number(item.tokens) / total) * 100 : 0
  return (
    <article>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <div>
          <strong className="text-slate-100">{item.model || 'desconhecido'}</strong>
          <span className="ml-2 text-slate-500">{item.provider}</span>
        </div>
        <span className="text-slate-300">{numberFmt.format(item.tokens || 0)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-400" style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{item.threads} conversas • ultimo uso {formatDate(item.last_used)}</p>
    </article>
  )
}

export default App
