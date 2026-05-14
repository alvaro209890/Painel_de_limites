import express from 'express'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'

const app = express()
app.use(express.json({ limit: '64kb' }))
const API_PORT = Number(process.env.LIMITS_PANEL_PORT || 8787)
const SITE_PORT = Number(process.env.LIMITS_PANEL_SITE_PORT || 4173)
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH || path.join(os.homedir(), '.codex', 'auth.json')
const CODEX_STATE_PATH = process.env.CODEX_STATE_PATH || path.join(os.homedir(), '.codex', 'state_5.sqlite')
const DIST_DIR = path.join(process.cwd(), 'dist')
const MACHINES_CONFIG_FILE = path.join(process.cwd(), 'config', 'machines.json')
const PROJECTS_CONFIG_FILE = path.join(process.cwd(), 'config', 'projects.json')
const HERMES_AUTH_PATH = process.env.HERMES_AUTH_PATH || path.join(os.homedir(), '.hermes', 'auth.json')
const HERMES_CODEX_PROVIDER_KEY = process.env.HERMES_CODEX_PROVIDER_KEY || 'openai-codex'
const CODEX_PROFILES_ROOT = process.env.CODEX_PROFILES_ROOT || path.join(os.homedir(), '.config', 'codex-profiles')
const CODEX_PROFILES_DIR = path.join(CODEX_PROFILES_ROOT, 'profiles')
const CODEX_BACKUPS_DIR = path.join(CODEX_PROFILES_ROOT, 'backups')
const ADMIN_SECRET_FILE = path.join(CODEX_PROFILES_ROOT, 'admin-secret.json')
const ROTATION_CONFIG_FILE = path.join(CODEX_PROFILES_ROOT, 'rotation-config.json')
const ROTATION_LOG_FILE = path.join(CODEX_PROFILES_ROOT, 'rotation-events.jsonl')
const ADMIN_PASSWORD = process.env.LIMITS_PANEL_ADMIN_PASSWORD || readAdminPasswordFromFile()
const ADMIN_SESSION_SECRET = process.env.LIMITS_PANEL_SESSION_SECRET || readAdminSessionSecretFromFile() || crypto.randomBytes(32).toString('hex')

// ─── Safe helpers ────────────────────────────────────────────────

function ensureSecureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(dir, 0o700) } catch {}
}

function ensureProfileDirs() {
  ensureSecureDir(CODEX_PROFILES_ROOT)
  ensureSecureDir(CODEX_PROFILES_DIR)
  ensureSecureDir(CODEX_BACKUPS_DIR)
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

function slugifyProfileName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `perfil-${Date.now()}`
}

function assertSafeSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(slug || ''))) throw new Error('Slug de perfil invalido')
  return slug
}

function profilePath(slug) {
  return path.join(CODEX_PROFILES_DIR, assertSafeSlug(slug))
}

function chmodPrivate(filePath) {
  try { fs.chmodSync(filePath, 0o600) } catch {}
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function atomicWriteJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  chmodPrivate(filePath)
}

function extractEmailFromIdToken(auth) {
  const idToken = auth?.tokens?.id_token
  if (!idToken || typeof idToken !== 'string') return null
  try {
    const parts = idToken.split('.')
    if (parts.length < 2) return null
    let payload = parts[1]
    payload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = 4 - (payload.length % 4)
    if (padding !== 4) payload += '='.repeat(padding)
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    return decoded.email || null
  } catch {
    return null
  }
}

function extractPlanTypeFromIdToken(auth) {
  const idToken = auth?.tokens?.id_token
  if (!idToken || typeof idToken !== 'string') return null
  try {
    const parts = idToken.split('.')
    if (parts.length < 2) return null
    let payload = parts[1]
    payload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = 4 - (payload.length % 4)
    if (padding !== 4) payload += '='.repeat(padding)
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    return decoded['https://api.openai.com/auth']?.chatgpt_plan_type || null
  } catch {
    return null
  }
}

function summarizeCodexAuth(authPath = CODEX_AUTH_PATH) {
  const exists = fs.existsSync(authPath)
  const auth = readJson(authPath)
  if (!auth) return { exists, email: null, planType: null, accountIdHint: null, updatedAt: exists ? fs.statSync(authPath).mtime.toISOString() : null }
  const tokens = auth.tokens || {}
  const email = auth.email || auth.user?.email || tokens.email || extractEmailFromIdToken(auth) || null
  const accountId = tokens.account_id || auth.account_id || null
  const planType = extractPlanTypeFromIdToken(auth) || null
  const stat = exists ? fs.statSync(authPath) : null
  return {
    exists: true,
    email: redactEmail(email),
    planType,
    accountIdHint: accountId ? `${String(accountId).slice(0, 6)}***${String(accountId).slice(-4)}` : null,
    updatedAt: stat ? stat.mtime.toISOString() : null,
  }
}

function listCodexProfiles() {
  ensureProfileDirs()
  const activeHash = sha256File(CODEX_AUTH_PATH)
  const entries = fs.readdirSync(CODEX_PROFILES_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  const profiles = entries.map((entry) => {
    const slug = entry.name
    const dir = profilePath(slug)
    const authPath = path.join(dir, 'auth.json')
    const metaPath = path.join(dir, 'meta.json')
    const meta = readJson(metaPath) || {}
    const summary = summarizeCodexAuth(authPath)
    const profileHash = sha256File(authPath)
    return {
      slug,
      name: meta.name || slug,
      emailHint: meta.emailHint || summary.email || null,
      planType: summary.planType,
      accountIdHint: meta.accountIdHint || summary.accountIdHint || null,
      createdAt: meta.createdAt || (fs.existsSync(authPath) ? fs.statSync(authPath).birthtime.toISOString() : null),
      updatedAt: meta.updatedAt || summary.updatedAt,
      lastActivatedAt: meta.lastActivatedAt || null,
      isActive: Boolean(activeHash && profileHash && activeHash === profileHash),
    }
  })
  profiles.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
  return { active: summarizeCodexAuth(CODEX_AUTH_PATH), profiles }
}

function saveCurrentCodexProfile(name) {
  ensureProfileDirs()
  if (!fs.existsSync(CODEX_AUTH_PATH)) throw new Error('Conta Codex ativa nao encontrada em ~/.codex/auth.json')
  const slug = slugifyProfileName(name)
  const dir = profilePath(slug)
  ensureSecureDir(dir)
  const targetAuth = path.join(dir, 'auth.json')
  fs.copyFileSync(CODEX_AUTH_PATH, targetAuth)
  chmodPrivate(targetAuth)
  const existingMeta = readJson(path.join(dir, 'meta.json')) || {}
  const summary = summarizeCodexAuth(targetAuth)
  const now = new Date().toISOString()
  const meta = {
    name: String(name || slug).trim() || slug,
    emailHint: summary.email,
    accountIdHint: summary.accountIdHint,
    createdAt: existingMeta.createdAt || now,
    updatedAt: now,
    lastActivatedAt: existingMeta.lastActivatedAt || null,
  }
  atomicWriteJson(path.join(dir, 'meta.json'), meta)
  return { slug, ...meta }
}

function backupActiveCodexAuth() {
  ensureProfileDirs()
  if (!fs.existsSync(CODEX_AUTH_PATH)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const backupPath = path.join(CODEX_BACKUPS_DIR, `auth-${stamp}.json`)
  fs.copyFileSync(CODEX_AUTH_PATH, backupPath)
  chmodPrivate(backupPath)
  return backupPath
}

function activateCodexProfile(slug) {
  ensureProfileDirs()
  const dir = profilePath(slug)
  const sourceAuth = path.join(dir, 'auth.json')
  if (!fs.existsSync(sourceAuth)) throw new Error('auth.json do perfil nao encontrado')
  fs.mkdirSync(path.dirname(CODEX_AUTH_PATH), { recursive: true, mode: 0o700 })
  const backupPath = backupActiveCodexAuth()
  fs.copyFileSync(sourceAuth, CODEX_AUTH_PATH)
  chmodPrivate(CODEX_AUTH_PATH)
  const metaPath = path.join(dir, 'meta.json')
  const meta = readJson(metaPath) || { name: slug }
  meta.lastActivatedAt = new Date().toISOString()
  meta.updatedAt = meta.updatedAt || meta.lastActivatedAt
  atomicWriteJson(metaPath, meta)
  return { slug, backupPath, active: summarizeCodexAuth(CODEX_AUTH_PATH) }
}

function deleteCodexProfile(slug) {
  ensureProfileDirs()
  const dir = profilePath(slug)
  if (!fs.existsSync(dir)) throw new Error('Perfil nao encontrado')
  fs.rmSync(dir, { recursive: true, force: true })
  return { slug }
}

function sanitizeLoginOutput(output) {
  return String(output || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
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

let codexLoginSession = null

function codexLoginStatusPayload() {
  const session = codexLoginSession
  if (!session) {
    return { ok: true, running: false, exitCode: null, loginUrl: null, userCode: null, outputTail: '', authExists: fs.existsSync(CODEX_AUTH_PATH), error: null }
  }
  const outputTail = sanitizeLoginOutput(session.output).slice(-4000)
  return {
    ok: true,
    sessionId: session.id,
    startedAt: session.startedAt,
    command: session.command,
    running: Boolean(session.child && session.exitCode === null && !session.error),
    exitCode: session.exitCode,
    loginUrl: extractLoginUrl(outputTail),
    userCode: extractUserCode(outputTail),
    outputTail,
    authExists: fs.existsSync(CODEX_AUTH_PATH),
    error: session.error,
  }
}

function startCodexLoginProcess() {
  if (codexLoginSession?.child && codexLoginSession.exitCode === null && !codexLoginSession.error) {
    const err = new Error('Ja existe um login Codex em andamento')
    err.statusCode = 409
    throw err
  }
  backupActiveCodexAuth()
  const args = ['login', '--device-auth']
  const child = spawn('codex', args, {
    env: process.env,
    cwd: os.homedir(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    command: `codex ${args.join(' ')}`,
    child,
    output: '',
    exitCode: null,
    error: null,
  }
  codexLoginSession = session
  const append = (chunk) => {
    session.output = `${session.output}${chunk.toString()}`.slice(-12000)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.on('error', (err) => {
    session.error = err.message
    session.child = null
  })
  child.on('close', (code) => {
    session.exitCode = code
    session.child = null
  })
  return codexLoginStatusPayload()
}

function cancelCodexLoginProcess() {
  if (codexLoginSession?.child) {
    codexLoginSession.child.kill('SIGTERM')
    codexLoginSession.error = 'Login cancelado pelo usuario'
    codexLoginSession.child = null
  }
  return codexLoginStatusPayload()
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

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
    return execSync(cmd, { timeout: 3000, encoding: 'utf8' }).trim()
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

function readCpuStat() {
  const stat = fs.readFileSync('/proc/stat', 'utf8')
  const line = stat.split('\n').find(l => l.startsWith('cpu '))
  if (!line) return null
  const parts = line.trim().split(/\s+/).slice(1).map(Number)
  const total = parts.reduce((a, b) => a + b, 0)
  const idle = (parts[3] || 0)
  return { total, idle }
}

function calcCpuUsage() {
  const a = readCpuStat()
  if (!a) return null
  // small busy-wait to sample delta
  const start = Date.now()
  while (Date.now() - start < 150) {
    /* spin — 150ms is enough for a useful delta */
  }
  const b = readCpuStat()
  if (!b) return null
  const totalDelta = b.total - a.total
  const idleDelta = b.idle - a.idle
  if (totalDelta <= 0) return 0
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100 * 10) / 10
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


// ─── Codex auto-rotation ─────────────────────────────────────────

const DEFAULT_ROTATION_CONFIG = {
  enabled: false,
  intervalSeconds: 60,
  cooldownSeconds: 300,
  thresholdUsedPercent: 99.5,
  notifyOnly: false,
  preferredOrder: [],
  skipSlugs: [],
}

let rotationTimer = null
let rotationRunning = false
let rotationLastRunAt = 0
let rotationLastResult = null

function readRotationConfig() {
  ensureProfileDirs()
  const saved = readJson(ROTATION_CONFIG_FILE) || {}
  return {
    ...DEFAULT_ROTATION_CONFIG,
    ...saved,
    intervalSeconds: Math.max(30, Math.min(3600, Number(saved.intervalSeconds || DEFAULT_ROTATION_CONFIG.intervalSeconds))),
    cooldownSeconds: Math.max(60, Math.min(86400, Number(saved.cooldownSeconds || DEFAULT_ROTATION_CONFIG.cooldownSeconds))),
    thresholdUsedPercent: Math.max(50, Math.min(100, Number(saved.thresholdUsedPercent || DEFAULT_ROTATION_CONFIG.thresholdUsedPercent))),
    preferredOrder: Array.isArray(saved.preferredOrder) ? saved.preferredOrder.filter(Boolean).map(String) : [],
    skipSlugs: Array.isArray(saved.skipSlugs) ? saved.skipSlugs.filter(Boolean).map(String) : [],
    updatedAt: saved.updatedAt || null,
  }
}

function writeRotationConfig(config) {
  ensureProfileDirs()
  const current = readRotationConfig()
  const next = {
    ...current,
    ...config,
    intervalSeconds: Math.max(30, Math.min(3600, Number(config.intervalSeconds ?? current.intervalSeconds))),
    cooldownSeconds: Math.max(60, Math.min(86400, Number(config.cooldownSeconds ?? current.cooldownSeconds))),
    thresholdUsedPercent: Math.max(50, Math.min(100, Number(config.thresholdUsedPercent ?? current.thresholdUsedPercent))),
    preferredOrder: Array.isArray(config.preferredOrder) ? config.preferredOrder.filter(Boolean).map(String) : current.preferredOrder,
    skipSlugs: Array.isArray(config.skipSlugs) ? config.skipSlugs.filter(Boolean).map(String) : current.skipSlugs,
    updatedAt: new Date().toISOString(),
  }
  atomicWriteJson(ROTATION_CONFIG_FILE, next)
  scheduleCodexRotation()
  return next
}

function appendRotationEvent(event) {
  ensureProfileDirs()
  const payload = { at: new Date().toISOString(), ...event }
  fs.appendFileSync(ROTATION_LOG_FILE, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
  chmodPrivate(ROTATION_LOG_FILE)
  return payload
}

function readRotationEvents(limit = 30) {
  try {
    if (!fs.existsSync(ROTATION_LOG_FILE)) return []
    return fs.readFileSync(ROTATION_LOG_FILE, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(200, Number(limit) || 30)))
      .map((line) => {
        try { return JSON.parse(line) } catch { return { raw: line } }
      })
      .reverse()
  } catch {
    return []
  }
}

function usageExhaustionReasons(normalized, config = readRotationConfig()) {
  const reasons = []
  const usage = normalized?.usage || normalized
  if (!usage) return ['sem_dados_de_uso']
  if (usage.status?.limitReached) reasons.push(`limite_bloqueado:${usage.status.reachedType || 'rate_limit'}`)
  if (usage.status?.allowed === false) reasons.push('uso_nao_permitido')
  for (const [key, window] of Object.entries(usage.windows || {})) {
    if (!window) continue
    const used = Number(window.usedPercent)
    const remaining = Number(window.remainingPercent)
    if (Number.isFinite(used) && used >= config.thresholdUsedPercent) reasons.push(`${key}_usado_${used}%`)
    if (Number.isFinite(remaining) && remaining <= 0) reasons.push(`${key}_sem_restante`)
  }
  return [...new Set(reasons)]
}

function orderRotationCandidates(profiles, config, activeSlug) {
  const skip = new Set([...(config.skipSlugs || []), activeSlug].filter(Boolean))
  const bySlug = new Map(profiles.map((profile) => [profile.slug, profile]))
  const ordered = []
  for (const slug of config.preferredOrder || []) {
    const profile = bySlug.get(slug)
    if (profile && !skip.has(slug)) ordered.push(profile)
  }
  for (const profile of profiles) {
    if (!skip.has(profile.slug) && !ordered.some((item) => item.slug === profile.slug)) ordered.push(profile)
  }
  return ordered
}

async function checkProfileUsage(profile) {
  const authPath = path.join(profilePath(profile.slug), 'auth.json')
  const raw = await fetchCodexUsage(authPath)
  return normalizeUsage(raw, authPath)
}

async function runCodexRotationOnce({ force = false, dryRun = false, reason = 'manual' } = {}) {
  if (rotationRunning) return { ok: false, skipped: true, reason: 'rotacao_ja_em_execucao', lastResult: rotationLastResult }
  rotationRunning = true
  try {
    const config = readRotationConfig()
    const now = Date.now()
    if (!force && now - rotationLastRunAt < config.cooldownSeconds * 1000) {
      return { ok: true, skipped: true, reason: 'cooldown', nextAllowedAt: new Date(rotationLastRunAt + config.cooldownSeconds * 1000).toISOString() }
    }
    if (codexLoginSession?.child && codexLoginSession.exitCode === null && !codexLoginSession.error) {
      return { ok: true, skipped: true, reason: 'login_codex_em_andamento' }
    }

    const profilesState = listCodexProfiles()
    const activeProfile = profilesState.profiles.find((profile) => profile.isActive) || null
    let activeUsage = null
    let activeReasons = []
    try {
      activeUsage = normalizeUsage(await fetchCodexUsage(CODEX_AUTH_PATH), CODEX_AUTH_PATH)
      activeReasons = usageExhaustionReasons(activeUsage, config)
    } catch (error) {
      activeReasons = [`erro_conta_ativa:${error.message}`]
    }

    if (activeReasons.length === 0 && !force) {
      const result = { ok: true, rotated: false, reason: 'conta_ativa_ainda_tem_limite', active: profilesState.active, checkedAt: new Date().toISOString() }
      rotationLastResult = result
      return result
    }

    const candidates = orderRotationCandidates(profilesState.profiles, config, activeProfile?.slug)
    const checked = []
    for (const candidate of candidates) {
      try {
        const candidateUsage = await checkProfileUsage(candidate)
        const reasons = usageExhaustionReasons(candidateUsage, config)
        checked.push({ slug: candidate.slug, name: candidate.name, emailHint: candidate.emailHint, planType: candidate.planType, available: reasons.length === 0, reasons })
        if (reasons.length === 0) {
          const eventBase = {
            type: dryRun || config.notifyOnly ? 'rotation-dry-run' : 'rotation',
            trigger: reason,
            from: activeProfile ? { slug: activeProfile.slug, name: activeProfile.name, emailHint: activeProfile.emailHint } : profilesState.active,
            to: { slug: candidate.slug, name: candidate.name, emailHint: candidate.emailHint, planType: candidate.planType },
            activeReasons,
            checked,
          }
          if (dryRun || config.notifyOnly) {
            const event = appendRotationEvent({ ...eventBase, note: dryRun ? 'dry_run_sem_ativar' : 'notifyOnly_sem_ativar' })
            const result = { ok: true, rotated: false, dryRun: true, event, checkedAt: new Date().toISOString() }
            rotationLastResult = result
            rotationLastRunAt = now
            return result
          }
          const activation = activateCodexProfile(candidate.slug)
          const event = appendRotationEvent({ ...eventBase, activation: { backupPath: activation.backupPath, active: activation.active } })
          const result = { ok: true, rotated: true, event, checkedAt: new Date().toISOString() }
          rotationLastResult = result
          rotationLastRunAt = now
          return result
        }
      } catch (error) {
        checked.push({ slug: candidate.slug, name: candidate.name, emailHint: candidate.emailHint, available: false, reasons: [`erro:${error.message}`] })
      }
    }

    const event = appendRotationEvent({ type: 'rotation-failed', trigger: reason, from: activeProfile, activeReasons, checked, note: 'nenhum_perfil_disponivel' })
    const result = { ok: false, rotated: false, error: 'Nenhum perfil Codex disponivel para rotacao', event, checkedAt: new Date().toISOString() }
    rotationLastResult = result
    rotationLastRunAt = now
    return result
  } finally {
    rotationRunning = false
  }
}

function scheduleCodexRotation() {
  if (rotationTimer) {
    clearInterval(rotationTimer)
    rotationTimer = null
  }
  const config = readRotationConfig()
  if (!config.enabled) return
  rotationTimer = setInterval(() => {
    runCodexRotationOnce({ reason: 'intervalo_automatico' }).catch((error) => {
      const event = appendRotationEvent({ type: 'rotation-error', error: error.message })
      rotationLastResult = { ok: false, error: error.message, event, checkedAt: new Date().toISOString() }
    })
  }, config.intervalSeconds * 1000)
}

function rotationStatusPayload() {
  const config = readRotationConfig()
  return {
    ok: true,
    config,
    running: rotationRunning,
    scheduled: Boolean(rotationTimer),
    lastRunAt: rotationLastRunAt ? new Date(rotationLastRunAt).toISOString() : null,
    lastResult: rotationLastResult,
    events: readRotationEvents(30),
  }
}

// ─── Codex API ────────────────────────────────────────────────────

async function fetchUsageWithToken({ accessToken, accountId = '', label = 'Codex' }) {
  if (!accessToken) {
    throw new Error(`${label} nao possui access_token salvo`)
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'Painel-de-limites/1.0',
  }
  if (accountId) headers['ChatGPT-Account-ID'] = accountId

  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Falha ao consultar uso do ${label}: HTTP ${response.status} ${text.slice(0, 160)}`)
  }

  return JSON.parse(text)
}

async function fetchCodexUsage(authPath = CODEX_AUTH_PATH) {
  const auth = readJson(authPath)
  const tokens = auth?.tokens || {}
  const accessToken = tokens.access_token
  const accountId = tokens.account_id

  if (!accessToken) {
    throw new Error(`Codex nao esta logado em ${authPath}`)
  }

  return fetchUsageWithToken({ accessToken, accountId, label: 'Codex CLI' })
}

function readHermesCodexCredential() {
  const auth = readJson(HERMES_AUTH_PATH)
  const credentials = auth?.credential_pool?.[HERMES_CODEX_PROVIDER_KEY]
  const credential = Array.isArray(credentials) ? credentials[0] : null
  if (!credential?.access_token) return null
  return credential
}

async function readHermesCodexSnapshot() {
  const source = {
    label: 'Hermes OpenAI Codex',
    authPath: HERMES_AUTH_PATH,
    provider: HERMES_CODEX_PROVIDER_KEY,
    endpoint: 'https://chatgpt.com/backend-api/codex',
  }
  try {
    const credential = readHermesCodexCredential()
    if (!credential) {
      return { ok: false, ...source, credentialLabel: null, error: 'Credencial openai-codex nao encontrada em ~/.hermes/auth.json' }
    }
    const raw = await fetchUsageWithToken({
      accessToken: credential.access_token,
      accountId: credential.account_id || '',
      label: 'Hermes OpenAI Codex',
    })
    return {
      ok: true,
      ...source,
      credentialLabel: credential.label || null,
      usage: normalizeUsage(raw),
    }
  } catch (error) {
    return { ok: false, ...source, credentialLabel: null, error: error.message, checkedAt: new Date().toISOString() }
  }
}

function querySqlite(dbPath, sql) {
  if (!fs.existsSync(dbPath)) return []
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}

function readLocalMetrics() {
  const byModel = querySqlite(
    CODEX_STATE_PATH,
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
    CODEX_STATE_PATH,
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
    CODEX_STATE_PATH,
    `SELECT COUNT(*) as threads,
            COALESCE(SUM(tokens_used), 0) as tokens,
            MAX(updated_at) as last_used
       FROM threads;`,
  )[0] || { threads: 0, tokens: 0, last_used: null }

  return { byModel, recentThreads, totals }
}

function normalizeUsage(usage, authPath = CODEX_AUTH_PATH) {
  const primary = usage.rate_limit?.primary_window || null
  const secondary = usage.rate_limit?.secondary_window || null
  const now = Math.floor(Date.now() / 1000)

  return {
    checkedAt: new Date().toISOString(),
    account: {
      email: redactEmail(usage.email || extractEmailFromIdToken(readJson(authPath))),
      planType: usage.plan_type,
      userId: usage.user_id,
    },
    status: {
      allowed: usage.rate_limit?.allowed ?? false,
      limitReached: usage.rate_limit?.limit_reached ?? false,
      reachedType: formatReachedType(usage.rate_limit_reached_type),
    },
    windows: {
      primary: primary && {
        label: 'Janela principal de 5 horas',
        usedPercent: primary.used_percent,
        remainingPercent: Math.max(0, 100 - primary.used_percent),
        windowSeconds: primary.limit_window_seconds,
        resetAfterSeconds: primary.reset_after_seconds,
        resetAt: new Date(primary.reset_at * 1000).toISOString(),
        elapsedSeconds: Math.max(0, primary.limit_window_seconds - primary.reset_after_seconds),
      },
      secondary: secondary && {
        label: 'Janela secundaria',
        usedPercent: secondary.used_percent,
        remainingPercent: Math.max(0, 100 - secondary.used_percent),
        windowSeconds: secondary.limit_window_seconds,
        resetAfterSeconds: secondary.reset_after_seconds,
        resetAt: new Date(secondary.reset_at * 1000).toISOString(),
        elapsedSeconds: Math.max(0, secondary.limit_window_seconds - secondary.reset_after_seconds),
      },
    },
    credits: usage.credits || null,
    rawAgeSeconds: primary?.reset_at ? Math.max(0, primary.reset_at - now) : null,
  }
}

function collectMachines() {
  const configs = readMachinesConfig()
  const now = new Date().toISOString()
  const localMetrics = collectPcMetrics()

  return configs.map((machine) => {
    const isServer = machine.role === 'server' || machine.id === 'pc-servidor'
    return {
      id: machine.id,
      name: machine.name,
      role: machine.role || 'other',
      hostname: isServer ? os.hostname() : machine.hostname || null,
      status: isServer ? 'online' : 'offline',
      lastSeenAt: isServer ? now : null,
      metrics: isServer ? localMetrics : null,
      notes: machine.notes || null,
    }
  })
}

function readPm2Processes() {
  const raw = safeExec('pm2 jlist')
  if (!raw) return []
  try { return JSON.parse(raw) } catch { return [] }
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

function deriveAlerts({ machines, limitsPayload, deepseekPayload, projects }) {
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

  const primaryUsed = limitsPayload?.usage?.windows?.primary?.usedPercent
  if (typeof primaryUsed === 'number' && primaryUsed >= 95) {
    alerts.push({
      id: 'codex-primary-limit-high',
      severity: primaryUsed >= 99 ? 'critical' : 'warning',
      module: 'ai',
      title: 'Limite principal Codex quase esgotado',
      message: `Uso atual: ${Math.round(primaryUsed)}%.`,
      createdAt: now,
      sourceId: 'codex',
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

async function buildLimitsPayload() {
  const [usage, hermesCodex] = await Promise.all([
    fetchCodexUsage(),
    readHermesCodexSnapshot(),
  ])
  return { usage: normalizeUsage(usage), local: readLocalMetrics(), hermesCodex }
}

async function buildDashboardOverview() {
  const [limitsSettled, deepseekSettled] = await Promise.allSettled([
    buildLimitsPayload(),
    fetchDeepSeekBalance(),
  ])

  const limits = limitsSettled.status === 'fulfilled' ? limitsSettled.value : null
  const deepseek = deepseekSettled.status === 'fulfilled' ? deepseekSettled.value : null
  const machines = collectMachines()
  const projects = await collectProjects()
  const alerts = deriveAlerts({ machines, limitsPayload: limits, deepseekPayload: deepseek, projects })

  return { ok: true, checkedAt: new Date().toISOString(), machines, ai: { limits, deepseek }, projects, alerts }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, checkedAt: new Date().toISOString() })
})

app.get('/api/limits', requireAdmin, async (_req, res) => {
  try {
    res.json(await buildLimitsPayload())
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
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

const HERMES_ENV_PATH = path.join(os.homedir(), '.hermes', '.env')

function readDeepSeekKey() {
  try {
    if (!fs.existsSync(HERMES_ENV_PATH)) return null
    const raw = fs.readFileSync(HERMES_ENV_PATH, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('DEEPSEEK_API_KEY=')) {
        return trimmed.split('=', 2)[1]?.trim() || null
      }
    }
    return process.env.DEEPSEEK_API_KEY || null
  } catch {
    return process.env.DEEPSEEK_API_KEY || null
  }
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


// ─── Codex profiles / admin ──────────────────────────────────────

app.get('/api/codex-profiles/status', (req, res) => {
  res.json({ ok: true, adminConfigured: Boolean(ADMIN_PASSWORD), authenticated: isAdminAuthenticated(req), checkedAt: new Date().toISOString() })
})

app.post('/api/codex-profiles/login', requireAdminAction, (req, res) => {
  try {
    const provided = String(req.body?.password || '')
    if (!ADMIN_PASSWORD || !safeTimingEqual(provided, ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Senha admin invalida' })
    }
    setSessionCookie(req, res, createSessionToken())
    res.json({ ok: true, authenticated: true })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-profiles/logout', requireAdmin, requireAdminAction, (req, res) => {
  clearSessionCookie(req, res)
  res.json({ ok: true, authenticated: false })
})

app.get('/api/codex-profiles', requireAdmin, (_req, res) => {
  try {
    res.json({ ok: true, ...listCodexProfiles(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-profiles/save-current', requireAdmin, requireAdminAction, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'Nome do perfil obrigatorio' })
    const profile = saveCurrentCodexProfile(name)
    res.json({ ok: true, profile, ...listCodexProfiles(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-profiles/:slug/activate', requireAdmin, requireAdminAction, (req, res) => {
  try {
    const result = activateCodexProfile(req.params.slug)
    res.json({ ok: true, result, ...listCodexProfiles(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.delete('/api/codex-profiles/:slug', requireAdmin, requireAdminAction, (req, res) => {
  try {
    const result = deleteCodexProfile(req.params.slug)
    res.json({ ok: true, result, ...listCodexProfiles(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.get('/api/codex-login/status', requireAdmin, (_req, res) => {
  res.json(codexLoginStatusPayload())
})

app.post('/api/codex-login/start', requireAdmin, requireAdminAction, (_req, res) => {
  try {
    res.json(startCodexLoginProcess())
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-login/cancel', requireAdmin, requireAdminAction, (_req, res) => {
  res.json(cancelCodexLoginProcess())
})


app.get('/api/codex-rotation', requireAdmin, (_req, res) => {
  res.json(rotationStatusPayload())
})

app.post('/api/codex-rotation/config', requireAdmin, requireAdminAction, (req, res) => {
  try {
    const config = writeRotationConfig(req.body || {})
    res.json({ ok: true, config, ...rotationStatusPayload(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-rotation/run-once', requireAdmin, requireAdminAction, async (req, res) => {
  try {
    const result = await runCodexRotationOnce({ force: Boolean(req.body?.force), dryRun: Boolean(req.body?.dryRun), reason: req.body?.reason || 'manual' })
    res.json({ ok: true, result, ...rotationStatusPayload(), checkedAt: new Date().toISOString() })
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
  staticApp.use('/api', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const target = `http://127.0.0.1:${API_PORT}${req.originalUrl}`
    const headers = {
      accept: req.headers.accept || 'application/json',
      cookie: req.headers.cookie || '',
      'content-type': req.headers['content-type'] || 'application/json',
      'x-admin-action': req.headers['x-admin-action'] || '',
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
        res.send(await apiRes.text())
      })
      .catch((err) => {
        res.status(502).json({ error: `Falha no proxy da API: ${err.message}`, checkedAt: new Date().toISOString() })
      })
  })

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

scheduleCodexRotation()

const server = app.listen(API_PORT, '127.0.0.1', () => {
  console.log(`Painel de limites API em http://127.0.0.1:${API_PORT}`)
  startStaticServer()
})

// PM2 handles restart — just clean up, don't fight it
process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
