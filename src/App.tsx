import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { apiFetch } from './api/client'
import { AlertsModule } from './modules/alerts/AlertsModule'
import { MachinesModule } from './modules/machines/MachinesModule'
import { ProjectsModule } from './modules/projects/ProjectsModule'
import type { DashboardOverviewPayload, MachinesPayload } from './types/dashboard'
import { formatDate } from './utils/format'

type TabId = 'machines' | 'projects' | 'alerts'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'machines', label: 'Máquinas', icon: '💻' },
  { id: 'projects', label: 'Projetos', icon: '🚀' },
  { id: 'alerts', label: 'Alertas', icon: '🚨' },
]

function MachineSplitPanel({ dashboard }: { dashboard: DashboardOverviewPayload | null }) {
  const machines = dashboard?.machines || []

  const machineCards = machines.map((machine) => {
    const agentNames = machine.agents?.length
      ? machine.agents.map((agent) => agent.description ? `${agent.name} • ${agent.description}` : agent.name)
      : machine.agent
        ? ['limits-agent • heartbeat e métricas']
        : []
    const isServer = machine.role === 'server'
    return {
      name: machine.name,
      host: machine.hostname || machine.notes || machine.id,
      status: machine.status,
      label: isServer ? 'servidor / serviços' : 'PC de trabalho / telemetria',
      title: isServer ? 'Servidor IMAP' : machine.name,
      stack: agentNames.length ? agentNames.join(' + ') : (isServer ? 'painel, API, túneis e serviços' : 'heartbeat e métricas do PC'),
      detail: isServer
        ? 'Concentra o Painel de Limites, API local, Cloudflare Tunnel, PM2 e serviços que ficam ligados.'
        : 'Envia estado do computador para esta central: CPU, RAM, disco, temperatura e último sinal.',
    }
  })

  if (!machineCards.length) {
    machineCards.push({
      name: 'Sem PCs cadastrados',
      host: 'aguardando heartbeat',
      status: 'unknown' as const,
      label: 'telemetria indisponível',
      title: 'Nenhum agent reportando',
      stack: 'sem dados',
      detail: 'Quando um limits-agent enviar heartbeat, ele aparece automaticamente aqui.',
    })
  }

  return (
    <section className="grid gap-4">
      <div className="rounded-[2rem] border border-white/10 bg-white/[0.035] p-4 shadow-2xl shadow-indigo-950/20 backdrop-blur sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-200/80">Mapa real dos PCs</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-3xl">Onde o painel está vendo agentes agora</h2>
          </div>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
            {machines.filter((machine) => machine.status === 'online').length}/{machines.length} PCs online
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {machineCards.map((route) => (
            <article key={`${route.name}-${route.host}`} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">{route.name}</span>
                <span className={`h-2.5 w-2.5 rounded-full ${route.status === 'online' ? 'bg-emerald-300 shadow-[0_0_18px_rgba(16,185,129,.8)]' : 'bg-amber-300'}`} />
              </div>
              <h3 className="text-lg font-semibold tracking-[-0.02em] text-white">{route.title}</h3>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-indigo-200/80">{route.label}</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">{route.detail}</p>
              <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[11px] leading-5 text-slate-300">{route.stack}</p>
            </article>
          ))}
        </div>
      </div>

    </section>
  )
}

function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="grid gap-2 rounded-2xl border border-white/10 bg-[#0f1011]/90 p-1 shadow-lg shadow-black/20 sm:flex" role="tablist">
      {TABS.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-all ${
              selected
                ? 'bg-white/[0.07] text-white shadow-sm shadow-black/30 ring-1 ring-white/10'
                : 'text-slate-400 hover:bg-white/[0.035] hover:text-slate-200'
            }`}
            type="button"
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

function LoginGate({ busy, error, password, onPasswordChange, onSubmit }: {
  busy: boolean
  error: string | null
  password: string
  onPasswordChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center justify-center">
      <section className="w-full rounded-[2rem] border border-white/10 bg-[#0f1011]/85 p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
        <p className="mb-3 inline-flex rounded-full border border-indigo-300/20 bg-indigo-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-200">
          Acesso privado
        </p>
        <h1 className="text-3xl font-black tracking-tight text-white">Central de Agentes e PCs</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Mapa privado de como DeepSeek e os agents de heartbeat rodam entre o servidor e seus PCs. Entre como admin para ver limites, máquinas, projetos e alertas.
        </p>

        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
          <label className="block">
            <span className="text-sm font-bold text-slate-300">Senha admin</span>
            <input
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none ring-cyan-300/30 transition focus:ring-4"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              type="password"
              placeholder="Digite a senha"
              disabled={busy}
            />
          </label>
          {error && <p className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p>}
          <button
            className="w-full rounded-2xl bg-indigo-400 px-5 py-3 font-semibold text-white transition hover:bg-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={busy || !password.trim()}
          >
            {busy ? 'Entrando...' : 'Entrar como admin'}
          </button>
        </form>
      </section>
    </div>
  )
}

function App() {
  const [tab, setTab] = useState<TabId>('machines')
  const [authenticated, setAuthenticated] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardOverviewPayload | null>(null)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadAdminStatus = useCallback(async () => {
    try {
      setAuthError(null)
      const payload = await apiFetch<{ authenticated: boolean }>('/api/admin/status')
      setAuthenticated(payload.authenticated)
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Erro ao verificar sessão')
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    if (!authenticated) return
    try {
      setDashboardError(null)
      setLoadingDashboard((current) => current || !dashboard)
      const payload = await apiFetch<DashboardOverviewPayload>('/api/dashboard')
      setDashboard(payload)
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : 'Erro ao carregar dashboard')
    } finally {
      setLoadingDashboard(false)
    }
  }, [authenticated, dashboard])

  const loadMachines = useCallback(async () => {
    if (!authenticated || tab !== 'machines') return
    try {
      const payload = await apiFetch<MachinesPayload>('/api/machines')
      setDashboard((current) => current ? { ...current, machines: payload.machines, checkedAt: payload.checkedAt } : current)
    } catch {
      // O dashboard completo continua sendo a fonte de verdade; ignora falha pontual de realtime.
    }
  }, [authenticated, tab])

  async function login() {
    try {
      setBusy(true)
      setAuthError(null)
      await apiFetch<{ ok: boolean }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setPassword('')
      await loadAdminStatus()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Erro no login')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      setBusy(true)
      await apiFetch<{ ok: boolean }>('/api/admin/logout', { method: 'POST' })
    } finally {
      setDashboard(null)
      setAuthenticated(false)
      setBusy(false)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadAdminStatus() }, [loadAdminStatus])

  useEffect(() => {
    if (!authenticated) return
    const timer = window.setTimeout(() => { void loadDashboard() }, 0)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDashboard()
    }, 60_000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [authenticated, loadDashboard])

  useEffect(() => {
    if (!authenticated || tab !== 'machines') return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadMachines()
    }, 15_000)
    return () => window.clearInterval(interval)
  }, [authenticated, tab, loadMachines])

  const counts = useMemo(() => ({
    machinesOnline: dashboard?.machines.filter((machine) => machine.status === 'online').length || 0,
    machinesTotal: dashboard?.machines.length || 0,
    projectsOnline: dashboard?.projects.filter((project) => project.status === 'online').length || 0,
    projectsTotal: dashboard?.projects.length || 0,
    criticalAlerts: dashboard?.alerts.filter((alert) => alert.severity === 'critical').length || 0,
  }), [dashboard])

  const moduleContent = (() => {
    if (tab === 'machines') return <MachinesModule machines={dashboard?.machines || []} loading={loadingDashboard} error={dashboardError} onRefresh={loadMachines} />
    if (tab === 'projects') return <ProjectsModule projects={dashboard?.projects || []} loading={loadingDashboard} error={dashboardError} />
    return <AlertsModule alerts={dashboard?.alerts || []} loading={loadingDashboard} error={dashboardError} />
  })()

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#08090a] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(113,112,255,0.18),transparent_34%),radial-gradient(circle_at_84%_12%,rgba(16,185,129,0.10),transparent_28%),linear-gradient(180deg,rgba(8,9,10,0.92),rgba(1,1,2,1))]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-3 py-4 sm:px-8 sm:py-8 lg:px-10">
        {loadingStatus ? (
          <div className="py-20 text-center text-slate-400">Verificando sessão...</div>
        ) : !authenticated ? (
          <LoginGate
            busy={busy}
            error={authError}
            password={password}
            onPasswordChange={setPassword}
            onSubmit={login}
          />
        ) : (
          <>
            <header className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#0f1011]/85 p-4 shadow-2xl shadow-black/30 backdrop-blur sm:p-6">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="mb-3 inline-flex rounded-full border border-indigo-300/20 bg-indigo-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.3em] text-indigo-200">
                    Sovereign Runtime • Infra
                  </p>
                  <h1 className="max-w-5xl text-4xl font-black tracking-[-0.06em] text-white sm:text-6xl">Infra Hub Álvaro</h1>
                  <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400 sm:text-base font-medium">
                    Centro de comando e monitoramento em tempo real. Orquestração de backends distribuídos e telemetria de hardware para suporte a agentes autônomos.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-2xl border border-indigo-300/25 bg-indigo-400/15 px-4 py-3 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-400/25" onClick={() => void loadDashboard()} type="button">
                    Sincronizar agora
                  </button>
                  <button className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08]" onClick={() => void logout()} type="button" disabled={busy}>
                    Sair
                  </button>
                </div>
              </div>

              <div className="mt-7 grid gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">PCs online</p><p className="mt-1 text-xl font-semibold">{counts.machinesOnline}/{counts.machinesTotal}</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Projetos servidos</p><p className="mt-1 text-xl font-semibold">{counts.projectsOnline}/{counts.projectsTotal}</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Críticos</p><p className="mt-1 text-xl font-semibold text-rose-100">{counts.criticalAlerts}</p></div>
                <div className="rounded-2xl border border-white/10 bg-black/25 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Atualizado</p><p className="mt-1 text-sm font-semibold">{formatDate(dashboard?.checkedAt)}</p></div>
              </div>
            </header>

            <MachineSplitPanel dashboard={dashboard} />
            <TabBar active={tab} onChange={setTab} />
            {moduleContent}
          </>
        )}
      </div>
    </main>
  )
}

export default App
