import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { CodexAdminStatus, CodexLoginStatus, CodexProfilesPayload, CodexRotationPayload, HermesCodexPayload } from '../../types/dashboard'
import { formatDate } from '../../utils/format'

type CodexAccountsModuleProps = {
  admin: CodexAdminStatus | null
  profilesData: CodexProfilesPayload | null
  hermesCodex: HermesCodexPayload | null
  loginStatus: CodexLoginStatus | null
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

export function CodexAccountsModule({
  admin,
  profilesData,
  hermesCodex,
  loginStatus,
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
  onUpdateRotation,
  onRunRotation,
  onRefresh,
}: CodexAccountsModuleProps) {
  const active = profilesData?.active
  const hermesUsage = hermesCodex?.usage
  const profiles = profilesData?.profiles || []
  const rotation = rotationStatus?.config

  return (
    <div className="space-y-5">
      <SectionCard
        title="Contas Codex / Hermes"
        subtitle="A conta do Hermes e do Claw (agente secundário) é a mesma — ambos compartilham o credential pool. A conta do Codex CLI fica separada e continua servindo para perfis, login e rotação."
        action={(
          <button className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-black text-cyan-100 hover:bg-cyan-300/15" onClick={onRefresh} type="button" disabled={busy}>
            Atualizar contas
          </button>
        )}
      >
        {error && <p className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-100">{error}</p>}
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4 shadow-lg shadow-cyan-950/20">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Hermes / este assistente</p>
                <h3 className="mt-1 text-lg font-black text-white">Conta que eu uso aqui</h3>
              </div>
              <StatusBadge status={hermesCodex?.ok ? 'online' : 'warning'} label={hermesCodex?.ok ? 'Conectada' : 'Atenção'} />
            </div>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-cyan-100/70">Fonte</dt><dd className="font-bold text-slate-100">~/.hermes/auth.json</dd></div>
              <div><dt className="text-cyan-100/70">Provider</dt><dd className="font-bold text-slate-100">openai-codex</dd></div>
              <div><dt className="text-cyan-100/70">Credencial</dt><dd className="font-bold text-slate-100">{hermesCodex?.credentialLabel || '-'}</dd></div>
              <div><dt className="text-cyan-100/70">E-mail</dt><dd className="font-bold text-slate-100">{hermesUsage?.account.email || 'Sem dados'}</dd></div>
              <div><dt className="text-cyan-100/70">Plano</dt><dd className="font-bold text-slate-100">{hermesUsage?.account.planType || '-'}</dd></div>
              <div><dt className="text-cyan-100/70">Atualizado</dt><dd className="font-bold text-slate-100">{formatDate(hermesUsage?.checkedAt)}</dd></div>
            </dl>
            {hermesCodex?.error && <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm text-amber-100">{hermesCodex.error}</p>}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Codex CLI</p>
                <h3 className="mt-1 text-lg font-black text-white">Conta ativa da CLI</h3>
              </div>
              <StatusBadge status={admin?.authenticated ? 'online' : 'offline'} label={admin?.authenticated ? 'Admin logado' : 'Sem login'} />
            </div>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-slate-500">Fonte</dt><dd className="font-bold text-slate-100">~/.codex/auth.json</dd></div>
              <div><dt className="text-slate-500">Auth existe</dt><dd className="font-bold text-slate-100">{boolLabel(Boolean(active?.exists))}</dd></div>
              <div><dt className="text-slate-500">E-mail</dt><dd className="font-bold text-slate-100">{active?.email || 'Sem dados'}</dd></div>
              <div><dt className="text-slate-500">Plano</dt><dd className="font-bold text-slate-100">{active?.planType || '-'}</dd></div>
              <div><dt className="text-slate-500">Conta</dt><dd className="font-bold text-slate-100">{active?.accountIdHint || '-'}</dd></div>
              <div><dt className="text-slate-500">Atualizado</dt><dd className="font-bold text-slate-100">{formatDate(active?.updatedAt)}</dd></div>
            </dl>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-cyan-200 disabled:opacity-50" onClick={onStartLogin} type="button" disabled={busy || loginStatus?.running}>
                Login Codex CLI
              </button>
              {loginStatus?.running && (
                <button className="rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-2 text-sm font-black text-rose-100 hover:bg-rose-400/15 disabled:opacity-50" onClick={onCancelLogin} type="button" disabled={busy}>
                  Cancelar login
                </button>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <h3 className="text-lg font-black text-white">Login Codex pelo navegador</h3>
            <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-slate-500">Rodando</p><p className="font-bold text-slate-100">{boolLabel(Boolean(loginStatus?.running))}</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-slate-500">Exit code</p><p className="font-bold text-slate-100">{loginStatus?.exitCode ?? '-'}</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-slate-500">User code</p><p className="font-bold text-cyan-100">{loginStatus?.userCode || '-'}</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-slate-500">Auth detectado</p><p className="font-bold text-slate-100">{boolLabel(Boolean(loginStatus?.authExists))}</p></div>
            </div>
            {loginStatus?.loginUrl && (
              <a className="mt-3 block truncate rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-300/15" href={loginStatus.loginUrl} target="_blank" rel="noreferrer">
                Abrir URL de login: {loginStatus.loginUrl}
              </a>
            )}
            {(loginStatus?.outputTail || loginStatus?.error) && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-slate-950/70 p-3 text-xs text-slate-300">{loginStatus.error || loginStatus.outputTail}</pre>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Perfis salvos do Codex CLI" subtitle="Perfis capturados da CLI em ~/.codex/auth.json. Ao ativar um perfil, a credencial é copiada para o credential pool do Hermes (~/.hermes/auth.json), que é a conta que o Codex usa como subagente.">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none ring-cyan-300/30 transition focus:ring-4"
            value={newProfileName}
            onChange={(event) => onNewProfileNameChange(event.target.value)}
            placeholder="Nome do perfil, ex: conta-plus-principal"
            disabled={busy}
          />
          <button className="rounded-2xl bg-emerald-300 px-5 py-3 font-black text-slate-950 hover:bg-emerald-200 disabled:opacity-50" onClick={onSaveCurrent} type="button" disabled={busy || !newProfileName.trim()}>
            Salvar conta CLI atual
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

      <SectionCard title="Rotação automática Codex CLI" subtitle="Troca automaticamente a credencial no Hermes credential pool (~/.hermes/auth.json) quando a conta ativa atinge o limite. A rotação não altera o ~/.codex/auth.json (Codex CLI standalone).">
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
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Scheduled</p><p className="font-black text-white">{boolLabel(Boolean(rotationStatus?.scheduled))}</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Running</p><p className="font-black text-white">{boolLabel(Boolean(rotationStatus?.running))}</p></div>
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
