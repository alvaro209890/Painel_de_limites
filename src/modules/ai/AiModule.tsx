import { MetricCard } from '../../components/MetricCard'
import { SectionCard } from '../../components/SectionCard'
import { StatusBadge } from '../../components/StatusBadge'
import type { DeepSeekPayload, LimitsPayload, UsageInfo } from '../../types/dashboard'
import { formatDate, formatDuration, formatNumber, formatPercent } from '../../utils/format'

type AiModuleProps = {
  limits: LimitsPayload | null
  deepseek: DeepSeekPayload | null
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

export function AiModule({ limits, deepseek, loading, error }: AiModuleProps) {
  if (loading) return <SectionCard title="IA"><p className="text-slate-400">Carregando provedores...</p></SectionCard>
  if (error) return <SectionCard title="IA"><p className="text-rose-200">{error}</p></SectionCard>

  const dsBalance = deepseek?.balance.balance_infos?.[0]
  const hermesUsage = limits?.hermesCodex?.usage
  const codexCliUsage = limits?.codexCli?.usage

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <LimitWindow title="Hermes OpenAI Codex" usage={hermesUsage} />
      <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400 -mt-3 mb-2 xl:col-span-2 text-center">
        ⚡ Hermes usa o <strong className="text-cyan-200">credential pool OpenAI Codex</strong>; Codex CLI standalone fica separado para login, perfis e rotação
      </div>
      <LimitWindow title="Codex CLI (standalone)" usage={codexCliUsage} />

      <SectionCard title="DeepSeek" subtitle="Saldo e disponibilidade da conta DeepSeek">
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Saldo total" value={dsBalance ? `$ ${dsBalance.total_balance}` : '--'} hint={dsBalance?.currency || 'USD'} tone={Number(dsBalance?.total_balance || 0) <= 1 ? 'warning' : 'good'} />
          <MetricCard label="Crédito pago" value={dsBalance ? `$ ${dsBalance.topped_up_balance}` : '--'} tone="cyan" />
          <MetricCard label="Status" value={deepseek?.balance.is_available ? 'Disponível' : 'Indisponível'} tone={deepseek?.balance.is_available ? 'good' : 'danger'} />
        </div>
        <p className="mt-4 text-xs text-slate-500">Atualizado: {formatDate(deepseek?.checkedAt)}</p>
      </SectionCard>

      <SectionCard title="Gastos por modelo" subtitle="Métricas locais do Codex state SQLite" className="xl:col-span-2">
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <MetricCard label="Threads" value={formatNumber(limits?.local.totals.threads)} tone="cyan" />
          <MetricCard label="Tokens locais" value={formatNumber(limits?.local.totals.tokens)} tone="default" />
          <MetricCard label="Último uso" value={formatDate(limits?.local.totals.last_used)} tone="default" />
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          {(limits?.local.byModel || []).slice(0, 8).map((item) => (
            <div key={`${item.provider}-${item.model}`} className="grid gap-2 border-b border-white/5 p-3 text-sm last:border-0 md:grid-cols-[1fr_auto_auto]">
              <div>
                <p className="font-bold text-slate-100">{item.model}</p>
                <p className="text-xs text-slate-500">{item.provider}</p>
              </div>
              <p className="text-slate-300">{formatNumber(item.threads)} threads</p>
              <p className="font-semibold text-cyan-200">{formatNumber(item.tokens)} tokens</p>
            </div>
          ))}
          {(!limits?.local.byModel?.length) && <p className="p-4 text-sm text-slate-400">Sem métricas locais ainda.</p>}
        </div>
      </SectionCard>
    </div>
  )
}
