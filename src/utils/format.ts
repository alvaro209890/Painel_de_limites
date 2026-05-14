export const numberFmt = new Intl.NumberFormat('pt-BR')
export const percentFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const days = Math.floor(safe / 86400)
  const hours = Math.floor((safe % 86400) / 3600)
  const minutes = Math.floor((safe % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h ${minutes}min`
  if (hours > 0) return `${hours}h ${minutes}min`
  return `${minutes}min`
}

export function formatDate(value?: string | number | null) {
  if (!value) return 'Sem dados'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
}

export function formatNumber(value?: number | null) {
  return numberFmt.format(Number(value || 0))
}

export function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--'
  return `${percentFmt.format(Number(value))}%`
}
