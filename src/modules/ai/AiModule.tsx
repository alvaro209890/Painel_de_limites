import { MetricCard } from '../../components/MetricCard'
import { SectionCard } from '../../components/SectionCard'
import type { DeepSeekPayload } from '../../types/dashboard'

type AiModuleProps = {
  deepseek: DeepSeekPayload | null
  loading?: boolean
  error?: string | null
}

export function AiModule({ deepseek, loading, error }: AiModuleProps) {
  if (loading) return <SectionCard title="IA"><p className="text-slate-400">Carregando provedores...</p></SectionCard>
  if (error) return <SectionCard title="IA"><p className="text-rose-200">{error}</p></SectionCard>

  const dsBalance = deepseek?.balance.balance_infos?.[0]

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <SectionCard title="DeepSeek V4" subtitle="Saldo e disponibilidade da API DeepSeek">
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Saldo" value={dsBalance ? `$ ${dsBalance.total_balance}` : '--'} hint={dsBalance?.currency || 'USD'} tone={Number(dsBalance?.total_balance || 0) <= 1 ? 'warning' : 'good'} />
          <MetricCard label="Status" value={deepseek?.balance.is_available ? 'Online' : 'Offline'} tone={deepseek?.balance.is_available ? 'good' : 'danger'} />
          <MetricCard label="Uso Diário" value="-- tokens" hint="em desenvolvimento" tone="default" />
        </div>
      </SectionCard>

      <SectionCard title="Modelos Ativos" subtitle="Inteligências que alimentam os sistemas do Álvaro" className="xl:col-span-2">
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-emerald-500/10 p-3 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Performance</p>
            <p className="mt-1 font-bold text-white">DeepSeek V4</p>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
