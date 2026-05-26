import { MetricCard } from '../../components/MetricCard'
import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { DeepSeekPayload, LimitsPayload, OpenCodeZenStatus, UsageInfo } from '../../types/dashboard'
import { formatDate, formatDuration, formatNumber, formatPercent } from '../../utils/format'

type AiModuleProps = {
  limits: LimitsPayload | null
  deepseek: DeepSeekPayload | null
  openCodeZen?: OpenCodeZenStatus | null
  loading?: boolean
  error?: string | null
}

function LimitWindow({ usage, title }: { usage?: UsageInfo | null; title: string }) {
  const primary = usage?.windows.primary
  const secondary = usage?.windows.secondary

  return (
    <SectionCard title={title} subtitle={usage?.account.email ? `Conta: ${usage.account.email} • Plano: ${usage.account.planType || '-'}` : 'Sem dados'}>
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge status={usage?.status.allowed ? 'online' : 'warning'} label={usage?.status.allowed ? 'Permitido' : 'Limitado'} />
        {usage?.status.reachedType && <StatusBadge status="warning" label={usage.status.reachedType} />}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <MetricCard label="Janela principal" value={formatPercent(primary?.usedPercent)} hint={primary ? `Reseta em ${formatDuration(primary.resetAfterSeconds)}` : 'Sem dados'} tone={(primary?.usedPercent || 0) >= 95 ? 'danger' : 'cyan'} />
        <MetricCard label="Janela semanal" value={formatPercent(secondary?.usedPercent)} hint={secondary ? `Reseta em ${formatDuration(secondary.resetAfterSeconds)}` : 'Sem dados'} tone={(secondary?.usedPercent || 0) >= 95 ? 'danger' : 'default'} />
      </div>
      <p className="mt-4 text-xs text-slate-500">Atualizado: {formatDate(usage?.checkedAt)}</p>
    </SectionCard>
  )
}

export function AiModule({ limits, deepseek, openCodeZen, loading, error }: AiModuleProps) {
  if (loading) return <SectionCard title="IA"><p className="text-slate-400">Carregando provedores...</p></SectionCard>
  if (error) return <SectionCard title="IA"><p className="text-rose-200">{error}</p></SectionCard>

  const dsBalance = deepseek?.balance.balance_infos?.[0]
  const hermesUsage = limits?.hermesCodex?.usage
  const zen = openCodeZen

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <LimitWindow title="Hermes OpenAI Codex" usage={hermesUsage} />
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400 -mt-3 mb-2 xl:col-span-2 text-center">
        ⚡ Hermes usa o <strong className="text-cyan-200">GPT-5.5 (Codex)</strong> roteado pelo Painel de Limites
      </div>
      
      {zen && (
        <SectionCard title="OpenCode Zen Relay" subtitle="Estatísticas do proxy inteligente de alta performance">
          <div className="grid gap-3 md:grid-cols-2">
            <MetricCard label="RPM" value={zen.requestsPerMinute} hint="requisições / min" tone={zen.requestsPerMinute > 40 ? 'warning' : 'cyan'} />
            <MetricCard label="Total Hoje" value={formatNumber(zen.totalRequests)} tone="default" />
            <MetricCard label="Erros 429" value={zen.errors429} tone={zen.errors429 > 0 ? 'danger' : 'good'} />
            <MetricCard label="Último uso" value={formatDate(zen.lastRequestAt)} tone="default" />
          </div>
        </SectionCard>
      )}

      <SectionCard title="DeepSeek V4" subtitle="Saldo e disponibilidade da API DeepSeek">
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Saldo" value={dsBalance ? `$ ${dsBalance.total_balance}` : '--'} hint={dsBalance?.currency || 'USD'} tone={Number(dsBalance?.total_balance || 0) <= 1 ? 'warning' : 'good'} />
          <MetricCard label="Status" value={deepseek?.balance.is_available ? 'Online' : 'Offline'} tone={deepseek?.balance.is_available ? 'good' : 'danger'} />
          <MetricCard label="Uso Diário" value="-- tokens" hint="em desenvolvimento" tone="default" />
        </div>
      </SectionCard>

      <SectionCard title="Modelos Ativos" subtitle="Inteligências que alimentam os sistemas do Álvaro" className="xl:col-span-2">
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-indigo-500/10 p-3 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300">Raciocínio</p>
            <p className="mt-1 font-bold text-white">GPT-5.5</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-emerald-500/10 p-3 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Performance</p>
            <p className="mt-1 font-bold text-white">DeepSeek V4</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-violet-500/10 p-3 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-300">Contexto</p>
            <p className="mt-1 font-bold text-white">Gemini 3.1 Pro</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-cyan-500/10 p-3 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Coding</p>
            <p className="mt-1 font-bold text-white">Claude 4.6</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <div className="bg-white/[0.03] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Métricas de Consumo Local (Codex)</div>
          {(limits?.local.byModel || []).slice(0, 10).map((item) => (
            <div key={`${item.provider}-${item.model}`} className="grid gap-2 border-b border-white/5 p-3 text-sm last:border-0 md:grid-cols-[1fr_auto_auto]">
              <div>
                <p className="font-bold text-slate-100">{item.model}</p>
                <p className="text-[11px] text-slate-500">{item.provider}</p>
              </div>
              <p className="text-slate-300 font-mono text-xs">{formatNumber(item.threads)} threads</p>
              <p className="font-bold text-cyan-200 font-mono text-xs">{formatNumber(item.tokens)} tokens</p>
            </div>
          ))}
          {(!limits?.local.byModel?.length) && <p className="p-4 text-sm text-slate-400">Sem métricas locais ainda.</p>}
        </div>
      </SectionCard>
    </div>
  )
}
