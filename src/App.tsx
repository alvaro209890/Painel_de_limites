import { useEffect, useMemo, useRef, useState } from 'react'
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

type DeepSeekBalanceInfo = {
  is_available: boolean
  balance_infos: Array<{
    currency: string
    total_balance: string
    granted_balance: string
    topped_up_balance: string
  }>
}

type DeepSeekPayload = {
  ok: boolean
  checkedAt: string
  balance: DeepSeekBalanceInfo
}

type CodexProfile = {
  slug: string
  name: string
  emailHint: string | null
  planType: string | null
  accountIdHint: string | null
  createdAt: string | null
  updatedAt: string | null
  lastActivatedAt: string | null
  isActive: boolean
}

type CodexProfilesPayload = {
  ok: boolean
  active: { exists: boolean; email: string | null; planType: string | null; accountIdHint: string | null; updatedAt: string | null }
  profiles: CodexProfile[]
  checkedAt?: string
}

type CodexAdminStatus = {
  ok: boolean
  adminConfigured: boolean
  authenticated: boolean
}

type CodexLoginStatus = {
  ok: boolean
  sessionId?: string
  startedAt?: string
  command?: string
  running: boolean
  exitCode: number | null
  loginUrl: string | null
  userCode: string | null
  outputTail: string
  authExists: boolean
  error: string | null
}

const numberFmt = new Intl.NumberFormat('pt-BR')
const percentFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

const EMPTY_LOCAL: LimitsPayload['local'] = {
  totals: { threads: 0, tokens: 0, last_used: null },
  byModel: [],
  recentThreads: [],
}

function safeNumber(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function safeText(value: unknown, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const maybe = value as { type?: unknown; details?: unknown; message?: unknown; error?: unknown }
    if (maybe.type || maybe.details) return [maybe.type, maybe.details].filter(Boolean).map(String).join(' — ')
    if (maybe.message) return String(maybe.message)
    if (maybe.error) return String(maybe.error)
    return JSON.stringify(value)
  }
  return String(value)
}

function normalizeLimitsPayload(payload: Partial<LimitsPayload> | null): LimitsPayload | null {
  if (!payload?.usage) return null
  const local = payload.local || EMPTY_LOCAL
  return {
    usage: {
      ...payload.usage,
      status: {
        ...payload.usage.status,
        reachedType: safeText(payload.usage.status?.reachedType, '') || null,
      },
    },
    local: {
      totals: {
        threads: safeNumber(local.totals?.threads),
        tokens: safeNumber(local.totals?.tokens),
        last_used: local.totals?.last_used ?? null,
      },
      byModel: Array.isArray(local.byModel)
        ? local.byModel.filter(Boolean).map((item) => ({
            model: item.model || 'desconhecido',
            provider: item.provider || 'desconhecido',
            threads: safeNumber(item.threads),
            tokens: safeNumber(item.tokens),
            last_used: safeNumber(item.last_used, 0),
          }))
        : [],
      recentThreads: Array.isArray(local.recentThreads)
        ? local.recentThreads.filter(Boolean).map((thread) => ({
            title: thread.title || 'Sem titulo',
            model: thread.model || 'desconhecido',
            provider: thread.provider || 'desconhecido',
            cwd: thread.cwd || '',
            tokens_used: safeNumber(thread.tokens_used),
            updated_at: safeNumber(thread.updated_at, 0),
          }))
        : [],
    },
  }
}

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

async function adminFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const method = options.method || 'GET'
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'x-admin-action': '1' } : {}),
    ...((options.headers || {}) as Record<string, string>),
  }
  const response = await fetch(url, { ...options, method, headers })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Falha na requisicao')
  return payload as T
}

type TabId = 'codex' | 'deepseek' | 'pc'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'codex', label: 'Codex', icon: '🤖' },
  { id: 'deepseek', label: 'DeepSeek', icon: '🧠' },
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
  const [dsData, setDsData] = useState<DeepSeekPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pcError, setPcError] = useState<string | null>(null)
  const [dsError, setDsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pcLoading, setPcLoading] = useState(true)
  const [dsLoading, setDsLoading] = useState(true)
  const [codexAdmin, setCodexAdmin] = useState<CodexAdminStatus | null>(null)
  const [profilesData, setProfilesData] = useState<CodexProfilesPayload | null>(null)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [newProfileName, setNewProfileName] = useState('')
  const [codexLogin, setCodexLogin] = useState<CodexLoginStatus | null>(null)
  const [profilesBusy, setProfilesBusy] = useState(false)
  const codexLoginPopupRef = useRef<Window | null>(null)

  async function loadLimits() {
    try {
      setError(null)
      const response = await fetch('/api/limits')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Falha ao consultar limites')
      const normalized = normalizeLimitsPayload(payload)
      if (!normalized) throw new Error('Resposta da API de limites veio sem dados de uso')
      setData(normalized)
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

  async function loadDeepSeek() {
    try {
      setDsError(null)
      setDsLoading(true)
      const response = await fetch('/api/deepseek')
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Falha ao consultar DeepSeek')
      setDsData(payload)
    } catch (err) {
      setDsError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setDsLoading(false)
    }
  }

  async function loadCodexAdminStatus() {
    try {
      const payload = await adminFetch<CodexAdminStatus>('/api/codex-profiles/status')
      setCodexAdmin(payload)
      if (!payload.authenticated) setProfilesData(null)
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    }
  }

  async function loadCodexProfiles() {
    try {
      setProfilesError(null)
      const payload = await adminFetch<CodexProfilesPayload>('/api/codex-profiles')
      setProfilesData(payload)
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    }
  }

  async function loadCodexLoginStatus() {
    try {
      const payload = await adminFetch<CodexLoginStatus>('/api/codex-login/status')
      setCodexLogin(payload)
      openCodexLoginUrlIfReady(payload)
    } catch {
      // Ignora enquanto nao autenticado.
    }
  }

  function prepareCodexLoginPopup() {
    const popup = window.open('', 'codex-login', 'popup=yes,width=760,height=860')
    codexLoginPopupRef.current = popup
    if (!popup) {
      setProfilesError('O navegador bloqueou a janela de login. Libere pop-ups para este site ou use o link que aparecer no painel.')
      return
    }
    popup.document.write(`<!doctype html><html><head><title>Login Codex</title></head><body style="margin:0;background:#080a0f;color:#e2e8f0;font-family:system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;padding:32px;text-align:center"><h1 style="color:white">Preparando login Codex...</h1><p>O painel esta iniciando <code>codex login --device-auth</code> no servidor. Assim que a OpenAI retornar a URL, esta janela vai abrir a pagina de login automaticamente.</p></main></body></html>`)
    popup.document.close()
  }

  function openCodexLoginUrlIfReady(status: CodexLoginStatus | null) {
    if (!status?.loginUrl) return
    const popup = codexLoginPopupRef.current
    if (popup && !popup.closed && popup.location.href !== status.loginUrl) {
      popup.location.href = status.loginUrl
    }
  }

  async function loginCodexAdmin() {
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      await adminFetch<{ ok: boolean }>('/api/codex-profiles/login', {
        method: 'POST',
        body: JSON.stringify({ password: adminPassword }),
      })
      setAdminPassword('')
      await loadCodexAdminStatus()
      await loadCodexProfiles()
      await loadCodexLoginStatus()
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setProfilesBusy(false)
    }
  }

  async function saveCurrentCodexProfile() {
    const name = newProfileName.trim()
    if (!name) {
      setProfilesError('Informe um nome para o perfil.')
      return
    }
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await adminFetch<CodexProfilesPayload>('/api/codex-profiles/save-current', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      setProfilesData(payload)
      setNewProfileName('')
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setProfilesBusy(false)
    }
  }

  async function activateCodexProfile(slug: string) {
    if (!window.confirm('Ativar este perfil vai substituir ~/.codex/auth.json atual, com backup. Continuar?')) return
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await adminFetch<CodexProfilesPayload>(`/api/codex-profiles/${slug}/activate`, { method: 'POST' })
      setProfilesData(payload)
      await loadLimits()
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setProfilesBusy(false)
    }
  }

  async function deleteCodexProfile(slug: string) {
    if (!window.confirm('Excluir este perfil salvo? A conta ativa nao sera removida.')) return
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await adminFetch<CodexProfilesPayload>(`/api/codex-profiles/${slug}`, { method: 'DELETE' })
      setProfilesData(payload)
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setProfilesBusy(false)
    }
  }

  async function startCodexLogin() {
    prepareCodexLoginPopup()
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await adminFetch<CodexLoginStatus>('/api/codex-login/start', { method: 'POST' })
      setCodexLogin(payload)
      openCodexLoginUrlIfReady(payload)
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setProfilesBusy(false)
    }
  }

  async function cancelCodexLogin() {
    try {
      setProfilesBusy(true)
      const payload = await adminFetch<CodexLoginStatus>('/api/codex-login/cancel', { method: 'POST' })
      setCodexLogin(payload)
    } catch (err) {
      setProfilesError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setProfilesBusy(false)
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      loadLimits()
      loadPcMetrics()
      loadDeepSeek()
      loadCodexAdminStatus()
    }, 0)
    const fullRefreshTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadLimits()
      loadDeepSeek()
    }, 60_000)
    const pcRealtimeTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadPcMetrics()
    }, 2_000)
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      loadPcMetrics()
      loadLimits()
      loadDeepSeek()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(fullRefreshTimer)
      window.clearInterval(pcRealtimeTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!codexAdmin?.authenticated) return
    loadCodexProfiles()
    loadCodexLoginStatus()
  }, [codexAdmin?.authenticated])

  useEffect(() => {
    if (!codexAdmin?.authenticated) return
    const timer = window.setInterval(() => {
      loadCodexLoginStatus()
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [codexAdmin?.authenticated])

  const totalModelTokens = useMemo(() => {
    return data?.local.byModel.reduce((sum, item) => sum + safeNumber(item.tokens), 0) || 0
  }, [data])

  const localTotals = data?.local.totals || EMPTY_LOCAL.totals
  const byModel = data?.local.byModel || []
  const recentThreads = data?.local.recentThreads || []
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
                : tab === 'deepseek'
                ? 'Saldo disponivel na conta DeepSeek, historico de uso e status da API.'
                : 'Monitoramento em tempo real de CPU, RAM, discos, temperatura e uptime deste servidor.'}
            </p>
          </div>
          <div className="flex flex-col gap-3 text-sm text-slate-300 md:items-end">
            {tab === 'codex' && <StatusPill allowed={data?.usage.status.allowed} loading={loading} />}
            {tab === 'codex' && <span>Conta: {data?.usage.account.email || 'Carregando...'} <PlanBadge planType={data?.usage.account.planType} /></span>}
            {tab === 'codex' && <span>Plano: {data?.usage.account.planType || '-'}</span>}
            <button
              onClick={() => { loadLimits(); loadPcMetrics(); loadDeepSeek() }}
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

        {tab === 'deepseek' && dsError && (
          <section className="rounded-3xl border border-red-400/30 bg-red-500/10 p-5 text-red-100">
            <strong>Erro ao carregar DeepSeek:</strong> {dsError}
          </section>
        )}

        {/* ─── Codex Tab ─── */}
        {tab === 'codex' && (
          <>
            <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
              <LimitHero window={primary} loading={loading} />
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                <WeeklyLimitCard window={secondary} />
                <MetricCard label="Tokens locais registrados" value={numberFmt.format(localTotals.tokens)} detail={`${numberFmt.format(localTotals.threads)} conversas no historico`} />
                <MetricCard label="Creditos extras" value={data?.usage.credits?.balance ?? '--'} detail={data?.usage.credits?.has_credits ? 'creditos ativos' : 'sem creditos extras'} />
              </div>
            </section>

            <CodexAccountsPanel
              admin={codexAdmin}
              profilesData={profilesData}
              loginStatus={codexLogin}
              error={profilesError}
              adminPassword={adminPassword}
              newProfileName={newProfileName}
              busy={profilesBusy}
              onAdminPasswordChange={setAdminPassword}
              onNewProfileNameChange={setNewProfileName}
              onAdminLogin={loginCodexAdmin}
              onSaveCurrent={saveCurrentCodexProfile}
              onActivate={activateCodexProfile}
              onDelete={deleteCodexProfile}
              onStartLogin={startCodexLogin}
              onCancelLogin={cancelCodexLogin}
              onRefresh={() => { loadCodexProfiles(); loadCodexLoginStatus(); loadLimits() }}
            />

            <section className="grid gap-5 lg:grid-cols-3">
              <InfoPanel title="Janela principal" window={primary} />
              <InfoPanel title="Janela secundaria" window={secondary} />
              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                <h2 className="text-lg font-bold text-white">Estado da conta</h2>
                <div className="mt-5 space-y-4 text-sm text-slate-300">
                  <Row label="Uso bloqueado" value={data?.usage.status.limitReached ? 'Sim' : 'Nao'} />
                  <Row label="Tipo de bloqueio" value={data?.usage.status.reachedType || 'Nenhum'} />
                  <Row label="Ultima leitura" value={formatDate(data?.usage.checkedAt)} />
                  <Row label="Ultimo uso local" value={formatDate(localTotals.last_used)} />
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
                  {byModel.map((item) => (
                    <ModelBar key={`${item.provider}-${item.model}`} item={item} total={totalModelTokens} />
                  ))}
                  {byModel.length === 0 && <p className="text-slate-400">Nenhuma metrica local encontrada ainda.</p>}
                </div>
              </section>

              <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                <h2 className="text-xl font-bold text-white">Conversas recentes</h2>
                <p className="mt-1 text-sm text-slate-400">Ajuda a entender onde o consumo local foi gerado.</p>
                <div className="mt-5 space-y-3">
                  {recentThreads.map((thread, index) => (
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

        {/* ─── DeepSeek Tab ─── */}
        {tab === 'deepseek' && (
          <>
            {dsLoading && !dsData && (
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-center text-slate-400">
                Carregando saldo do DeepSeek...
              </div>
            )}

            {dsData && dsData.balance && (
              <>
                {/* Saldo principal */}
                <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
                  <section className="relative overflow-hidden rounded-3xl border border-emerald-200/10 bg-slate-900/80 p-4 shadow-2xl shadow-emerald-950/20 sm:rounded-[2rem] sm:p-8">
                    <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-emerald-300/10 blur-3xl" />
                    <div className="relative">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200 sm:text-sm sm:tracking-[0.24em]">
                        Saldo DeepSeek
                      </p>
                      {dsData.balance.balance_infos.map((b, i) => (
                        <div key={i} className="mt-4">
                          <div className="flex items-baseline gap-3">
                            <h2 className="text-5xl font-black text-white sm:text-7xl">
                              ${parseFloat(b.total_balance).toFixed(2)}
                            </h2>
                            <span className="text-xl text-slate-400">{b.currency}</span>
                          </div>
                          <div className="mt-6 grid gap-3 sm:grid-cols-3">
                            <MiniStat label="Concedido" value={`$${parseFloat(b.granted_balance).toFixed(2)}`} />
                            <MiniStat label="Recarregado" value={`$${parseFloat(b.topped_up_balance).toFixed(2)}`} />
                            <MiniStat label="Disponivel" value={dsData.balance.is_available ? 'Sim' : 'Nao'} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                    <MetricCard
                      label="Status da API"
                      value={dsData.balance.is_available ? 'Operacional' : 'Indisponivel'}
                      detail="Consulta feita via API oficial DeepSeek"
                    />
                    <MetricCard
                      label="Ultima atualizacao"
                      value={formatDate(dsData.checkedAt).split(', ')[1] || formatDate(dsData.checkedAt)}
                      detail={formatDate(dsData.checkedAt)}
                    />
                  </div>
                </section>

                {/* Detalhes das contas */}
                <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 sm:p-6">
                  <h2 className="text-xl font-bold text-white">Detalhes da conta</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    Informacoes retornadas pela API <code className="rounded bg-white/5 px-1.5 py-0.5 text-xs">/v1/user/balance</code>
                  </p>
                  <div className="mt-5 space-y-3">
                    {dsData.balance.balance_infos.map((b, i) => (
                      <article key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <h3 className="mb-3 text-lg font-semibold text-slate-100">
                          Saldo em {b.currency}
                        </h3>
                        <div className="space-y-4 text-sm text-slate-300">
                          <Row label="Total" value={`$${parseFloat(b.total_balance).toFixed(2)}`} />
                          <Row label="Concedido (gratis)" value={`$${parseFloat(b.granted_balance).toFixed(2)}`} />
                          <Row label="Recarregado (pagamento)" value={`$${parseFloat(b.topped_up_balance).toFixed(2)}`} />
                          <Row label="Disponivel" value={dsData.balance.is_available ? 'Sim' : 'Nao'} />
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}

            {!dsLoading && !dsData && !dsError && (
              <section className="rounded-3xl border border-amber-400/30 bg-amber-500/10 p-5 text-amber-100">
                <strong>Sem dados.</strong> Nao foi possivel carregar o saldo do DeepSeek.
              </section>
            )}
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


function CodexAccountsPanel({
  admin,
  profilesData,
  loginStatus,
  error,
  adminPassword,
  newProfileName,
  busy,
  onAdminPasswordChange,
  onNewProfileNameChange,
  onAdminLogin,
  onSaveCurrent,
  onActivate,
  onDelete,
  onStartLogin,
  onCancelLogin,
  onRefresh,
}: {
  admin: CodexAdminStatus | null
  profilesData: CodexProfilesPayload | null
  loginStatus: CodexLoginStatus | null
  error: string | null
  adminPassword: string
  newProfileName: string
  busy: boolean
  onAdminPasswordChange: (value: string) => void
  onNewProfileNameChange: (value: string) => void
  onAdminLogin: () => void
  onSaveCurrent: () => void
  onActivate: (slug: string) => void
  onDelete: (slug: string) => void
  onStartLogin: () => void
  onCancelLogin: () => void
  onRefresh: () => void
}) {
  return (
    <section className="rounded-3xl border border-cyan-300/20 bg-slate-900/75 p-4 shadow-xl shadow-cyan-950/10 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Contas Codex</h2>
          <p className="mt-1 text-sm text-slate-400">
            Gerencie perfis locais, faça login pelo site e alterne qual auth.json fica ativo neste servidor.
          </p>
        </div>
        <button
          className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
          disabled={busy}
          onClick={onRefresh}
          type="button"
        >
          Atualizar contas
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      )}

      {admin && !admin.adminConfigured && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">
          Configure a senha admin no servidor antes de usar esta area: LIMITS_PANEL_ADMIN_PASSWORD ou arquivo seguro gerado em ~/.config/codex-profiles/admin-secret.json.
        </div>
      )}

      {(!admin || !admin.authenticated) && admin?.adminConfigured !== false && (
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-300">Senha admin</span>
            <input
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
              onChange={(event) => onAdminPasswordChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onAdminLogin() }}
              placeholder="Digite a senha admin do painel"
              type="password"
              value={adminPassword}
            />
          </label>
          <button
            className="rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
            disabled={busy || !adminPassword.trim()}
            onClick={onAdminLogin}
            type="button"
          >
            Entrar como admin
          </button>
        </div>
      )}

      {admin?.authenticated && (
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="font-bold text-white">Conta ativa</h3>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <Row label="Auth encontrado" value={profilesData?.active.exists ? 'Sim' : 'Nao'} />
                <Row label="Email" value={`${profilesData?.active.email || 'Nao identificado'} ${profilePlanLabel(profilesData?.active.planType)}`} />
                <Row label="Conta" value={profilesData?.active.accountIdHint || 'Nao identificado'} />
                <Row label="Atualizado" value={formatDate(profilesData?.active.updatedAt)} />
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="font-bold text-white">Salvar conta ativa como perfil</h3>
              <p className="mt-1 text-xs text-slate-400">Copia ~/.codex/auth.json para ~/.config/codex-profiles/profiles/.</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none transition focus:border-cyan-300/60"
                  onChange={(event) => onNewProfileNameChange(event.target.value)}
                  placeholder="Ex: Álvaro pessoal"
                  value={newProfileName}
                />
                <button
                  className="rounded-xl bg-emerald-300 px-4 py-3 font-bold text-slate-950 transition hover:bg-emerald-200 disabled:opacity-50"
                  disabled={busy || !newProfileName.trim()}
                  onClick={onSaveCurrent}
                  type="button"
                >
                  Salvar
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="font-bold text-white">Login Codex pelo site</h3>
              <p className="mt-1 text-xs text-slate-400">
                Ao clicar, o painel abre uma janela de login da OpenAI/Codex, inicia codex login --device-auth no servidor e acompanha tudo por aqui. Depois do login, salve a conta ativa como perfil.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="rounded-xl bg-cyan-300 px-4 py-3 font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
                  disabled={busy || loginStatus?.running}
                  onClick={onStartLogin}
                  type="button"
                >
                  Iniciar login e abrir pagina Codex
                </button>
                {loginStatus?.running && (
                  <button
                    className="rounded-xl border border-red-300/30 px-4 py-3 font-bold text-red-100 transition hover:bg-red-500/10"
                    onClick={onCancelLogin}
                    type="button"
                  >
                    Cancelar
                  </button>
                )}
              </div>
              {loginStatus && (
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <Row label="Status" value={loginStatus.running ? 'Login em andamento' : loginStatus.exitCode === 0 ? 'Finalizado' : loginStatus.error || 'Parado'} />
                  <Row label="Auth existe" value={loginStatus.authExists ? 'Sim' : 'Nao'} />
                  {loginStatus.loginUrl && (
                    <a className="block rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-3 font-semibold text-cyan-100 hover:bg-cyan-300/15" href={loginStatus.loginUrl} rel="noreferrer" target="_blank">
                      Abrir pagina de login Codex
                    </a>
                  )}
                  {loginStatus.userCode && <Row label="Codigo" value={loginStatus.userCode} />}
                  {loginStatus.outputTail && (
                    <pre className="max-h-48 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-slate-300 whitespace-pre-wrap">{loginStatus.outputTail}</pre>
                  )}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-white">Perfis salvos</h3>
                <p className="text-xs text-slate-400">Tokens nunca sao enviados ao navegador.</p>
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-300">{profilesData?.profiles.length || 0} perfis</span>
            </div>

            <div className="space-y-3">
              {profilesData?.profiles.map((profile) => (
                <article key={profile.slug} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-white">{profile.name}</h4>
                        {profile.isActive && <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-xs font-bold text-emerald-200">ativo</span>}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{profile.emailHint || 'Email nao identificado'}{profile.planType ? <PlanBadge planType={profile.planType} /> : null} • {profile.accountIdHint || profile.slug}</p>
                      <p className="mt-1 text-xs text-slate-500">Criado: {formatDate(profile.createdAt)} • Ultima ativacao: {formatDate(profile.lastActivatedAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        className="rounded-lg bg-cyan-300 px-3 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
                        disabled={busy || profile.isActive}
                        onClick={() => onActivate(profile.slug)}
                        type="button"
                      >
                        Ativar
                      </button>
                      <button
                        className="rounded-lg border border-red-300/30 px-3 py-2 text-sm font-bold text-red-100 transition hover:bg-red-500/10 disabled:opacity-50"
                        disabled={busy}
                        onClick={() => onDelete(profile.slug)}
                        type="button"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {profilesData && profilesData.profiles.length === 0 && (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">Nenhum perfil salvo ainda.</p>
              )}
              {!profilesData && (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">Carregando perfis...</p>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
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

function PlanBadge({ planType }: { planType: string | null | undefined }) {
  if (!planType) return null
  const lower = planType.toLowerCase()
  if (lower.includes('plus')) return <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 px-2 py-0.5 text-[0.65rem] font-bold text-amber-200 shadow-sm shadow-amber-950/30">⭐ PLUS</span>
  if (lower.includes('pro')) return <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-purple-500/20 to-violet-500/20 px-2 py-0.5 text-[0.65rem] font-bold text-purple-200 shadow-sm shadow-purple-950/30">🔷 PRO</span>
  return <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-bold text-slate-400">◻️ FREE</span>
}

function profilePlanLabel(planType: string | null | undefined): string {
  if (!planType) return ''
  const lower = planType.toLowerCase()
  if (lower.includes('plus')) return '⭐ PLUS'
  if (lower.includes('pro')) return '🔷 PRO'
  return '◻️ FREE'
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

function WeeklyLimitCard({ window }: { window?: WindowInfo | null }) {
  const used = window?.usedPercent ?? 0
  const remaining = window?.remainingPercent ?? 0
  return (
    <section className="rounded-3xl border border-cyan-300/20 bg-slate-900/70 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">Limite semanal Codex</p>
          <strong className="mt-2 block text-2xl font-black text-white sm:text-3xl">
            {window ? `${percentFmt.format(remaining)}% restante` : '--'}
          </strong>
        </div>
        <span className="rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-bold text-cyan-200">7 dias</span>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex justify-between text-xs text-slate-400">
          <span>Usado: {window ? `${percentFmt.format(used)}%` : '--'}</span>
          <span>Restante: {window ? `${percentFmt.format(remaining)}%` : '--'}</span>
        </div>
        <Bar value={used} color="from-amber-300 to-red-400" />
      </div>
      <div className="mt-4 space-y-1 text-sm text-slate-400">
        <p>Reseta em: <span className="font-semibold text-slate-200">{window ? formatDuration(window.resetAfterSeconds) : '--'}</span></p>
        <p>Reset exato: <span className="font-semibold text-slate-200">{window ? formatDate(window.resetAt) : '--'}</span></p>
      </div>
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
