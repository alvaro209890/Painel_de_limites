export type PcMetricsPayload = {
  ok: boolean
  checkedAt: string
  metrics: PcMetrics
}

export type PcMetrics = {
  cpu: { model: string; cores: number; usagePercent: number | null; loadAvg: number[] }
  memory: { totalGb: number; usedGb: number; freeGb: number; usedPercent: number }
  disks: Array<{ device: string; mount: string; label: string; sizeGb: number; usedGb: number; freeGb: number; percent: string }>
  temperature: { max: number; sensors: Array<{ name: string; temp: number }> } | null
  uptime: number
}

export type DeepSeekBalanceInfo = {
  is_available: boolean
  balance_infos: Array<{
    currency: string
    total_balance: string
    granted_balance: string
    topped_up_balance: string
  }>
}

export type DeepSeekPayload = {
  ok: boolean
  checkedAt: string
  balance: DeepSeekBalanceInfo
}

export type CliLoginStatus = {
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
  activeEmail?: string | null
  hasRefreshToken?: boolean
  oauthExpiresAt?: string | null
  oauthExpired?: boolean | null
  needsCode?: boolean
  error: string | null
}

export type GeminiLoginStatus = CliLoginStatus

export type MachineStatus = 'online' | 'offline' | 'unknown'

export type AgentInfo = {
  name: string
  description?: string | null
}

export type DashboardMachine = {
  id: string
  name: string
  role: 'server' | 'work' | 'reserve' | 'other'
  status: MachineStatus
  hostname?: string | null
  lastSeenAt: string | null
  metrics: PcMetrics | null
  notes?: string | null
  agent?: boolean
  agents?: AgentInfo[] | null
}

export type ProjectService = {
  id: string
  name: string
  kind: 'pm2' | 'http' | 'manual' | 'systemd'
  status: 'online' | 'offline' | 'unknown'
  port?: number | null
  publicUrl?: string | null
  healthUrl?: string | null
  deployTarget?: string | null
  lastCheckedAt: string | null
  stack?: string
}

export type DashboardAlert = {
  id: string
  severity: 'info' | 'warning' | 'critical'
  module: 'machines' | 'ai' | 'projects'
  title: string
  message: string
  createdAt: string
  sourceId?: string
}

export type DashboardOverviewPayload = {
  ok: boolean
  checkedAt: string
  machines: DashboardMachine[]
  ai: {
    deepseek: DeepSeekPayload | null
    gemini?: {
      exists: boolean
      email: string | null
      hasRefreshToken: boolean
      oauthExpiresAt: string | null
      oauthExpired: boolean | null
    } | null
  }
  projects: ProjectService[]
  alerts: DashboardAlert[]
}

export type MachinesPayload = { ok: boolean; checkedAt: string; machines: DashboardMachine[] }