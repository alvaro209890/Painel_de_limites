import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { apiFetch } from './api/client'
import { AlertsModule } from './modules/alerts/AlertsModule'
import { AiModule } from './modules/ai/AiModule'
import { CodexAccountsModule } from './modules/codex-accounts/CodexAccountsModule'
import { MachinesModule } from './modules/machines/MachinesModule'
import { ProjectsModule } from './modules/projects/ProjectsModule'
import type { CodexAdminStatus, CodexLoginStatus, CodexProfilesPayload, CodexRotationPayload, DashboardOverviewPayload, MachinesPayload } from './types/dashboard'
import { formatDate } from './utils/format'

type TabId = 'machines' | 'ai' | 'codexAccounts' | 'projects' | 'alerts'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'machines', label: 'Máquinas', icon: '💻' },
  { id: 'ai', label: 'IA', icon: '🧠' },
  { id: 'codexAccounts', label: 'Contas Codex', icon: '🔐' },
  { id: 'projects', label: 'Projetos', icon: '🚀' },
  { id: 'alerts', label: 'Alertas', icon: '🚨' },
]

function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return (
    <nav className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1 shadow-lg sm:flex" role="tablist">
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
                ? 'bg-gradient-to-br from-cyan-300/20 to-emerald-300/20 text-white shadow-sm shadow-cyan-950/30'
                : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
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

function LoginGate({ status, busy, error, password, onPasswordChange, onSubmit }: {
  status: CodexAdminStatus | null
  busy: boolean
  error: string | null
  password: string
  onPasswordChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center justify-center">
      <section className="w-full rounded-[2rem] border border-white/10 bg-white/[0.05] p-6 shadow-2xl shadow-cyan-950/20 backdrop-blur sm:p-8">
        <p className="mb-3 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-cyan-200">
          Acesso privado
        </p>
        <h1 className="text-3xl font-black tracking-tight text-white">Central DevOps Pessoal</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          O painel agora protege limites de IA, métricas do servidor, saldo de API, projetos e alertas. Entre como admin para visualizar os módulos.
        </p>

        {!status?.adminConfigured && (
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-100">
            Senha admin não configurada no servidor. Configure `LIMITS_PANEL_ADMIN_PASSWORD` ou o arquivo admin-secret.json.
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
          <label className="block">
            <span className="text-sm font-bold text-slate-300">Senha admin</span>
            <input
              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none ring-cyan-300/30 transition focus:ring-4"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              type="password"
              placeholder="Digite a senha"
              disabled={busy || !status?.adminConfigured}
            />
          </label>
          {error && <p className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p>}
          <button
            className="w-full rounded-2xl bg-cyan-300 px-5 py-3 font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={busy || !password.trim() || !status?.adminConfigured}
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
  const [adminStatus, setAdminStatus] = useState<CodexAdminStatus | null>(null)
  const [dashboard, setDashboard] = useState<DashboardOverviewPayload | null>(null)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [profilesData, setProfilesData] = useState<CodexProfilesPayload | null>(null)
  const [codexLogin, setCodexLogin] = useState<CodexLoginStatus | null>(null)
  const [codexRotation, setCodexRotation] = useState<CodexRotationPayload | null>(null)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [rotationError, setRotationError] = useState<string | null>(null)
  const [newProfileName, setNewProfileName] = useState('')
  const [profilesBusy, setProfilesBusy] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [busy, setBusy] = useState(false)
  const codexLoginPopupRef = useRef<Window | null>(null)

  const authenticated = Boolean(adminStatus?.authenticated)

  const loadAdminStatus = useCallback(async () => {
    try {
      setAuthError(null)
      const payload = await apiFetch<CodexAdminStatus>('/api/codex-profiles/status')
      setAdminStatus(payload)
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

  const openCodexLoginUrlIfReady = useCallback((status: CodexLoginStatus | null) => {
    if (!status?.loginUrl) return
    const popup = codexLoginPopupRef.current
    if (popup && !popup.closed && popup.location.href !== status.loginUrl) popup.location.href = status.loginUrl
  }, [])

  const loadCodexProfiles = useCallback(async () => {
    if (!authenticated) return
    try {
      setProfilesError(null)
      const payload = await apiFetch<CodexProfilesPayload>('/api/codex-profiles')
      setProfilesData(payload)
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : 'Erro ao carregar perfis Codex')
    }
  }, [authenticated])

  const prevLoginRunningRef = useRef(false)

  const autoSaveAndActivate = useCallback(async () => {
    try {
      const payload = await apiFetch<CodexProfilesPayload>('/api/codex-login/auto-save', { method: 'POST' })
      setProfilesData(payload)
      setProfilesError(null)
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : 'Erro ao salvar conta automaticamente')
    }
  }, [])

  const loadCodexLoginStatus = useCallback(async () => {
    if (!authenticated) return
    try {
      const payload = await apiFetch<CodexLoginStatus>('/api/codex-login/status')
      setCodexLogin(payload)
      openCodexLoginUrlIfReady(payload)
      // Login completou (antes running, agora não) → salva+ativa automaticamente
      if (prevLoginRunningRef.current && !payload.running && payload.exitCode === 0) {
        void autoSaveAndActivate()
      }
      prevLoginRunningRef.current = payload.running
    } catch {
      // Ignora falha pontual; status de login é auxiliar.
    }
  }, [authenticated, openCodexLoginUrlIfReady, autoSaveAndActivate])

  const loadCodexRotation = useCallback(async () => {
    if (!authenticated) return
    try {
      setRotationError(null)
      const payload = await apiFetch<CodexRotationPayload>('/api/codex-rotation')
      setCodexRotation(payload)
    } catch (error) {
      setRotationError(error instanceof Error ? error.message : 'Erro ao carregar rotação Codex')
    }
  }, [authenticated])

  const refreshCodexAccounts = useCallback(() => {
    void loadCodexProfiles()
    void loadCodexLoginStatus()
    void loadCodexRotation()
  }, [loadCodexLoginStatus, loadCodexProfiles, loadCodexRotation])

  const saveCurrentCodexProfile = useCallback(async () => {
    const name = newProfileName.trim()
    if (!name) {
      setProfilesError('Informe um nome para o perfil.')
      return
    }
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await apiFetch<CodexProfilesPayload>('/api/codex-profiles/save-current', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      setProfilesData(payload)
      setNewProfileName('')
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : 'Erro ao salvar perfil')
    } finally {
      setProfilesBusy(false)
    }
  }, [newProfileName])

  const activateCodexProfile = useCallback(async (slug: string) => {
    if (!window.confirm('Ativar este perfil vai substituir ~/.codex/auth.json atual, com backup. Continuar?')) return
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await apiFetch<CodexProfilesPayload>(`/api/codex-profiles/${slug}/activate`, { method: 'POST' })
      setProfilesData(payload)
      await loadDashboard()
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : 'Erro ao ativar perfil')
    } finally {
      setProfilesBusy(false)
    }
  }, [loadDashboard])

  const deleteCodexProfile = useCallback(async (slug: string) => {
    if (!window.confirm('Excluir este perfil salvo? A conta ativa não será removida.')) return
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await apiFetch<CodexProfilesPayload>(`/api/codex-profiles/${slug}`, { method: 'DELETE' })
      setProfilesData(payload)
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : 'Erro ao excluir perfil')
    } finally {
      setProfilesBusy(false)
    }
  }, [])

  const prepareCodexLoginPopup = useCallback(() => {
    const popup = window.open('', 'codex-login', 'width=820,height=900,toolbar=yes,scrollbars=yes')
    codexLoginPopupRef.current = popup
    if (!popup) {
      setProfilesError('O navegador bloqueou a janela de login. Libere pop-ups ou use o link que aparecer no painel.')
      return
    }
    popup.document.write('<!doctype html><html><head><title>Login Codex</title></head><body style="margin:0;background:#080a0f;color:#e2e8f0;font-family:system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:540px;padding:32px;text-align:center"><h1 style="color:white">Login Codex</h1><p>Aguardando URL de login do servidor...</p><p style="margin-top:24px;padding:16px;border:1px solid #334155;border-radius:12px;background:#1e293b;font-size:13px;line-height:1.6"><strong style="color:#fbbf24">⚠️ Importante:</strong><br>Para logar em uma conta DIFERENTE, copie o link abaixo e abra em uma <strong style="color:#67e8f9">janela anônima/privada</strong> (Ctrl+Shift+N).<br><br>Assim você pode fazer login com outra conta do ChatGPT sem interferir na sua sessão atual.</p></main></body></html>')
    popup.document.close()
  }, [])

  const startCodexLogin = useCallback(async () => {
    prepareCodexLoginPopup()
    try {
      setProfilesBusy(true)
      setProfilesError(null)
      const payload = await apiFetch<CodexLoginStatus>('/api/codex-login/start', { method: 'POST' })
      setCodexLogin(payload)
      openCodexLoginUrlIfReady(payload)
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : 'Erro ao iniciar login Codex')
    } finally {
      setProfilesBusy(false)
    }
  }, [openCodexLoginUrlIfReady, prepareCodexLoginPopup])

  const cancelCodexLogin = useCallback(async () => {
    try {
      setProfilesBusy(true)
      const payload = await apiFetch<CodexLoginStatus>('/api/codex-login/cancel', { method: 'POST' })
      setCodexLogin(payload)
    } catch (error) {
      setProfilesError(error instanceof Error ? error.message : 'Erro ao cancelar login Codex')
    } finally {
      setProfilesBusy(false)
    }
  }, [])

  const updateCodexRotationConfig = useCallback(async (config: Partial<CodexRotationPayload['config']>) => {
    try {
      setProfilesBusy(true)
      setRotationError(null)
      const payload = await apiFetch<CodexRotationPayload>('/api/codex-rotation/config', {
        method: 'POST',
        body: JSON.stringify(config),
      })
      setCodexRotation(payload)
    } catch (error) {
      setRotationError(error instanceof Error ? error.message : 'Erro ao atualizar rotação')
    } finally {
      setProfilesBusy(false)
    }
  }, [])

  const runCodexRotation = useCallback(async (dryRun: boolean) => {
    try {
      setProfilesBusy(true)
      setRotationError(null)
      const payload = await apiFetch<CodexRotationPayload>('/api/codex-rotation/run-once', {
        method: 'POST',
        body: JSON.stringify({ force: true, dryRun, reason: dryRun ? 'teste_manual' : 'execucao_manual' }),
      })
      setCodexRotation(payload)
      await loadCodexProfiles()
      await loadDashboard()
    } catch (error) {
      setRotationError(error instanceof Error ? error.message : 'Erro ao executar rotação')
    } finally {
      setProfilesBusy(false)
    }
  }, [loadCodexProfiles, loadDashboard])

  async function login() {
    try {
      setBusy(true)
      setAuthError(null)
      await apiFetch<{ ok: boolean }>('/api/codex-profiles/login', {
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
      await apiFetch<{ ok: boolean }>('/api/codex-profiles/logout', { method: 'POST' })
    } finally {
      setDashboard(null)
      setProfilesData(null)
      setCodexLogin(null)
      setCodexRotation(null)
      setAdminStatus((current) => current ? { ...current, authenticated: false } : current)
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
    if (!authenticated) return
    const timer = window.setTimeout(() => refreshCodexAccounts(), 0)
    return () => window.clearTimeout(timer)
  }, [authenticated, refreshCodexAccounts])

  useEffect(() => {
    if (!authenticated || tab !== 'codexAccounts') return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadCodexLoginStatus()
    }, 2_000)
    return () => window.clearInterval(interval)
  }, [authenticated, loadCodexLoginStatus, tab])

  useEffect(() => {
    if (!authenticated || tab !== 'machines') return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadMachines()
    }, 5_000)
    return () => window.clearInterval(interval)
  }, [authenticated, tab, loadMachines])

  const counts = useMemo(() => ({
    machinesOnline: dashboard?.machines.filter((machine) => machine.status === 'online').length || 0,
    machinesTotal: dashboard?.machines.length || 0,
    projectsOnline: dashboard?.projects.filter((project) => project.status === 'online').length || 0,
    projectsTotal: dashboard?.projects.length || 0,
    criticalAlerts: dashboard?.alerts.filter((alert) => alert.severity === 'critical').length || 0,
    profilesTotal: profilesData?.profiles.length || 0,
  }), [dashboard, profilesData])

  const moduleContent = (() => {
    if (tab === 'machines') return <MachinesModule machines={dashboard?.machines || []} loading={loadingDashboard} error={dashboardError} onRefresh={loadMachines} />
    if (tab === 'ai') return <AiModule limits={dashboard?.ai.limits || null} deepseek={dashboard?.ai.deepseek || null} loading={loadingDashboard} error={dashboardError} />
    if (tab === 'codexAccounts') {
      return (
        <CodexAccountsModule
          admin={adminStatus}
          profilesData={profilesData}
          hermesCodex={dashboard?.ai.limits?.hermesCodex || null}
          loginStatus={codexLogin}
          rotationStatus={codexRotation}
          error={profilesError}
          rotationError={rotationError}
          newProfileName={newProfileName}
          busy={profilesBusy}
          onNewProfileNameChange={setNewProfileName}
          onSaveCurrent={saveCurrentCodexProfile}
          onActivate={activateCodexProfile}
          onDelete={deleteCodexProfile}
          onStartLogin={startCodexLogin}
          onCancelLogin={cancelCodexLogin}
          onUpdateRotation={updateCodexRotationConfig}
          onRunRotation={runCodexRotation}
          onRefresh={refreshCodexAccounts}
        />
      )
    }
    if (tab === 'projects') return <ProjectsModule projects={dashboard?.projects || []} loading={loadingDashboard} error={dashboardError} />
    return <AlertsModule alerts={dashboard?.alerts || []} loading={loadingDashboard} error={dashboardError} />
  })()

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#080a0f] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(34,197,94,0.12),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.8),rgba(2,6,23,0.95))]" />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 px-3 py-4 sm:px-8 sm:py-8 lg:px-10">
        {loadingStatus ? (
          <div className="py-20 text-center text-slate-400">Verificando sessão...</div>
        ) : !authenticated ? (
          <LoginGate
            status={adminStatus}
            busy={busy}
            error={authError}
            password={password}
            onPasswordChange={setPassword}
            onSubmit={login}
          />
        ) : (
          <>
            <header className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 shadow-2xl shadow-cyan-950/20 backdrop-blur sm:rounded-[2rem] sm:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="mb-3 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-cyan-200">
                    Central DevOps
                  </p>
                  <h1 className="max-w-4xl text-3xl font-black tracking-tight text-white sm:text-6xl">Servidor Interno</h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400 sm:text-base">
                    Máquinas, IA, projetos e alertas em uma única central privada. Dados sensíveis ficam atrás do login admin.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-cyan-300/15" onClick={() => void loadDashboard()} type="button">
                    Atualizar agora
                  </button>
                  <button className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-slate-200 transition hover:bg-white/[0.08]" onClick={() => void logout()} type="button" disabled={busy}>
                    Sair
                  </button>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-5">
                <div className="rounded-2xl bg-black/20 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Máquinas</p><p className="mt-1 text-xl font-black">{counts.machinesOnline}/{counts.machinesTotal}</p></div>
                <div className="rounded-2xl bg-black/20 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Perfis Codex</p><p className="mt-1 text-xl font-black">{counts.profilesTotal}</p></div>
                <div className="rounded-2xl bg-black/20 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Projetos</p><p className="mt-1 text-xl font-black">{counts.projectsOnline}/{counts.projectsTotal}</p></div>
                <div className="rounded-2xl bg-black/20 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Alertas críticos</p><p className="mt-1 text-xl font-black text-rose-100">{counts.criticalAlerts}</p></div>
                <div className="rounded-2xl bg-black/20 p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Atualizado</p><p className="mt-1 text-sm font-bold">{formatDate(dashboard?.checkedAt)}</p></div>
              </div>
            </header>

            <TabBar active={tab} onChange={setTab} />
            {moduleContent}
          </>
        )}
      </div>
    </main>
  )
}

export default App
