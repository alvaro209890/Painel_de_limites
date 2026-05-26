import { MetricCard } from '../../components/MetricCard'
import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { CodexAdminStatus, CodexLoginStatus, GeminiLoginStatus, CodexProfilesPayload, CodexRotationPayload, HermesCodexPayload, DeepSeekPayload, OpenCodeZenStatus } from '../../types/dashboard'
import { formatDate, formatDuration, formatNumber, formatPercent } from '../../utils/format'

type CodexAccountsModuleProps = {
  admin: CodexAdminStatus | null
  profilesData: CodexProfilesPayload | null
  deepseek: DeepSeekPayload | null
  openCodeZen: OpenCodeZenStatus | null
  hermesCodex: HermesCodexPayload | null
  loginStatus: CodexLoginStatus | null
  geminiLoginStatus: GeminiLoginStatus | null
  geminiAuthCode: string
  rotationStatus: CodexRotationPayload | null
  error: string | null
  rotationError: string | null
  newProfileName: string
  busy: boolean
  onNewProfileNameChange: (value: string) => void
  onSaveCurrent: () => void
  onActivate: (slug: string) => void
  onDelete: (slug: string) => void
  onStartLogin: () => void
  onCancelLogin: () => void
  onStartGeminiLogin: () => void
  onCancelGeminiLogin: () => void
  onGeminiAuthCodeChange: (value: string) => void
  onSubmitGeminiCode: () => void
  onUpdateRotation: (config: Partial<CodexRotationPayload['config']>) => void
  onRunRotation: (dryRun: boolean) => void
  onRefresh: () => void
}

function boolLabel(value: boolean) {
  return value ? 'Sim' : 'Não'
}

function safeJson(value: unknown) {
  if (value === null || value === undefined) return 'Sem resultado ainda'
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

function limitTone(value?: number | null) {
  if (value === null || value === undefined) return 'text-slate-300'
  if (value <= 10) return 'text-rose-200'
  if (value <= 25) return 'text-amber-200'
  return 'text-emerald-200'
}

export function CodexAccountsModule({
  admin,
  profilesData,
  deepseek,
  openCodeZen,
  hermesCodex,
  loginStatus,
  geminiLoginStatus,
  geminiAuthCode,
  rotationStatus,
  error,
  rotationError,
  newProfileName,
  busy,
  onNewProfileNameChange,
  onSaveCurrent,
  onActivate,
  onDelete,
  onStartLogin,
  onCancelLogin,
  onStartGeminiLogin,
  onCancelGeminiLogin,
  onGeminiAuthCodeChange,
  onSubmitGeminiCode,
  onUpdateRotation,
  onRunRotation,
  onRefresh,
}: CodexAccountsModuleProps) {
  const active = profilesData?.active
  const hermesUsage = hermesCodex?.usage
  const profiles = profilesData?.profiles || []
  const rotation = rotationStatus?.config
  const geminiAuthExpired = geminiLoginStatus?.oauthExpired === true
  const geminiAuthReady = Boolean(geminiLoginStatus?.authExists && !geminiAuthExpired)
  const geminiBadgeStatus = geminiAuthReady ? 'online' : geminiLoginStatus?.authExists ? 'warning' : 'offline'
  const geminiBadgeLabel = geminiAuthReady ? 'Gemini logado' : geminiLoginStatus?.authExists ? 'OAuth expirado' : 'Sem OAuth'
  const dsBalance = deepseek?.balance.balance_infos?.[0]

  const providers = [
    {
      key: 'deepseek',
      label: 'DeepSeek',
      status: deepseek?.balance.is_available ? 'online' : 'warning' as const,
      statusLabel: deepseek?.balance.is_available ? 'Disponível' : 'Indisponível',
      color: 'emerald' as const,
    },
    {
      key: 'openai',
      label: 'OpenAI / Codex',
      status: hermesCodex?.ok ? 'online' : 'warning' as const,
      statusLabel: hermesCodex?.ok ? 'Conectado' : 'Atenção',
      color: 'cyan' as const,
    },
    {
      key: 'codex-cli',
      label: 'Codex CLI',
      status: admin?.authenticated ? 'online' : 'offline' as const,
      statusLabel: admin?.authenticated ? 'Logado' : 'Sem login',
      color: 'slate' as const,
    },
    {
      key: 'gemini',
      label: 'Gemini',
      status: geminiBadgeStatus,
      statusLabel: geminiBadgeLabel,
      color: 'violet' as const,
    },
    {
      key: 'zen',
      label: 'OpenCode Zen',
      status: openCodeZen?.totalRequests ? 'online' : 'warning' as const,
      statusLabel: openCodeZen?.totalRequests ? 'Ativo' : 'Inativo',
      color: 'amber' as const,
    },
  ]

  return (
    <div className="space-y-5">
      {/* Barra de status dos provedores */}
      <div className="rounded-[2rem] border border-white/10 bg-[#0f1011]/80 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-200/80">Ecossistema de IA</p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">Provedores ativos no runtime</h2>
          </div>
          <button className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-300/15" onClick={onRefresh} type="button" disabled={busy}>
            Sincronizar
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => (
            <span
              key={p.key}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
                p.color === 'emerald' ? 'border-emerald-300/20 bg-emerald-400/10 text-emerald-100' :
                p.color === 'cyan' ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100' :
                p.color === 'violet' ? 'border-violet-300/20 bg-violet-400/10 text-violet-100' :
                p.color === 'amber' ? 'border-amber-300/20 bg-amber-400/10 text-amber-100' :
                'border-white/10 bg-white/[0.04] text-slate-300'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${
                p.status === 'online' ? 'bg-emerald-300' : p.status === 'warning' ? 'bg-amber-300' : 'bg-slate-500'
              }`} />
              {p.label}: {p.statusLabel}
            </span>
          ))}
        </div>
      </div>

      {/* Grid de provedores */}
      {error && <p className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">

        {/* DeepSeek */}
        <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.04] p-4 shadow-lg shadow-emerald-950/10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-200/80">DeepSeek API</p>
              <h3 className="mt-1 text-lg font-black text-white">Provider principal</h3>
            </div>
            <StatusBadge status={deepseek?.balance.is_available ? 'online' : 'warning'} label={deepseek?.balance.is_available ? 'Disponível' : 'Indisponível'} />
          </div>
          <div className="grid gap-3">
            <MetricCard label="Saldo total" value={dsBalance ? `$ ${dsBalance.total_balance}` : '--'} hint={dsBalance?.currency || 'USD'} tone={Number(dsBalance?.total_balance || 0) <= 1 ? 'warning' : 'good'} />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs text-slate-500">Crédito pago</p><p className="font-bold text-slate-100">{dsBalance ? `$ ${dsBalance.topped_up_balance}` : '--'}</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs text-slate-500">Crédito concedido</p><p className="font-bold text-slate-100">{dsBalance ? `$ ${dsBalance.granted_balance}` : '--'}</p></div>
            </div>
            <p className="text-xs text-slate-500">Atualizado: {formatDate(deepseek?.checkedAt)}</p>
          </div>
          <div className="mt-3 rounded-xl border border-emerald-300/10 bg-emerald-400/[0.03] p-3">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Modelos ativos</p>
            <p className="mt-1 text-sm font-bold text-emerald-100">deepseek-v4-flash • deepseek-v4-pro</p>
          </div>
        </div>

        {/* OpenAI Codex (Hermes) */}
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 shadow-lg shadow-cyan-950/20">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">OpenAI Codex</p>
              <h3 className="mt-1 text-lg font-black text-white">Credencial do Hermes</h3>
            </div>
            <StatusBadge status={hermesCodex?.ok ? 'online' : 'warning'} label={hermesCodex?.ok ? 'Conectado' : 'Atenção'} />
          </div>
          <dl className="space-y-2.5 text-sm">
            <div><dt className="text-cyan-100/70">Fonte</dt><dd className="font-bold text-slate-100">~/.hermes/auth.json</dd></div>
            <div><dt className="text-cyan-100/70">Provider</dt><dd className="font-bold text-slate-100">openai-codex</dd></div>
            <div><dt className="text-cyan-100/70">Credencial</dt><dd className="font-bold text-slate-100">{hermesCodex?.credentialLabel || '-'}</dd></div>
            <div><dt className="text-cyan-100/70">E-mail</dt><dd className="font-bold text-slate-100">{hermesUsage?.account.email || 'Sem dados'}</dd></div>
            <div><dt className="text-cyan-100/70">Plano</dt><dd className="font-bold text-slate-100">{hermesUsage?.account.planType || '-'}</dd></div>
          </dl>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/[0.04] p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Janela atual</p>
              <p className={`mt-1 text-xl font-black ${limitTone(hermesUsage?.windows.primary?.remainingPercent)}`}>
                {hermesUsage?.windows.primary ? formatPercent(hermesUsage.windows.primary.remainingPercent) : '--'}
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.04] p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Status</p>
              <p className={`mt-1 text-sm font-bold ${hermesUsage?.status.allowed ? 'text-emerald-200' : 'text-rose-200'}`}>
                {hermesUsage?.status.allowed ? 'Permitido' : 'Limitado'}
              </p>
            </div>
          </div>
          <div className="mt-3 rounded-xl border border-cyan-300/10 bg-cyan-300/[0.03] p-3">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Modelo delegado</p>
            <p className="mt-1 text-sm font-bold text-cyan-100">gpt-5.5 • via credential pool</p>
          </div>
          <p className="mt-3 text-xs text-slate-500">Atualizado: {formatDate(hermesUsage?.checkedAt)}</p>
          {hermesCodex?.error && <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs text-amber-100">{hermesCodex.error}</p>}
        </div>

        {/* Codex CLI */}
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Codex CLI</p>
              <h3 className="mt-1 text-lg font-black text-white">CLI standalone</h3>
            </div>
            <StatusBadge status={admin?.authenticated ? 'online' : 'offline'} label={admin?.authenticated ? 'Logado' : 'Sem login'} />
          </div>
          <dl className="space-y-2.5 text-sm">
            <div><dt className="text-slate-500">Fonte</dt><dd className="font-bold text-slate-100">~/.codex/auth.json</dd></div>
            <div><dt className="text-slate-500">E-mail</dt><dd className="font-bold text-slate-100">{active?.email || 'Sem dados'}</dd></div>
            <div><dt className="text-slate-500">Plano</dt><dd className="font-bold text-slate-100">{active?.planType || '-'}</dd></div>
            <div><dt className="text-slate-500">Conta</dt><dd className="font-bold text-slate-100">{active?.accountIdHint || '-'}</dd></div>
            <div><dt className="text-slate-500">Atualizado</dt><dd className="font-bold text-slate-100">{formatDate(active?.updatedAt)}</dd></div>
          </dl>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-cyan-200 disabled:opacity-50" onClick={onStartLogin} type="button" disabled={busy || loginStatus?.running}>
              Login Codex CLI
            </button>
            {loginStatus?.running && (
              <button className="rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-2 text-sm font-black text-rose-100 hover:bg-rose-400/15 disabled:opacity-50" onClick={onCancelLogin} type="button" disabled={busy}>
                Cancelar
              </button>
            )}
          </div>
          {/* Login ao vivo expandido */}
          {loginStatus?.loginUrl && (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-slate-500">Rodando: </span><span className="font-bold text-slate-100">{boolLabel(Boolean(loginStatus?.running))}</span></div>
                <div><span className="text-slate-500">Exit code: </span><span className="font-bold text-slate-100">{loginStatus?.exitCode ?? '-'}</span></div>
                <div><span className="text-slate-500">User code: </span><span className="font-bold text-cyan-100">{loginStatus?.userCode || '-'}</span></div>
                <div><span className="text-slate-500">Auth: </span><span className="font-bold text-slate-100">{boolLabel(Boolean(loginStatus?.authExists))}</span></div>
              </div>
              <a className="mt-2 block truncate rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-300/15" href={loginStatus.loginUrl} target="_blank" rel="noreferrer">
                Abrir URL de login
              </a>
              {(loginStatus?.outputTail || loginStatus?.error) && (
                <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-slate-950/70 p-2 text-xs text-slate-300">{loginStatus.error || loginStatus.outputTail}</pre>
              )}
            </div>
          )}
        </div>

        {/* Gemini CLI */}
        <div className="rounded-2xl border border-violet-300/20 bg-violet-400/10 p-4 shadow-lg shadow-violet-950/20">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200/70">Gemini</p>
              <h3 className="mt-1 text-lg font-black text-white">Login OAuth</h3>
              <p className="mt-1 text-sm text-violet-100/75">Provider <span className="font-mono">limites-gemini</span></p>
            </div>
            <StatusBadge status={geminiBadgeStatus} label={geminiBadgeLabel} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs text-slate-500">E-mail ativo</p><p className="text-sm font-bold text-slate-100">{geminiLoginStatus?.activeEmail || '-'}</p></div>
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs text-slate-500">Exit code</p><p className="text-sm font-bold text-slate-100">{geminiLoginStatus?.exitCode ?? '-'}</p></div>
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs text-slate-500">Refresh token</p><p className="text-sm font-bold text-slate-100">{boolLabel(Boolean(geminiLoginStatus?.hasRefreshToken))}</p></div>
            <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs text-slate-500">Expira em</p><p className="text-sm font-bold text-slate-100">{formatDate(geminiLoginStatus?.oauthExpiresAt)}</p></div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button className="rounded-xl bg-violet-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-violet-200 disabled:opacity-50" onClick={onStartGeminiLogin} type="button" disabled={busy || geminiLoginStatus?.running}>
              Login Gemini
            </button>
            {geminiLoginStatus?.running && (
              <button className="rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-2 text-sm font-black text-rose-100 hover:bg-rose-400/15 disabled:opacity-50" onClick={onCancelGeminiLogin} type="button" disabled={busy}>
                Cancelar
              </button>
            )}
          </div>
          {geminiLoginStatus?.loginUrl && (
            <a className="mt-3 block truncate rounded-xl border border-violet-300/20 bg-violet-300/10 px-3 py-2 text-sm font-bold text-violet-100 hover:bg-violet-300/15" href={geminiLoginStatus.loginUrl} target="_blank" rel="noreferrer">
              Abrir URL de login
            </a>
          )}
          {(geminiLoginStatus?.running || geminiLoginStatus?.needsCode) && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-white outline-none ring-violet-300/30 transition focus:ring-4"
                value={geminiAuthCode}
                onChange={(event) => onGeminiAuthCodeChange(event.target.value)}
                placeholder="Cole o código de autorização do Google"
              />
              <button className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-emerald-200 disabled:opacity-50" onClick={onSubmitGeminiCode} type="button" disabled={busy || !geminiAuthCode.trim()}>
                Enviar
              </button>
            </div>
          )}
          {(geminiLoginStatus?.outputTail || geminiLoginStatus?.error) && (
            <pre className="mt-3 max-h-32 overflow-auto rounded-xl bg-slate-950/70 p-3 text-xs text-slate-300">{geminiLoginStatus.error || geminiLoginStatus.outputTail}</pre>
          )}
        </div>

        {/* OpenCode Zen */}
        <div className="rounded-2xl border border-amber-300/20 bg-amber-400/[0.04] p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-200/80">OpenCode Zen</p>
              <h3 className="mt-1 text-lg font-black text-white">Relay gratuito</h3>
              <p className="mt-1 text-sm text-amber-100/70">Servidor → deepseek-v4-flash-free, nemotron, big-pickle</p>
            </div>
            <StatusBadge status={openCodeZen?.totalRequests ? 'online' : 'warning'} label={openCodeZen?.totalRequests ? 'Ativo' : 'Inativo'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Req/min" value={String(openCodeZen?.requestsPerMinute ?? 0)} tone="cyan" />
            <MetricCard label="Total de requests" value={formatNumber(openCodeZen?.totalRequests)} tone="default" />
            <MetricCard label="Erros 429" value={String(openCodeZen?.errors429 ?? 0)} tone={(openCodeZen?.errors429 ?? 0) > 0 ? 'warning' : 'good'} />
            <MetricCard label="Último 429" value={openCodeZen?.lastRateLimitAt ? formatDate(openCodeZen.lastRateLimitAt) : '—'} tone={(openCodeZen?.errors429 ?? 0) > 0 ? 'warning' : 'default'} />
          </div>
          {openCodeZen?.sourceStats && Object.keys(openCodeZen.sourceStats).length > 0 && (
            <div className="mt-3 rounded-xl bg-white/[0.04] p-3">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Requisições por máquina</p>
              <div className="space-y-1.5">
                {Object.entries(openCodeZen.sourceStats).map(([ip, stat]) => (
                  <div key={ip} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-amber-100">{stat.machineName}</span>
                    <span className="text-slate-300">{formatNumber(stat.count)} req</span>
                    <span className="text-slate-500">{stat.lastAt ? formatDate(stat.lastAt) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-600">Último request: {openCodeZen?.lastRequestAt ? formatDate(openCodeZen.lastRequestAt) : '—'}</p>
        </div>

        {/* Quota overview — resumo das janelas */}
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 xl:col-span-1">
          <div className="mb-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Consolidado</p>
            <h3 className="mt-1 text-lg font-black text-white">Janelas de uso</h3>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-400">Hermes (OpenAI Codex)</p>
              <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl bg-white/[0.04] p-3">
                  <p className="text-[11px] text-slate-500">Janela principal</p>
                  <p className={`mt-1 text-lg font-black ${limitTone(hermesUsage?.windows.primary?.remainingPercent)}`}>
                    {hermesUsage?.windows.primary ? formatPercent(hermesUsage.windows.primary.remainingPercent) : '--'}
                  </p>
                </div>
                <div className="rounded-xl bg-white/[0.04] p-3">
                  <p className="text-[11px] text-slate-500">Janela semanal</p>
                  <p className={`mt-1 text-lg font-black ${limitTone(hermesUsage?.windows.secondary?.remainingPercent)}`}>
                    {hermesUsage?.windows.secondary ? formatPercent(hermesUsage.windows.secondary.remainingPercent) : '--'}
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-600">Rotação automática troca a credencial quando o limite é atingido.</p>
          </div>
        </div>
      </div>

      {/* Perfis salvos */}
      <SectionCard title="Perfis de conta Codex CLI" subtitle="Contas capturadas da CLI em ~/.codex/auth.json. Ativar um perfil copia a credencial para o pool do Hermes.">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none ring-cyan-300/30 transition focus:ring-4"
            value={newProfileName}
            onChange={(event) => onNewProfileNameChange(event.target.value)}
            placeholder="Nome do perfil, ex: conta-plus-principal"
            disabled={busy}
          />
          <button className="rounded-2xl bg-emerald-300 px-5 py-3 font-black text-slate-950 hover:bg-emerald-200 disabled:opacity-50" onClick={onSaveCurrent} type="button" disabled={busy || !newProfileName.trim()}>
            Salvar conta atual
          </button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {profiles.map((profile) => (
            <article key={profile.slug} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-white">{profile.name}</h3>
                  <p className="text-sm text-slate-400">{profile.emailHint || 'Sem e-mail'} • {profile.planType || '-'}</p>
                </div>
                {profile.isActive && <StatusBadge status="ok" label="Ativa" />}
              </div>
              <p className="text-xs text-slate-500">Slug: {profile.slug}</p>
              <p className="text-xs text-slate-500">Atualizado: {formatDate(profile.updatedAt)}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Disponível agora</p>
                  <p className={`mt-1 text-2xl font-black ${limitTone(profile.usage?.primary?.remainingPercent)}`}>
                    {profile.usage?.ok ? formatPercent(profile.usage.primary?.remainingPercent) : '--'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {profile.usage?.primary ? `Usado: ${formatPercent(profile.usage.primary.usedPercent)}` : 'Sem leitura'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Janela semanal</p>
                  <p className={`mt-1 text-2xl font-black ${limitTone(profile.usage?.secondary?.remainingPercent)}`}>
                    {profile.usage?.ok ? formatPercent(profile.usage.secondary?.remainingPercent) : '--'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {profile.usage?.secondary ? `Usado: ${formatPercent(profile.usage.secondary.usedPercent)}` : 'Sem leitura'}
                  </p>
                </div>
              </div>
              {profile.usage?.primary && (
                <p className="mt-2 text-xs text-slate-500">Reseta em {formatDuration(profile.usage.primary.resetAfterSeconds)} • {profile.usage.allowed ? 'uso permitido' : 'uso bloqueado'}</p>
              )}
              {profile.usage?.error && (
                <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs text-amber-100">{profile.usage.error}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50" onClick={() => onActivate(profile.slug)} type="button" disabled={busy || profile.isActive}>
                  Ativar
                </button>
                <button className="rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-sm font-bold text-rose-100 hover:bg-rose-400/15 disabled:opacity-50" onClick={() => onDelete(profile.slug)} type="button" disabled={busy}>
                  Excluir
                </button>
              </div>
            </article>
          ))}
          {!profiles.length && <p className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-slate-400">Nenhum perfil salvo ainda.</p>}
        </div>
      </SectionCard>

      {/* Rotação automática */}
      <SectionCard title="Rotação automática de credenciais" subtitle="Troca automaticamente a credencial ativa no pool do Hermes (~/.hermes/auth.json) quando a conta atinge o limite.">
        {rotationError && <p className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{rotationError}</p>}
        <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
            <label className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 text-sm font-bold text-slate-100">
              Rotação ativada
              <input type="checkbox" checked={Boolean(rotation?.enabled)} onChange={(event) => onUpdateRotation({ enabled: event.target.checked })} disabled={busy || !rotation} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3 text-sm font-bold text-slate-100">
              Apenas notificar
              <input type="checkbox" checked={Boolean(rotation?.notifyOnly)} onChange={(event) => onUpdateRotation({ notifyOnly: event.target.checked })} disabled={busy || !rotation} />
            </label>
            <label className="block rounded-xl bg-white/[0.04] p-3 text-sm font-bold text-slate-100">
              Limite para trocar (%)
              <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white" type="number" min="1" max="100" step="0.1" value={rotation?.thresholdUsedPercent ?? 99.5} onChange={(event) => onUpdateRotation({ thresholdUsedPercent: Number(event.target.value) })} disabled={busy || !rotation} />
            </label>
            <label className="block rounded-xl bg-white/[0.04] p-3 text-sm font-bold text-slate-100">
              Intervalo (segundos)
              <input className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-white" type="number" min="30" value={rotation?.intervalSeconds ?? 60} onChange={(event) => onUpdateRotation({ intervalSeconds: Number(event.target.value) })} disabled={busy || !rotation} />
            </label>
            <div className="flex flex-wrap gap-2 pt-2">
              <button className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-300/15 disabled:opacity-50" onClick={() => onRunRotation(true)} type="button" disabled={busy || !rotation}>
                Testar rotação
              </button>
              <button className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-sm font-black text-amber-100 hover:bg-amber-400/15 disabled:opacity-50" onClick={() => onRunRotation(false)} type="button" disabled={busy || !rotation}>
                Rodar agora
              </button>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Agendado</p><p className="font-black text-white">{boolLabel(Boolean(rotationStatus?.scheduled))}</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Executando</p><p className="font-black text-white">{boolLabel(Boolean(rotationStatus?.running))}</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Última execução</p><p className="text-sm font-bold text-white">{formatDate(rotationStatus?.lastRunAt)}</p></div>
            </div>
            <h3 className="mb-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">Último resultado</h3>
            <pre className="max-h-52 overflow-auto rounded-xl bg-slate-950/70 p-3 text-xs text-slate-300">{safeJson(rotationStatus?.lastResult)}</pre>
            <h3 className="mb-2 mt-4 text-sm font-black uppercase tracking-[0.16em] text-slate-400">Eventos recentes</h3>
            <div className="max-h-60 space-y-2 overflow-auto">
              {(rotationStatus?.events || []).slice(0, 8).map((event, index) => (
                <pre key={`${index}-${String(event.at || event.type || '')}`} className="rounded-xl bg-white/[0.04] p-3 text-xs text-slate-300">{safeJson(event)}</pre>
              ))}
              {!(rotationStatus?.events || []).length && <p className="text-sm text-slate-500">Nenhum evento registrado.</p>}
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
