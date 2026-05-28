import express from 'express'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'

const app = express()
app.use(express.json({ limit: '2mb' }))
const API_PORT = Number(process.env.LIMITS_PANEL_PORT || 8787)
const SITE_PORT = Number(process.env.LIMITS_PANEL_SITE_PORT || 4173)
const DIST_DIR = path.join(process.cwd(), 'dist')
const MACHINES_CONFIG_FILE = path.join(process.cwd(), 'config', 'machines.json')
const PROJECTS_CONFIG_FILE = path.join(process.cwd(), 'config', 'projects.json')
const ADMIN_SECRET_FILE = path.join(process.cwd(), 'config', 'admin-secret.json')
const AGENTS_DATA_FILE = path.join(process.cwd(), 'data', 'agent-heartbeats.json')
const PANEL_SECRETS_DIR = path.join(process.cwd(), 'config')
const AGENT_SECRET = process.env.LIMITS_PANEL_AGENT_SECRET || ''
const AGENT_HEARTBEAT_TTL_MS = (Number(process.env.LIMITS_PANEL_AGENT_TTL_MS) || 120_000)
const ADMIN_PASSWORD = process.env.LIMITS_PANEL_ADMIN_PASSWORD || readAdminPasswordFromFile()
const ADMIN_SESSION_SECRET = process.env.LIMITS_PANEL_SESSION_SECRET || readAdminSessionSecretFromFile() || crypto.randomBytes(32).toString('hex')

// ─── Safe helpers ────────────────────────────────────────────────

function ensureSecureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(dir, 0o700) } catch {}
}


function readAdminSecretFile() {
  try {
    if (!fs.existsSync(ADMIN_SECRET_FILE)) return null
    return JSON.parse(fs.readFileSync(ADMIN_SECRET_FILE, 'utf8'))
  } catch {
    return null
  }
}

function readAdminPasswordFromFile() {
  const data = readAdminSecretFile()
  return data?.adminPassword || ''
}

function readAdminSessionSecretFromFile() {
  const data = readAdminSecretFile()
  return data?.sessionSecret || ''
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        if (index === -1) return [decodeURIComponent(part), '']
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))]
      }),
  )
}

function shouldUseSecureCookie(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase()
  const host = String(req.headers.host || '')
  return proto === 'https' || host.includes('limites.cursar.space')
}

function setSessionCookie(req, res, token) {
  const secure = shouldUseSecureCookie(req) ? '; Secure' : ''
  res.setHeader('Set-Cookie', `limits_admin=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Path=/api; Max-Age=86400`)
}

function clearSessionCookie(req, res) {
  const secure = shouldUseSecureCookie(req) ? '; Secure' : ''
  res.setHeader('Set-Cookie', `limits_admin=; HttpOnly${secure}; SameSite=Lax; Path=/api; Max-Age=0`)
}

function signSession(timestamp) {
  return crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(String(timestamp)).digest('hex')
}

function createSessionToken() {
  const timestamp = Date.now()
  return `${timestamp}.${signSession(timestamp)}`
}

function safeTimingEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function verifySessionToken(token) {
  if (!token || !token.includes('.')) return false
  const [timestampRaw, signature] = token.split('.', 2)
  const timestamp = Number(timestampRaw)
  if (!Number.isFinite(timestamp)) return false
  if (Date.now() - timestamp > 24 * 60 * 60 * 1000) return false
  return safeTimingEqual(signature, signSession(timestampRaw))
}

function isAdminAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie || '')
  return verifySessionToken(cookies.limits_admin)
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'LIMITS_PANEL_ADMIN_PASSWORD nao configurada no servidor' })
  }
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: 'Login admin necessario' })
  }
  return next()
}

function requireAdminAction(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  if (req.headers['x-admin-action'] !== '1') {
    return res.status(403).json({ error: 'Header x-admin-action obrigatorio' })
  }
  const origin = req.headers.origin
  const host = req.headers['x-forwarded-host'] || req.headers.host
  if (origin && host) {
    try {
      const originHost = new URL(origin).host
      if (originHost !== host) {
        return res.status(403).json({ error: 'Origin invalida' })
      }
    } catch {
      return res.status(403).json({ error: 'Origin invalida' })
    }
  }
  return next()
}

function chmodPrivate(filePath) {
  try { fs.chmodSync(filePath, 0o600) } catch {}
}


function atomicWriteJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  chmodPrivate(filePath)
}

function sanitizeLoginOutput(output) {
  return String(output || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[jwt-redacted]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[token-redacted]')
}

function extractLoginUrl(output) {
  const match = String(output || '').match(/https?:\/\/\S+/)
  return match?.[0]?.replace(/[)\].,]+$/, '') || null
}

function extractUserCode(output) {
  return String(output || '').match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0] || null
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

// ─── Agent heartbeats ─────────────────────────────────────────────

function readAgentHeartbeats() {
  try {
    if (!fs.existsSync(AGENTS_DATA_FILE)) return {}
    return JSON.parse(fs.readFileSync(AGENTS_DATA_FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeAgentHeartbeats(data) {
  try {
    atomicWriteJson(AGENTS_DATA_FILE, data)
  } catch {
    // best effort — heartbeat loss is acceptable
  }
}

function pruneExpiredHeartbeats(heartbeats) {
  const cutoff = Date.now() - AGENT_HEARTBEAT_TTL_MS
  for (const [id, entry] of Object.entries(heartbeats)) {
    if (entry.lastSeenAt && new Date(entry.lastSeenAt).getTime() < cutoff) {
      delete heartbeats[id]
    }
  }
  return heartbeats
}

// ─── Machines config ──────────────────────────────────────────────

function readMachinesConfig() {
  const fallback = [
    { id: 'pc-servidor', name: 'PC servidor', role: 'server', hostname: os.hostname(), notes: 'Servidor local' },
    { id: 'pc-trabalho', name: 'PC trabalho', role: 'work', hostname: null, notes: 'Aguardando agent' },
    { id: 'pc-reserva', name: 'PC reserva', role: 'reserve', hostname: null, notes: 'Aguardando agent' },
  ]
  const config = readJson(MACHINES_CONFIG_FILE)
  return Array.isArray(config) && config.length ? config : fallback
}

function readProjectsConfig() {
  const config = readJson(PROJECTS_CONFIG_FILE)
  return Array.isArray(config) ? config : []
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

function redactEmail(email) {
  if (!email || !email.includes('@')) return email || null
  const [name, domain] = email.split('@')
  return `${name.slice(0, 3)}***@${domain}`
}

function formatReachedType(value) {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const type = value.type || 'rate_limit'
    const details = value.details ? ` (${value.details})` : ''
    return `${type}${details}`
  }
  return String(value)
}

// ─── CPU ─────────────────────────────────────────────────────────

let _cpuPrevTotal = 0n
let _cpuPrevIdle = 0n
let _cpuLastUsage = 0

function calcCpuUsage() {
  const cpus = os.cpus()
  let total = 0n
  let idle = 0n
  for (const cpu of cpus) {
    total += BigInt(cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq)
    idle += BigInt(cpu.times.idle)
  }
  if (_cpuPrevTotal === 0n) {
    _cpuPrevTotal = total
    _cpuPrevIdle = idle
    return 0
  }
  const totalDelta = Number(total - _cpuPrevTotal)
  const idleDelta = Number(idle - _cpuPrevIdle)
  _cpuPrevTotal = total
  _cpuPrevIdle = idle
  if (totalDelta <= 0) return _cpuLastUsage
  _cpuLastUsage = Math.round(((totalDelta - idleDelta) / totalDelta) * 100 * 10) / 10
  return _cpuLastUsage
}

// ─── Temperature ─────────────────────────────────────────────────

function readTemperatures() {
  const zones = fs.readdirSync('/sys/class/thermal')
    .filter(n => n.startsWith('thermal_zone'))
    .map(name => {
      try {
        const type = fs.readFileSync(`/sys/class/thermal/${name}/type`, 'utf8').trim()
        const raw = Number(fs.readFileSync(`/sys/class/thermal/${name}/temp`, 'utf8').trim())
        return { name: type || name, temp: Math.round(raw / 100) / 10 }
      } catch {
        return null
      }
    })
    .filter(Boolean)

  // Also try sensors command for more data
  const sensorsOut = safeExec('sensors -u 2>/dev/null | grep -E "^temp[0-9]+_input" | head -5')
  if (sensorsOut) {
    sensorsOut.split('\n').forEach(line => {
      const val = Number(line.split(':')[1]?.trim())
      if (val && val > 0) zones.push({ name: 'sensor', temp: Math.round(val * 10) / 10 })
    })
  }

  return zones
}

// ─── System metrics (disk / RAM / uptime) ─────────────────────────

function collectPcMetrics() {
  const memTotal = os.totalmem()
  const memFree = os.freemem()
  const memUsed = memTotal - memFree
  const memPercent = Math.round((memUsed / memTotal) * 100)

  const cpus = os.cpus()
  const cpuModel = cpus.length ? cpus[0].model.trim() : 'desconhecido'
  const cpuCores = cpus.length
  const cpuUsage = calcCpuUsage()
  const loadAvg = os.loadavg()

  const disks = []
  const diskInfo = safeExec("df -B1 --output=source,fstype,size,used,avail,pcent,target 2>/dev/null | tail -n +2")
  if (diskInfo) {
    diskInfo.split('\n').forEach(line => {
      if (!line.trim()) return
      // Extract columns from the right (target is the only field with spaces)
      const pcentMatch = line.match(/(\S+)\s+(\/.*)$/)
      if (!pcentMatch) return
      const before = line.slice(0, pcentMatch.index).trim()
      const pcent = pcentMatch[1]
      const mount = pcentMatch[2].trim()
      const cols = before.split(/\s+/)
      if (cols.length < 5) return
      const [device, fsType, size, used, avail] = cols
      // Only real disks (skip tmpfs, overlay, devtmpfs, squashfs, fuse)
      if (!/^(ext[234]|ntfs|fuseblk|btrfs|xfs|zfs|f2fs|vfat|exfat)$/.test(fsType)) return
      // Skip some non-physical mounts
      if (/^\/(proc|sys|dev|run|tmp)\b/.test(mount)) return
      // Skip small EFI/boot partitions
      if (/^\/(boot|boot\/efi)\b/.test(mount)) return
      disks.push({
        device,
        fsType,
        mount,
        sizeGb: +(Number(size) / 1073741824).toFixed(1),
        usedGb: +(Number(used) / 1073741824).toFixed(1),
        freeGb: +(Number(avail) / 1073741824).toFixed(1),
        percent: pcent,
        label: mount === '/' ? 'SSD (sistema)' : mount.includes('HD Backup') ? 'HDD (Backup)' : mount,
      })
    })
  }

  const temps = readTemperatures()
  const temp = temps.length > 0
    ? { max: Math.max(...temps.map(t => t.temp)), sensors: temps }
    : null

  const uptime = os.uptime()

  return {
    cpu: {
      model: cpuModel,
      cores: cpuCores,
      usagePercent: cpuUsage,
      loadAvg: loadAvg.map(v => Math.round(v * 100) / 100),
    },
    memory: {
      totalBytes: memTotal,
      usedBytes: memUsed,
      freeBytes: memFree,
      usedPercent: memPercent,
      // friendly formatting helpers
      totalGb: +(memTotal / 1073741824).toFixed(1),
      usedGb: +(memUsed / 1073741824).toFixed(1),
      freeGb: +(memFree / 1073741824).toFixed(1),
    },
    disks,
    temperature: temp,
    uptime,
  }
}


function readPanelSecretFile(filename) {
  try {
    const filePath = path.join(PANEL_SECRETS_DIR, filename)
    if (!fs.existsSync(filePath)) return ''
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return String(parsed.secret || '').trim()
  } catch {
    return ''
  }
}

function requestBearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
}

function hasMainAgentSecret(req) {
  return Boolean(AGENT_SECRET && safeTimingEqual(requestBearer(req), AGENT_SECRET))
}

function hasGeminiAgentSecret(req) {
  return Boolean(GEMINI_AGENT_SECRET && safeTimingEqual(requestBearer(req), GEMINI_AGENT_SECRET))
}

function requireAgentSecret(req, res, next) {
  if (!AGENT_SECRET && !GEMINI_AGENT_SECRET) {
    return res.status(503).json({ error: 'Nenhum token de agent configurado no servidor' })
  }
  if (!hasMainAgentSecret(req) && !hasGeminiAgentSecret(req)) {
    return res.status(401).json({ error: 'Token de agent invalido' })
  }
  return next()
}


const unavailableSqliteDatabases = new Set()

function querySqlite(dbPath, sql) {
  if (!fs.existsSync(dbPath)) return []
  if (unavailableSqliteDatabases.has(dbPath)) return []
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      return db.prepare(sql).all()
    } finally {
      db.close()
    }
  } catch (error) {
    unavailableSqliteDatabases.add(dbPath)
    console.warn(`[Painel] SQLite local indisponivel (${path.basename(dbPath)}): ${error.message}`)
    return []
  }
}

function readLocalMetrics() {
  const byModel = querySqlite(
    `SELECT model,
            model_provider as provider,
            COUNT(*) as threads,
            COALESCE(SUM(tokens_used), 0) as tokens,
            MAX(updated_at) as last_used
       FROM threads
      WHERE COALESCE(tokens_used, 0) > 0
      GROUP BY model_provider, model
      ORDER BY tokens DESC
      LIMIT 12;`,
  )

  const recentThreads = querySqlite(
    `SELECT title,
            model,
            model_provider as provider,
            cwd,
            tokens_used,
            updated_at
       FROM threads
      ORDER BY updated_at DESC
      LIMIT 12;`,
  )

  const totals = querySqlite(
    `SELECT COUNT(*) as threads,
            COALESCE(SUM(tokens_used), 0) as tokens,
            MAX(updated_at) as last_used
       FROM threads;`,
  )[0] || { threads: 0, tokens: 0, last_used: null }

  return { byModel, recentThreads, totals }
}


function collectMachines() {
  const configs = readMachinesConfig().filter((machine) => !machine.hidden)
  const now = new Date().toISOString()
  const localMetrics = collectPcMetrics()
  const agentHeartbeats = pruneExpiredHeartbeats(readAgentHeartbeats())
  const heartbeatById = new Map(Object.entries(agentHeartbeats))
  const cutoff = Date.now() - AGENT_HEARTBEAT_TTL_MS

  return configs.map((machine) => {
    const isServer = machine.role === 'server' || machine.id === 'pc-servidor'
    const hb = heartbeatById.get(machine.id)
    const hbFresh = hb && hb.lastSeenAt && new Date(hb.lastSeenAt).getTime() > cutoff

    // Server role always uses local metrics
    if (isServer) {
      return {
        id: machine.id,
        name: machine.name,
        role: machine.role || 'other',
        hostname: os.hostname(),
        status: 'online',
        lastSeenAt: now,
        metrics: localMetrics,
        notes: machine.notes || null,
        agent: false,
        agents: machine.agents || null,
      }
    }

    // Agent-powered machine
    if (hbFresh) {
      return {
        id: machine.id,
        name: machine.name,
        role: machine.role || 'other',
        hostname: hb.hostname || machine.hostname || hb.metrics?.hostname || null,
        status: 'online',
        lastSeenAt: hb.lastSeenAt,
        metrics: hb.metrics || null,
        notes: machine.notes || `Agent: ${hb.agentVersion || 'limits-agent'}`,
        agent: true,
        agents: machine.agents || null,
      }
    }

    // Offline / never seen
    return {
      id: machine.id,
      name: machine.name,
      role: machine.role || 'other',
      hostname: machine.hostname || hb?.hostname || null,
      status: hb ? 'offline' : 'offline',
      lastSeenAt: hb?.lastSeenAt || null,
      metrics: null,
      notes: hb ? `${machine.notes || ''} (offline, sem heartbeat há ${Math.round((Date.now() - new Date(hb.lastSeenAt).getTime()) / 1000)}s)`.trim() : machine.notes || null,
      agent: Boolean(hb),
      agents: machine.agents || null,
    }
  })
}

function readPm2Processes() {
  const candidates = [
    'pm2 jlist',
    '/home/server/.nvm/versions/node/v20.20.0/bin/node /home/server/.nvm/versions/node/v20.20.0/lib/node_modules/pm2/bin/pm2 jlist',
    '/home/server/.npm-global/bin/pm2 jlist',
  ]
  for (const command of candidates) {
    const raw = safeExec(command)
    if (!raw) continue
    try { return JSON.parse(raw) } catch {}
  }
  return []
}

async function collectProjects() {
  const configs = readProjectsConfig()
  const pm2Processes = readPm2Processes()
  const now = new Date().toISOString()

  return Promise.all(configs.map(async (project) => {
    let status = 'unknown'

    if (project.kind === 'pm2' && project.pm2Name) {
      const proc = pm2Processes.find((item) => item.name === project.pm2Name)
      status = proc?.pm2_env?.status === 'online' ? 'online' : 'offline'
    }

    if (project.healthUrl) {
      try {
        const response = await fetch(project.healthUrl, { signal: AbortSignal.timeout(3000) })
        status = response.ok ? 'online' : 'offline'
      } catch {
        if (status === 'unknown') status = 'offline'
      }
    }

    return {
      id: project.id,
      name: project.name,
      kind: project.kind || 'manual',
      status,
      port: project.port || null,
      publicUrl: project.publicUrl || null,
      healthUrl: project.healthUrl || null,
      deployTarget: project.deployTarget || null,
      lastCheckedAt: now,
    }
  }))
}

function parseDiskPercent(value) {
  return Number(String(value || '').replace('%', '')) || 0
}

function deriveAlerts({ machines, deepseekPayload, projects }) {
  const now = new Date().toISOString()
  const alerts = []

  for (const machine of machines) {
    if (machine.status !== 'online') {
      alerts.push({
        id: `machine-offline-${machine.id}`,
        severity: 'warning',
        module: 'machines',
        title: `${machine.name} offline`,
        message: 'Máquina sem heartbeat/agent ativo.',
        createdAt: now,
        sourceId: machine.id,
      })
    }

    for (const disk of machine.metrics?.disks || []) {
      const percent = parseDiskPercent(disk.percent)
      if (percent >= 90) {
        alerts.push({
          id: `disk-critical-${machine.id}-${disk.mount}`,
          severity: 'critical',
          module: 'machines',
          title: `Disco quase cheio em ${machine.name}`,
          message: `${disk.label || disk.mount}: ${disk.percent} usado.`,
          createdAt: now,
          sourceId: machine.id,
        })
      } else if (percent >= 80) {
        alerts.push({
          id: `disk-warning-${machine.id}-${disk.mount}`,
          severity: 'warning',
          module: 'machines',
          title: `Disco acima de 80% em ${machine.name}`,
          message: `${disk.label || disk.mount}: ${disk.percent} usado.`,
          createdAt: now,
          sourceId: machine.id,
        })
      }
    }
  }

  const deepseekBalance = Number(deepseekPayload?.balance?.balance_infos?.[0]?.total_balance || 0)
  if (Number.isFinite(deepseekBalance) && deepseekBalance <= 1) {
    alerts.push({
      id: 'deepseek-low-balance',
      severity: deepseekBalance <= 0.1 ? 'critical' : 'warning',
      module: 'ai',
      title: 'Saldo DeepSeek baixo',
      message: `Saldo atual: US$ ${deepseekBalance.toFixed(2)}.`,
      createdAt: now,
      sourceId: 'deepseek',
    })
  }


  for (const project of projects) {
    if (project.status === 'offline') {
      alerts.push({
        id: `project-offline-${project.id}`,
        severity: 'critical',
        module: 'projects',
        title: `${project.name} caiu`,
        message: project.publicUrl ? `URL: ${project.publicUrl}` : 'Serviço marcado como offline.',
        createdAt: now,
        sourceId: project.id,
      })
    }
  }


  return alerts
}


async function buildDashboardOverview() {
  const deepseekSettled = await Promise.allSettled([fetchDeepSeekBalance()])
  const deepseek = deepseekSettled[0].status === 'fulfilled' ? deepseekSettled[0].value : null
  const machines = collectMachines()
  const projects = await collectProjects()
  const alerts = deriveAlerts({ machines, deepseekPayload: deepseek, projects })

  return { ok: true, checkedAt: new Date().toISOString(), machines, ai: { deepseek }, projects, alerts }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, checkedAt: new Date().toISOString() })
})

app.get('/api/pc-metrics', requireAdmin, (_req, res) => {
  try {
    const metrics = collectPcMetrics()
    res.json({ ok: true, checkedAt: new Date().toISOString(), metrics })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

// ─── DeepSeek ──────────────────────────────────────────────────


function readDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  const envPath = path.join(process.cwd(), '.env')
  try {
    if (!fs.existsSync(envPath)) return null
    const raw = fs.readFileSync(envPath, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('DEEPSEEK_API_KEY=')) return trimmed.split('=', 2)[1]?.trim() || null
    }
  } catch {}
  return null
}

async function fetchDeepSeekBalance() {
  const key = readDeepSeekKey()
  if (!key) {
    const err = new Error('DEEPSEEK_API_KEY nao encontrada')
    err.statusCode = 400
    throw err
  }

  const response = await fetch('https://api.deepseek.com/v1/user/balance', {
    headers: { Authorization: `Bearer ${key}` },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Falha ao consultar saldo DeepSeek: HTTP ${response.status} ${text.slice(0, 160)}`)
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    balance: JSON.parse(text),
  }
}

app.get('/api/deepseek', requireAdmin, async (_req, res) => {
  try {
    res.json(await fetchDeepSeekBalance())
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})


app.get('/api/machines', requireAdmin, (_req, res) => {
  try {
    res.json({ ok: true, checkedAt: new Date().toISOString(), machines: collectMachines() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.get('/api/projects', requireAdmin, async (_req, res) => {
  try {
    const projects = await collectProjects()
    res.json({ ok: true, checkedAt: new Date().toISOString(), projects })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.get('/api/alerts', requireAdmin, async (_req, res) => {
  try {
    const dashboard = await buildDashboardOverview()
    res.json({ ok: true, checkedAt: dashboard.checkedAt, alerts: dashboard.alerts })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.get('/api/dashboard', requireAdmin, async (_req, res) => {
  try {
    res.json(await buildDashboardOverview())
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})


app.get('/api/admin/status', (req, res) => {
  res.json({ ok: true, adminConfigured: Boolean(ADMIN_PASSWORD), authenticated: isAdminAuthenticated(req), checkedAt: new Date().toISOString() })
})

app.post('/api/admin/login', (req, res) => {
  try {
    const provided = String(req.body?.password || '')
    if (!ADMIN_PASSWORD || !safeTimingEqual(provided, ADMIN_PASSWORD)) return res.status(401).json({ error: 'Senha admin invalida' })
    setSessionCookie(req, res, createSessionToken())
    res.json({ ok: true, authenticated: true })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/admin/logout', (_req, res) => {
  clearSessionCookie(_req, res)
  res.json({ ok: true, authenticated: false })
})


// ─── Agent heartbeat endpoint ────────────────────────────────────
//
// Receives metrics from limits-agent running on remote machines.
// Auth: Bearer token via LIMITS_PANEL_AGENT_SECRET.
// Se AGENT_SECRET não estiver configurado, o endpoint fica inacessível (503).

app.post('/api/agent/heartbeat', (req, res) => {
  if (!AGENT_SECRET) {
    return res.status(503).json({ error: 'LIMITS_PANEL_AGENT_SECRET nao configurado no servidor' })
  }
  const auth = String(req.headers.authorization || '')
  const provided = auth.replace(/^Bearer\s+/i, '').trim()
  if (!safeTimingEqual(provided, AGENT_SECRET)) {
    return res.status(401).json({ error: 'Token de agent invalido' })
  }

  const { machineId, hostname, metrics, agentVersion } = req.body || {}

  if (!machineId || !metrics) {
    return res.status(400).json({ error: 'machineId e metrics sao obrigatorios' })
  }

  const now = new Date().toISOString()
  const heartbeats = readAgentHeartbeats()
  heartbeats[machineId] = {
    hostname: String(hostname || machineId).slice(0, 128),
    metrics,
    agentVersion: String(agentVersion || 'limits-agent').slice(0, 64),
    lastSeenAt: now,
  }
  writeAgentHeartbeats(heartbeats)

  // Auto-registro: normaliza o machineId e verifica duplicatas (case-insensitive)
  const machines = readMachinesConfig()
  const normalizedId = machineId.toLowerCase().replace(/\s+/g, '-')
  const exists = machines.some((m) => m.id.toLowerCase().replace(/\s+/g, '-') === normalizedId)
  if (!exists) {
    const displayName = machineId
      .replace(/^pc-/, 'PC ')
      .replace(/^notebook-/, 'Notebook ')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    machines.push({
      id: normalizedId,
      name: displayName,
      role: 'work',
      hostname: hostname || null,
      notes: `Registrado automaticamente pelo limits-agent. Edite o nome no painel.`,
    })
    atomicWriteJson(MACHINES_CONFIG_FILE, machines)
    console.log(`[Painel] Novo agent registrado: ${normalizedId} -> ${displayName}`)
  }

  res.json({
    ok: true,
    machineId,
    lastSeenAt: now,
    ttlMs: AGENT_HEARTBEAT_TTL_MS,
  })
})

// ─── Renomear máquina ─────────────────────────────────────────────

app.post('/api/machines/:id/rename', requireAdmin, requireAdminAction, (req, res) => {
  try {
    const machineId = req.params.id
    const newName = String(req.body?.name || '').trim()
    if (!newName) {
      return res.status(400).json({ error: 'Nome obrigatorio' })
    }
    if (newName.length > 100) {
      return res.status(400).json({ error: 'Nome muito longo (max 100 chars)' })
    }

    const machines = readMachinesConfig()
    const target = machines.find((m) => m.id === machineId)
    if (!target) {
      return res.status(404).json({ error: `Maquina ${machineId} nao encontrada` })
    }

    target.name = newName
    atomicWriteJson(MACHINES_CONFIG_FILE, machines)

    res.json({ ok: true, machineId, name: newName, checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

// ─── Error handling middleware ──────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[Painel] Erro nao tratado:', err)
  res.status(500).json({ error: 'Erro interno do servidor', checkedAt: new Date().toISOString() })
})

process.on('uncaughtException', (err) => {
  console.error('[Painel] Uncaught exception — processo continua vivo:', err)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Painel] Unhandled rejection — processo continua vivo:', reason)
})

// ─── Static file server ─────────────────────────────────────────

function startStaticServer() {
  if (!fs.existsSync(DIST_DIR)) {
    console.warn('dist/ nao encontrado. Rode npm run build antes de publicar o painel.')
    return
  }

  const staticApp = express()
  const proxyToApi = (req, res) => {
    const target = `http://127.0.0.1:${API_PORT}${req.originalUrl}`
    const headers = {
      accept: req.headers.accept || 'application/json',
      authorization: req.headers.authorization || '',
      cookie: req.headers.cookie || '',
      'content-type': req.headers['content-type'] || 'application/json',
      'x-admin-action': req.headers['x-admin-action'] || '',
      'x-client-request-id': req.headers['x-client-request-id'] || '',
      'x-request-id': req.headers['x-request-id'] || '',
      origin: req.headers.origin || '',
      host: req.headers.host || '',
      'x-forwarded-host': req.headers.host || '',
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || '',
    }
    fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
    })
      .then(async (apiRes) => {
        res.status(apiRes.status)
        const setCookie = apiRes.headers.get('set-cookie')
        if (setCookie) res.setHeader('Set-Cookie', setCookie)
        const contentType = apiRes.headers.get('content-type') || 'application/json'
        res.setHeader('content-type', contentType)
        if (contentType.includes('text/event-stream')) {
          res.setHeader('Cache-Control', apiRes.headers.get('cache-control') || 'no-cache')
          for await (const chunk of apiRes.body) res.write(chunk)
          return res.end()
        }
        res.send(await apiRes.text())
      })
      .catch((err) => {
        res.status(502).json({ error: `Falha no proxy da API: ${err.message}`, checkedAt: new Date().toISOString() })
      })
  }

  staticApp.use('/api', express.raw({ type: '*/*', limit: '2mb' }), proxyToApi)

  staticApp.use(express.static(DIST_DIR, {
    index: 'index.html',
    maxAge: '1h',
    etag: true,
  }))
  staticApp.get(/.*/, (_req, res) => {
    const filePath = path.join(DIST_DIR, 'index.html')
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath)
    } else {
      res.status(404).send('Pagina nao encontrada')
    }
  })
  staticApp.use((err, _req, res, _next) => {
    console.error('[Painel-http] Erro no servidor estatico:', err)
    res.status(500).send('Erro interno do servidor')
  })
  staticApp.listen(SITE_PORT, '127.0.0.1', () => {
    console.log(`Painel de limites site em http://127.0.0.1:${SITE_PORT}`)
  })
}

// ─── Graceful startup ───────────────────────────────────────────


const server = app.listen(API_PORT, '0.0.0.0', () => {
  console.log(`Painel de limites API em http://127.0.0.1:${API_PORT}`)
  startStaticServer()
})

// PM2 handles restart — just clean up, don't fight it
process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
