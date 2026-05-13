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
const CODEX_PROFILES_ROOT = process.env.CODEX_PROFILES_ROOT || path.join(os.homedir(), '.config', 'codex-profiles')
const CODEX_PROFILES_DIR = path.join(CODEX_PROFILES_ROOT, 'profiles')
const CODEX_BACKUPS_DIR = path.join(CODEX_PROFILES_ROOT, 'backups')
const ADMIN_SECRET_FILE = path.join(CODEX_PROFILES_ROOT, 'admin-secret.json')
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

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `limits_admin=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=86400`)
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'limits_admin=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0')
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
  const host = req.headers.host
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

function summarizeCodexAuth(authPath = CODEX_AUTH_PATH) {
  const exists = fs.existsSync(authPath)
  const auth = readJson(authPath)
  if (!auth) return { exists, email: null, accountIdHint: null, updatedAt: exists ? fs.statSync(authPath).mtime.toISOString() : null }
  const tokens = auth.tokens || {}
  const email = auth.email || auth.user?.email || tokens.email || extractEmailFromIdToken(auth) || null
  const accountId = tokens.account_id || auth.account_id || null
  const stat = exists ? fs.statSync(authPath) : null
  return {
    exists: true,
    email: redactEmail(email),
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

// ─── Codex API ────────────────────────────────────────────────────

async function fetchCodexUsage() {
  const auth = readJson(CODEX_AUTH_PATH)
  const tokens = auth.tokens || {}
  const accessToken = tokens.access_token
  const accountId = tokens.account_id

  if (!accessToken) {
    throw new Error('Codex nao esta logado em ~/.codex/auth.json')
  }

  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'ChatGPT-Account-ID': accountId || '',
      Accept: 'application/json',
      'User-Agent': 'Painel-de-limites/1.0',
    },
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Falha ao consultar uso do Codex: HTTP ${response.status} ${text.slice(0, 160)}`)
  }

  return JSON.parse(text)
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

function normalizeUsage(usage) {
  const primary = usage.rate_limit?.primary_window || null
  const secondary = usage.rate_limit?.secondary_window || null
  const now = Math.floor(Date.now() / 1000)

  return {
    checkedAt: new Date().toISOString(),
    account: {
      email: redactEmail(usage.email || extractEmailFromIdToken(readJson(CODEX_AUTH_PATH))),
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, checkedAt: new Date().toISOString() })
})

app.get('/api/limits', async (_req, res) => {
  try {
    const usage = await fetchCodexUsage()
    const local = readLocalMetrics()
    res.json({ usage: normalizeUsage(usage), local })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.get('/api/pc-metrics', (_req, res) => {
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

app.get('/api/deepseek', async (_req, res) => {
  try {
    const key = readDeepSeekKey()
    if (!key) {
      return res.status(400).json({ error: 'DEEPSEEK_API_KEY nao encontrada', checkedAt: new Date().toISOString() })
    }

    const response = await fetch('https://api.deepseek.com/v1/user/balance', {
      headers: { Authorization: `Bearer ${key}` },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Falha ao consultar saldo DeepSeek: HTTP ${response.status} ${text.slice(0, 160)}`)
    }

    const data = JSON.parse(text)
    res.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      balance: data,
    })
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
    setSessionCookie(res, createSessionToken())
    res.json({ ok: true, authenticated: true })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-profiles/logout', requireAdmin, requireAdminAction, (_req, res) => {
  clearSessionCookie(res)
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

const server = app.listen(API_PORT, '127.0.0.1', () => {
  console.log(`Painel de limites API em http://127.0.0.1:${API_PORT}`)
  startStaticServer()
})

// PM2 handles restart — just clean up, don't fight it
process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
