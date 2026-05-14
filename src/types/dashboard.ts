export type WindowInfo = {
  label: string
  usedPercent: number
  remainingPercent: number
  windowSeconds: number
  resetAfterSeconds: number
  resetAt: string
  elapsedSeconds: number
}

export type UsageInfo = {
  checkedAt: string
  account: { email: string | null; planType: string | null; userId: string | null }
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

export type HermesCodexPayload = {
  ok: boolean
  label: string
  authPath: string
  provider: string
  endpoint: string
  credentialLabel: string | null
  usage?: UsageInfo
  error?: string
  checkedAt?: string
}

export type LimitsPayload = {
  usage: UsageInfo
  hermesCodex?: HermesCodexPayload
  local: {
    totals: { threads: number; tokens: number; last_used: number | null }
    byModel: Array<{ model: string; provider: string; threads: number; tokens: number; last_used: number }>
    recentThreads: Array<{ title: string; model: string; provider: string; cwd: string; tokens_used: number; updated_at: number }>
  }
}

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

export type CodexAdminStatus = {
  ok: boolean
  adminConfigured: boolean
  authenticated: boolean
}

export type CodexProfile = {
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

export type CodexProfilesPayload = {
  ok: boolean
  active: { exists: boolean; email: string | null; planType: string | null; accountIdHint: string | null; updatedAt: string | null }
  profiles: CodexProfile[]
  checkedAt?: string
}

export type CodexLoginStatus = {
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

export type CodexRotationPayload = {
  ok: boolean
  config: {
    enabled: boolean
    intervalSeconds: number
    cooldownSeconds: number
    thresholdUsedPercent: number
    notifyOnly: boolean
    preferredOrder: string[]
    skipSlugs: string[]
    updatedAt?: string | null
  }
  running: boolean
  scheduled: boolean
  lastRunAt: string | null
  lastResult: unknown
  events: Array<Record<string, unknown>>
}

export type MachineStatus = 'online' | 'offline' | 'unknown'

export type DashboardMachine = {
  id: string
  name: string
  role: 'server' | 'work' | 'reserve' | 'other'
  status: MachineStatus
  hostname?: string | null
  lastSeenAt: string | null
  metrics: PcMetrics | null
  notes?: string | null
}

export type ProjectService = {
  id: string
  name: string
  kind: 'pm2' | 'http' | 'manual'
  status: 'online' | 'offline' | 'unknown'
  port?: number | null
  publicUrl?: string | null
  healthUrl?: string | null
  deployTarget?: string | null
  lastCheckedAt: string | null
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
    limits: LimitsPayload | null
    deepseek: DeepSeekPayload | null
  }
  projects: ProjectService[]
  alerts: DashboardAlert[]
}

export type MachinesPayload = { ok: boolean; checkedAt: string; machines: DashboardMachine[] }
