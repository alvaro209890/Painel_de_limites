import express from 'express'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import Database from 'better-sqlite3'
import {
  buildCodexResponsesPayload,
  buildGeminiPrompt,
  canonicalModelId,
  chatCompletionChunk,
  chatCompletionPayload,
  isGeminiModel,
  openAIModelsPayload,
} from './gateway-utils.mjs'

const app = express()
app.use(express.json({ limit: '2mb' }))
const API_PORT = Number(process.env.LIMITS_PANEL_PORT || 8787)
const SITE_PORT = Number(process.env.LIMITS_PANEL_SITE_PORT || 4173)
const CODEX_DEFAULT_AUTH = path.join(os.homedir(), '.codex', 'auth.json')
const CODEX_HOME_AUTH = process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'auth.json') : null
// Prefere CODEX_HOME/auth.json se existir e for mais recente (o CLI 0.130+ escreve la)
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH || (
  CODEX_HOME_AUTH && fs.existsSync(CODEX_HOME_AUTH) &&
  fs.statSync(CODEX_HOME_AUTH).mtime > fs.statSync(CODEX_DEFAULT_AUTH).mtime
    ? CODEX_HOME_AUTH
    : CODEX_DEFAULT_AUTH
)
const CODEX_STATE_PATH = process.env.CODEX_STATE_PATH || path.join(os.homedir(), '.codex', 'state_5.sqlite')
const GEMINI_DIR = path.join(os.homedir(), '.gemini')
const GEMINI_OAUTH_PATH = path.join(GEMINI_DIR, 'oauth_creds.json')
const GEMINI_ACCOUNTS_PATH = path.join(GEMINI_DIR, 'google_accounts.json')
const GEMINI_SETTINGS_PATH = path.join(GEMINI_DIR, 'settings.json')
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
const AGENT_SECRET = process.env.LIMITS_PANEL_AGENT_SECRET || ''
const GEMINI_AGENT_SECRET = process.env.LIMITS_PANEL_GEMINI_AGENT_SECRET || readPanelSecretFile('gemini-agent-secret.json') || ''
const AGENTS_DATA_FILE = process.env.LIMITS_PANEL_AGENTS_FILE || path.join(CODEX_PROFILES_ROOT, 'agents-heartbeats.json')
const AGENT_HEARTBEAT_TTL_MS = (Number(process.env.LIMITS_PANEL_AGENT_TTL_MS) || 120_000)
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

/** Decodifica o payload (parte do meio) de um JWT com segurança. */
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    let payload = parts[1]
    payload = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padding = 4 - (payload.length % 4)
    if (padding !== 4) payload += '='.repeat(padding)
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

/** Extrai email de qualquer JWT disponível no auth (id_token ou access_token). */
function extractEmailFromTokens(auth) {
  const decodedId = decodeJwtPayload(auth?.tokens?.id_token)
  if (decodedId?.email) return decodedId.email
  const decodedAt = decodeJwtPayload(auth?.tokens?.access_token)
  if (decodedAt?.['https://api.openai.com/profile']?.email) return decodedAt['https://api.openai.com/profile'].email
  return null
}

/** Extrai plan_type de qualquer JWT disponível no auth. */
function extractPlanTypeFromTokens(auth) {
  const decodedId = decodeJwtPayload(auth?.tokens?.id_token)
  if (decodedId?.['https://api.openai.com/auth']?.chatgpt_plan_type) return decodedId['https://api.openai.com/auth'].chatgpt_plan_type
  const decodedAt = decodeJwtPayload(auth?.tokens?.access_token)
  if (decodedAt?.['https://api.openai.com/auth']?.chatgpt_plan_type) return decodedAt['https://api.openai.com/auth'].chatgpt_plan_type
  return null
}

/** Extrai o chatgpt_account_id (UUID real da conta) de qualquer JWT disponível. */
function extractChatgptAccountId(auth) {
  const decodedId = decodeJwtPayload(auth?.tokens?.id_token)
  if (decodedId?.['https://api.openai.com/auth']?.chatgpt_account_id) return decodedId['https://api.openai.com/auth'].chatgpt_account_id
  const decodedAt = decodeJwtPayload(auth?.tokens?.access_token)
  if (decodedAt?.['https://api.openai.com/auth']?.chatgpt_account_id) return decodedAt['https://api.openai.com/auth'].chatgpt_account_id
  return null
}

function summarizeCodexAuth(authPath = CODEX_AUTH_PATH) {
  const exists = fs.existsSync(authPath)
  const auth = readJson(authPath)
  if (!auth) return { exists, email: null, planType: null, accountIdHint: null, updatedAt: exists ? fs.statSync(authPath).mtime.toISOString() : null }
  const tokens = auth.tokens || {}
  const email = auth.email || auth.user?.email || tokens.email || extractEmailFromTokens(auth) || null
  const accountId = tokens.account_id || auth.account_id || extractChatgptAccountId(auth) || null
  const planType = extractPlanTypeFromTokens(auth) || null
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
  const activeCredential = readHermesCodexCredential()
  const activeAccountId = activeCredential?.account_id || null
  const activeLabel = activeCredential?.label || null
  const entries = fs.readdirSync(CODEX_PROFILES_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  const profiles = entries.map((entry) => {
    const slug = entry.name
    const dir = profilePath(slug)
    const authPath = path.join(dir, 'auth.json')
    const metaPath = path.join(dir, 'meta.json')
    const meta = readJson(metaPath) || {}
    const summary = summarizeCodexAuth(authPath)
    const profileAuth = readJson(authPath)
    const profileAccountId = profileAuth?.tokens?.account_id || null
    const chatgptAccountId = extractChatgptAccountId(profileAuth)
    const profileMatchId = chatgptAccountId || profileAccountId
    const activeMatchId = extractChatgptAccountId({ tokens: { access_token: activeCredential?.access_token } }) || activeAccountId
    // Match exato pelo slug no label do Hermes (quem foi ativado por ultimo)
    const activeLabelSlug = activeLabel?.replace(/^perfil:/, '') || null
    const isActive = Boolean(
      (activeLabelSlug && activeLabelSlug === slug)
      || (activeMatchId && profileMatchId && activeMatchId === profileMatchId),
    )
    return {
      slug,
      name: meta.name || slug,
      emailHint: meta.emailHint || summary.email || null,
      planType: summary.planType,
      accountIdHint: meta.accountIdHint || summary.accountIdHint || null,
      createdAt: meta.createdAt || (fs.existsSync(authPath) ? fs.statSync(authPath).birthtime.toISOString() : null),
      updatedAt: meta.updatedAt || summary.updatedAt,
      lastActivatedAt: meta.lastActivatedAt || null,
      isActive,
    }
  })
  profiles.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'))
  // active mostra a conta do ~/.codex/auth.json atual (o que a CLI está usando agora)
  const active = summarizeCodexAuth()
  return { active, profiles }
}

function profileUsageSummary(usage) {
  return {
    ok: true,
    allowed: usage.status?.allowed ?? null,
    limitReached: usage.status?.limitReached ?? null,
    reachedType: usage.status?.reachedType || null,
    primary: usage.windows?.primary || null,
    secondary: usage.windows?.secondary || null,
    checkedAt: usage.checkedAt,
  }
}

async function listCodexProfilesWithUsage() {
  const state = listCodexProfiles()
  const profiles = []
  for (const profile of state.profiles) {
    try {
      const usage = await checkProfileUsage(profile)
      profiles.push({ ...profile, usage: profileUsageSummary(usage) })
    } catch (error) {
      profiles.push({
        ...profile,
        usage: {
          ok: false,
          allowed: null,
          limitReached: null,
          reachedType: null,
          primary: null,
          secondary: null,
          checkedAt: new Date().toISOString(),
          error: error.message,
        },
      })
    }
  }
  return { ...state, profiles }
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

async function validateCodexProfileCredential({ slug, accessToken, accountId }) {
  await fetchUsageWithToken({
    accessToken,
    accountId: accountId || '',
    label: `perfil:${slug}`,
  })
}

async function activateCodexProfile(slug, { validate = true } = {}) {
  ensureProfileDirs()
  const dir = profilePath(slug)
  const sourceAuth = path.join(dir, 'auth.json')
  if (!fs.existsSync(sourceAuth)) throw new Error('auth.json do perfil nao encontrado')
  const profileAuth = readJson(sourceAuth)
  const tokens = profileAuth?.tokens || {}
  const accessToken = tokens.access_token
  const refreshToken = tokens.refresh_token
  const accountId = tokens.account_id
  if (!accessToken) throw new Error(`Perfil "${slug}" nao possui access_token`)
  if (validate) await validateCodexProfileCredential({ slug, accessToken, accountId })

  // Atualiza o credential pool do Hermes (conta que o Codex usa como subagente)
  const credential = updateHermesCodexCredential({
    accessToken,
    refreshToken,
    accountId,
    label: `perfil:${slug}`,
  })

  // Backup do auth antigo do Hermes
  const backupPath = path.join(CODEX_BACKUPS_DIR, `hermes-auth-${slug}-${Date.now()}.json`)
  try { fs.copyFileSync(HERMES_AUTH_PATH, backupPath); chmodPrivate(backupPath) } catch {}

  // Atualiza metadado do perfil
  const metaPath = path.join(dir, 'meta.json')
  const meta = readJson(metaPath) || { name: slug }
  meta.lastActivatedAt = new Date().toISOString()
  meta.updatedAt = meta.updatedAt || meta.lastActivatedAt
  atomicWriteJson(metaPath, meta)

  return { slug, backupPath, active: summarizeHermesCodexCredential(credential) }
}

function markHermesCodexCredentialError({ code = 'provider_error', reason = 'provider_error', message = '' } = {}) {
  const auth = readJson(HERMES_AUTH_PATH)
  const pool = auth?.credential_pool?.[HERMES_CODEX_PROVIDER_KEY]
  if (!Array.isArray(pool) || !pool[0]) return null
  pool[0].last_status = 'error'
  pool[0].last_status_at = new Date().toISOString()
  pool[0].last_error_code = code
  pool[0].last_error_reason = reason
  pool[0].last_error_message = String(message || '').slice(0, 300)
  auth.updated_at = new Date().toISOString()
  atomicWriteJson(HERMES_AUTH_PATH, auth)
  return pool[0]
}

function providerErrorReason(error) {
  if (error?.httpStatus === 401) return 'token_invalidated'
  if (error?.httpStatus === 429) return 'rate_limited'
  if (error?.httpStatus === 403) return 'forbidden'
  return 'provider_error'
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

function geminiCliPathEnv() {
  const candidates = [
    '/home/server/.nvm/versions/node/v20.20.0/bin',
    '/home/server/.nvm/versions/node/v22.22.2/bin',
    path.join(os.homedir(), '.npm-global', 'bin'),
  ]
  const current = process.env.PATH || '/usr/bin:/bin'
  return [...candidates.filter((dir) => fs.existsSync(dir)), current].join(':')
}

function buildGeminiCliEnv(homeDir, options = {}) {
  const env = {
    ...process.env,
    HOME: homeDir,
    PATH: geminiCliPathEnv(),
    TERM: process.env.TERM || 'xterm-256color',
    NO_COLOR: '1',
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
  }
  if (options.noBrowser) env.NO_BROWSER = 'true'
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA', 'GOOGLE_CLOUD_PROJECT']) delete env[key]
  return env
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
  // Remove CODEX_HOME do ambiente para que o CLI escreva no ~/.codex/ padrao
  const spawnEnv = { ...process.env }
  delete spawnEnv['CODEX_HOME']
  // Garante que o PATH inclua npm-global e nvm bin (PM2/sshd tem PATH curto)
  const nvmNodeBin = '/home/server/.nvm/versions/node/v20.20.0/bin'
  const npmGlobalBin = '/home/server/.npm-global/bin'
  const extraPath = [npmGlobalBin, nvmNodeBin].filter(p => !spawnEnv.PATH?.includes(p)).join(':')
  if (extraPath) spawnEnv.PATH = `${extraPath}:${spawnEnv.PATH || '/usr/bin:/bin'}`
  const child = spawn('codex', args, {
    env: spawnEnv,
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

function ensureGeminiSettingsForOAuth(baseDir) {
  const geminiDir = path.join(baseDir, '.gemini')
  const settingsPath = path.join(geminiDir, 'settings.json')
  ensureSecureDir(geminiDir)
  const current = readJson(settingsPath) || {}
  current.security = current.security || {}
  current.security.auth = current.security.auth || {}
  current.security.auth.selectedType = 'oauth-personal'
  current.security.folderTrust = current.security.folderTrust || { enabled: false }
  atomicWriteJson(settingsPath, current)
}

function backupGeminiCliAuth() {
  ensureSecureDir(CODEX_BACKUPS_DIR)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(CODEX_BACKUPS_DIR, 'gemini-cli-auth-${stamp}')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const file of [GEMINI_OAUTH_PATH, GEMINI_ACCOUNTS_PATH, GEMINI_SETTINGS_PATH]) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, path.basename(file)))
  }
  return dir
}

function readGeminiAccountEmail() {
  const accounts = readJson(GEMINI_ACCOUNTS_PATH)
  return accounts?.active || null
}

function readGeminiOAuthSummary() {
  const oauth = readJson(GEMINI_OAUTH_PATH)
  const expiryMs = Number(oauth?.expiry_date || 0)
  return {
    authExists: fs.existsSync(GEMINI_OAUTH_PATH),
    hasRefreshToken: Boolean(oauth?.refresh_token),
    oauthExpiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
    oauthExpired: expiryMs ? expiryMs <= Date.now() : null,
  }
}

let geminiLoginSession = null

function geminiLoginStatusPayload() {
  const session = geminiLoginSession
  const oauth = readGeminiOAuthSummary()
  const activeEmail = readGeminiAccountEmail()
  if (!session) {
    return { ok: true, running: false, exitCode: null, loginUrl: null, userCode: null, outputTail: '', ...oauth, activeEmail, needsCode: false, error: null }
  }
  const outputTail = sanitizeLoginOutput(session.output).slice(-4000)
  const rawOutput = session.output.slice(-2000)
  const url = session.loginUrl || extractLoginUrl(outputTail)
  return {
    ok: true,
    sessionId: session.id,
    startedAt: session.startedAt,
    command: session.command,
    running: Boolean(session.child && session.exitCode === null && !session.error),
    exitCode: session.exitCode,
    loginUrl: url,
    userCode: extractUserCode(outputTail),
    outputTail,
    ...oauth,
    activeEmail,
    needsCode: /Enter the authorization code/i.test(rawOutput),
    error: session.error,
  }
}

function startGeminiLoginProcess() {
  if (geminiLoginSession?.child && geminiLoginSession.exitCode === null && !geminiLoginSession.error) {
    const err = new Error('Ja existe um login Gemini em andamento')
    err.statusCode = 409
    throw err
  }
  const loginHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-cli-login-'))
  ensureGeminiSettingsForOAuth(loginHome)
  const spawnEnv = buildGeminiCliEnv(loginHome, { noBrowser: true })
  const geminiCommand = 'gemini -p "Login Gemini CLI concluido. Responda somente: OK" --model gemini-2.5-flash --output-format json --skip-trust'
  const scriptArgs = ['-q', '-c', geminiCommand, '/dev/null']
  const child = spawn('script', scriptArgs, {
    env: spawnEnv,
    cwd: loginHome,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const session = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    command: `NO_BROWSER=true script ${scriptArgs.join(' ')}`,
    loginHome,
    backupPath: null,
    child,
    output: '',
    loginUrl: null,
    exitCode: null,
    error: null,
  }
  geminiLoginSession = session
  const append = (chunk) => {
    const text = chunk.toString()
    session.output = `${session.output}${text}`.slice(-12000)
    // Capture OAuth URL from Gemini output
    if (/Enter the authorization code/i.test(text) && !session.loginUrl) {
      const urlMatch = sanitizeLoginOutput(session.output).match(/https?:\/\/accounts\.google\.com[^\s,\)]+/)
      if (urlMatch) session.loginUrl = urlMatch[0].replace(/[)\]]+$/, '')
    }
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
    const tmpGeminiDir = path.join(loginHome, '.gemini')
    const tmpOauth = path.join(tmpGeminiDir, 'oauth_creds.json')
    try {
      if (fs.existsSync(tmpOauth)) {
        session.backupPath = backupGeminiCliAuth()
        ensureSecureDir(GEMINI_DIR)
        for (const name of ['oauth_creds.json', 'google_accounts.json', 'settings.json']) {
          const src = path.join(tmpGeminiDir, name)
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(GEMINI_DIR, name))
        }
        if (code !== 0 && !session.error) {
          session.error = 'Credenciais Gemini salvas, mas o smoke test da CLI terminou com codigo ' + code
        }
      }
    } catch (error) {
      session.error = 'Login Gemini concluido, mas falhou ao salvar credenciais: ' + error.message
    }
    try { fs.rmSync(loginHome, { recursive: true, force: true }) } catch {}
  })
  return geminiLoginStatusPayload()
}

function submitGeminiLoginCode(code) {
  const clean = String(code || '').trim()
  if (!clean) {
    const err = new Error('Informe o codigo de autorizacao do Google')
    err.statusCode = 400
    throw err
  }
  if (!geminiLoginSession?.child || geminiLoginSession.exitCode !== null || geminiLoginSession.error) {
    const err = new Error('Nao ha login Gemini aguardando codigo')
    err.statusCode = 409
    throw err
  }
  try {
    geminiLoginSession.child.stdin.write(`${clean}\n`)
  } catch (err) {
    const e = new Error('Falhou ao enviar codigo: ' + err.message)
    e.statusCode = 500
    throw e
  }
  return geminiLoginStatusPayload()
}

function cancelGeminiLoginProcess() {
  if (geminiLoginSession?.child) {
    geminiLoginSession.child.kill('SIGTERM')
    geminiLoginSession.error = 'Login Gemini cancelado pelo usuario'
    geminiLoginSession.child = null
  }
  return geminiLoginStatusPayload()
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

// ─── OpenCode Zen Relay state ───────────────────────────────────
// Machine name map for OpenCode Zen relay source tracking
const ZEN_MACHINE_MAP = {
  '100.102.202.63': 'Acer',
  '100.65.138.58': 'servidor',
  '127.0.0.1': 'servidor (local)',
  '::1': 'servidor (local)',
}

const ACER_PROXY_URL = process.env.ACER_PROXY_URL || 'http://100.102.202.63:8788'
const FALLBACK_COOLDOWN_MS = parseInt(process.env.FALLBACK_COOLDOWN_MS || '300000', 10) // 5 min
const ACER_PROBE_INTERVAL_MS = 30000 // 30s

let openCodeZenState = {
  totalRequests: 0,
  errors429: 0,
  lastRateLimitAt: null,
  lastRequestAt: null,
  requestsWindow: [],
  sourceStats: {}, // { ip: { count, lastAt, machineName } }

  // Fallback state
  fallbackActive: false,       // true = usando proxy do Acer
  fallbackIp: null,            // IP de saida atual (servidor ou Acer)
  fallbackAt: null,            // quando o fallback foi ativado
  fallbackAttempts: 0,         // quantas vezes ativou fallback
  fallbackRecoveries: 0,       // quantas vezes voltou ao normal
  acerProxyOnline: false,      // se o proxy do Acer esta respondendo
  _lastAcerProbeAt: 0,
}

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

const MAX_ROTATION_EVENTS = 200

function appendRotationEvent(event) {
  ensureProfileDirs()
  const payload = { at: new Date().toISOString(), ...event }
  fs.appendFileSync(ROTATION_LOG_FILE, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
  chmodPrivate(ROTATION_LOG_FILE)
  // Poda o arquivo se ultrapassou o limite
  trimRotationLog()
  return payload
}

function trimRotationLog() {
  try {
    if (!fs.existsSync(ROTATION_LOG_FILE)) return
    const content = fs.readFileSync(ROTATION_LOG_FILE, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    if (lines.length <= MAX_ROTATION_EVENTS) return
    const keep = lines.slice(-MAX_ROTATION_EVENTS)
    fs.writeFileSync(ROTATION_LOG_FILE, keep.join('\n') + '\n', { mode: 0o600 })
  } catch {
    // falha silenciosa na poda
  }
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
    const activeCredential = readHermesCodexCredential()
    let activeUsage = null
    let activeReasons = []
    try {
      if (activeCredential?.access_token) {
        activeUsage = normalizeUsage(await fetchUsageWithToken({
          accessToken: activeCredential.access_token,
          accountId: activeCredential.account_id || '',
          label: 'Hermes OpenAI Codex',
        }))
      } else {
        activeReasons = ['sem_credencial_ativa_no_hermes']
      }
      activeReasons = usageExhaustionReasons(activeUsage, config)
    } catch (error) {
      activeReasons = [`erro_conta_ativa:${error.message}`]
    }

    if (activeReasons.length === 0 && !force) {
      const result = { ok: true, rotated: false, reason: 'conta_ativa_ainda_tem_limite', active: profilesState.active, checkedAt: new Date().toISOString() }
      rotationLastResult = result
      return result
    }

    const activeProfileSlug = profilesState.profiles.find((profile) => profile.isActive)?.slug || null
    const candidates = orderRotationCandidates(profilesState.profiles, config, activeProfileSlug)
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
            from: profilesState.active,
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
          const activation = await activateCodexProfile(candidate.slug, { validate: false })
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

    const event = appendRotationEvent({ type: 'rotation-failed', trigger: reason, from: profilesState.active, activeReasons, checked, note: 'nenhum_perfil_disponivel' })
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

// ─── LLM routing for local automations ─────────────────────────────

const LLM_ROUTING_DEFAULTS = {
  primary: {
    provider: 'openai-codex',
    model: 'gpt-5.5',
    reasoningEffort: 'medium',
    label: 'GPT-5.5 Medium via Hermes OpenAI Codex',
  },
  fallback: {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    reasoningEffort: 'medium',
    label: 'DeepSeek v4 Pro fallback',
  },
}

function readPanelSecretFile(filename) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(CODEX_PROFILES_ROOT, filename), 'utf8'))
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

async function llmRoutePayload({ task = 'local-automation' } = {}) {
  const config = readRotationConfig()
  const routes = []
  const diagnostics = { task, checkedAt: new Date().toISOString(), primaryAvailable: false, rotation: null, reasons: [] }

  try {
    const credential = readHermesCodexCredential()
    if (!credential?.access_token) {
      diagnostics.reasons.push('sem_credencial_openai_codex')
    } else {
      const usage = normalizeUsage(await fetchUsageWithToken({
        accessToken: credential.access_token,
        accountId: credential.account_id || '',
        label: 'Hermes OpenAI Codex',
      }))
      diagnostics.reasons = usageExhaustionReasons(usage, config)
      diagnostics.primaryAvailable = diagnostics.reasons.length === 0
      diagnostics.credentialLabel = credential.label || null
      diagnostics.usage = {
        allowed: usage.status?.allowed,
        limitReached: usage.status?.limitReached,
        windows: usage.windows || {},
      }
    }
  } catch (error) {
    markHermesCodexCredentialError({ code: `HTTP_${error.httpStatus || 'ERR'}`, reason: providerErrorReason(error), message: error.message })
    diagnostics.reasons.push(`erro_openai_codex:${error.message}`)
  }

  if (!diagnostics.primaryAvailable && config.enabled) {
    try {
      diagnostics.rotation = await runCodexRotationOnce({ reason: `llm_route:${task}` })
      const credential = readHermesCodexCredential()
      if (credential?.access_token) {
        const usage = normalizeUsage(await fetchUsageWithToken({
          accessToken: credential.access_token,
          accountId: credential.account_id || '',
          label: 'Hermes OpenAI Codex',
        }))
        const reasons = usageExhaustionReasons(usage, config)
        diagnostics.reasons = reasons
        diagnostics.primaryAvailable = reasons.length === 0
        diagnostics.credentialLabel = credential.label || null
      }
    } catch (error) {
      diagnostics.rotation = { ok: false, error: error.message }
    }
  }

  if (diagnostics.primaryAvailable) routes.push({ ...LLM_ROUTING_DEFAULTS.primary, role: 'primary' })
  routes.push({ ...LLM_ROUTING_DEFAULTS.fallback, role: diagnostics.primaryAvailable ? 'fallback' : 'primary-fallback' })

  return {
    ok: true,
    policy: 'gpt-5.5-medium-via-limits-panel-with-deepseek-v4-pro-fallback',
    routes,
    diagnostics,
  }
}

// ─── OpenAI-compatible gateway for OpenCode ──────────────────────

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

function codexCloudflareHeaders(credential) {
  const headers = {
    Authorization: `Bearer ${credential.access_token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': 'codex_cli_rs/0.0.0 (Painel de Limites)',
    originator: 'codex_cli_rs',
  }
  if (credential.account_id) headers['ChatGPT-Account-ID'] = credential.account_id
  return headers
}

function writeOpenAISse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function writeOpenAISseDone(res) {
  res.write('data: [DONE]\n\n')
}

function parseSseFrame(frame) {
  const event = { type: 'message', data: '' }
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event.type = line.slice(6).trim()
    if (line.startsWith('data:')) event.data += `${line.slice(5).trim()}\n`
  }
  event.data = event.data.trim()
  if (!event.data || event.data === '[DONE]') return null
  try { event.json = JSON.parse(event.data) } catch {}
  return event
}

function statusFromUpstreamError(status) {
  if (status === 401 || status === 403 || status === 429) return status
  return status >= 400 ? 502 : status
}

async function ensureCodexCredentialForGateway() {
  const config = readRotationConfig()
  let credential = readHermesCodexCredential()
  if (!credential?.access_token) throw new Error('Nenhuma credencial Hermes OpenAI Codex ativa')

  try {
    const usage = normalizeUsage(await fetchUsageWithToken({
      accessToken: credential.access_token,
      accountId: credential.account_id || '',
      label: 'Hermes OpenAI Codex',
    }))
    if (usageExhaustionReasons(usage, config).length === 0) return credential
  } catch (error) {
    markHermesCodexCredentialError({ code: `HTTP_${error.httpStatus || 'ERR'}`, reason: providerErrorReason(error), message: error.message })
  }

  if (config.enabled) {
    await runCodexRotationOnce({ reason: 'openai_gateway' })
    credential = readHermesCodexCredential()
  }
  if (!credential?.access_token) throw new Error('Nenhuma credencial Hermes OpenAI Codex ativa apos rotacao')
  return credential
}


function parseGeminiCliJson(stdout) {
  const text = String(stdout || '').trim()
  if (!text) throw new Error('Gemini CLI nao retornou stdout')
  try { return JSON.parse(text) } catch {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1))
  throw new Error(`Resposta nao-JSON do Gemini CLI: ${text.slice(0, 200)}`)
}

function runGeminiCli({ model, prompt }) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(process.env.LIMITS_PANEL_GEMINI_TIMEOUT_MS || 300_000)
    const child = spawn('gemini', [
      '-p', prompt,
      '--model', model,
      '--output-format', 'json',
      '--skip-trust',
    ], {
      cwd: os.homedir(),
      env: buildGeminiCliEnv(os.homedir(), { noBrowser: true }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const cap = Number(process.env.LIMITS_PANEL_GEMINI_OUTPUT_CAP || 2_000_000)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Gemini CLI excedeu timeout de ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { if (stdout.length < cap) stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { if (stderr.length < cap) stderr += chunk.toString() })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`Gemini CLI saiu com codigo ${code}: ${stderr.slice(0, 500)}`))
      try {
        const parsed = parseGeminiCliJson(stdout)
        resolve(String(parsed.response || '').trim())
      } catch (error) {
        reject(error)
      }
    })
  })
}

async function proxyGeminiCliAsOpenAIChat(req, res) {
  if (!hasGeminiAgentSecret(req)) {
    return res.status(403).json({ error: { message: 'Modelo Gemini restrito ao token local do OpenCode deste PC', type: 'forbidden_model' } })
  }
  const wantsStream = req.body?.stream !== false
  const requestId = `chatcmpl-gemini-${crypto.randomBytes(10).toString('hex')}`
  const model = canonicalModelId(req.body?.model || 'gemini-2.5-flash')
  const prompt = buildGeminiPrompt(req.body?.messages || []) || 'Responda de forma objetiva.'

  let content
  try {
    content = await runGeminiCli({ model, prompt })
  } catch (error) {
    return res.status(502).json({ error: { message: `Falha no Gemini CLI: ${error.message}`, type: 'gemini_cli_error' } })
  }

  if (wantsStream) {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    writeOpenAISse(res, chatCompletionChunk({ id: requestId, model, delta: { role: 'assistant' } }))
    writeOpenAISse(res, chatCompletionChunk({ id: requestId, model, delta: { content } }))
    writeOpenAISse(res, chatCompletionChunk({ id: requestId, model, delta: {}, finishReason: 'stop' }))
    writeOpenAISseDone(res)
    return res.end()
  }

  return res.json(chatCompletionPayload({ id: requestId, model, content, finishReason: 'stop' }))
}

async function proxyCodexAsOpenAIChat(req, res) {
  const wantsStream = req.body?.stream !== false
  const requestId = `chatcmpl-limites-${crypto.randomBytes(10).toString('hex')}`
  const model = String(req.body?.model || 'gpt-5.5').split('/').pop() || 'gpt-5.5'
  const sessionId = String(req.headers['x-request-id'] || req.headers['x-client-request-id'] || requestId)

  let credential
  try {
    credential = await ensureCodexCredentialForGateway()
  } catch (error) {
    return res.status(503).json({ error: { message: error.message, type: 'limits_gateway_error' } })
  }

  const upstreamPayload = buildCodexResponsesPayload(req.body || {}, sessionId)
  let upstream
  try {
    upstream = await fetch(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: codexCloudflareHeaders(credential),
      body: JSON.stringify(upstreamPayload),
      signal: AbortSignal.timeout(Number(process.env.LIMITS_PANEL_OPENAI_TIMEOUT_MS || 300_000)),
    })
  } catch (error) {
    return res.status(502).json({ error: { message: `Falha ao chamar Codex upstream: ${error.message}`, type: 'upstream_transport_error' } })
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    if (upstream.status === 401 || upstream.status === 403) {
      markHermesCodexCredentialError({ code: `HTTP_${upstream.status}`, reason: 'gateway_upstream_auth_error', message: text.slice(0, 300) })
    }
    return res.status(statusFromUpstreamError(upstream.status)).json({
      error: { message: text.slice(0, 1000) || `Codex upstream HTTP ${upstream.status}`, type: 'upstream_error' },
    })
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const toolCalls = []
  let finishReason = 'stop'
  let started = false

  if (wantsStream) {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    writeOpenAISse(res, chatCompletionChunk({ id: requestId, model, delta: { role: 'assistant' } }))
  }

  const emitContent = (delta) => {
    if (!delta) return
    content += delta
    if (wantsStream) writeOpenAISse(res, chatCompletionChunk({ id: requestId, model, delta: { content: delta } }))
  }
  const emitToolCall = (item) => {
    const name = item?.name
    if (!name) return
    const id = item.call_id || item.id || `call_${toolCalls.length}`
    const toolCall = { id, type: 'function', function: { name, arguments: item.arguments || '{}' } }
    toolCalls.push(toolCall)
    finishReason = 'tool_calls'
    if (wantsStream) {
      writeOpenAISse(res, chatCompletionChunk({
        id: requestId,
        model,
        delta: { tool_calls: [{ index: toolCalls.length - 1, ...toolCall }] },
      }))
    }
  }

  const handleEvent = (event) => {
    const data = event?.json
    if (!data) return
    if (data.type === 'response.output_text.delta') emitContent(data.delta || '')
    if (data.type === 'response.output_item.done' && data.item?.type === 'function_call') emitToolCall(data.item)
    if (data.type === 'response.failed') throw new Error(data.response?.error?.message || 'Codex upstream falhou')
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''
      for (const frame of frames) {
        const event = parseSseFrame(frame)
        if (event) {
          started = true
          handleEvent(event)
        }
      }
    }
    if (buffer.trim()) {
      const event = parseSseFrame(buffer)
      if (event) handleEvent(event)
    }
  } catch (error) {
    if (wantsStream) {
      writeOpenAISse(res, { error: { message: error.message, type: 'upstream_stream_error' } })
      writeOpenAISseDone(res)
      return res.end()
    }
    return res.status(started ? 502 : 500).json({ error: { message: error.message, type: 'upstream_stream_error' } })
  }

  if (wantsStream) {
    writeOpenAISse(res, chatCompletionChunk({ id: requestId, model, delta: {}, finishReason }))
    writeOpenAISseDone(res)
    return res.end()
  }

  return res.json(chatCompletionPayload({ id: requestId, model, content, toolCalls, finishReason }))
}

app.get('/v1/models', requireAgentSecret, (req, res) => {
  res.json(openAIModelsPayload({ includeGemini: hasGeminiAgentSecret(req) }))
})

app.post('/v1/chat/completions', requireAgentSecret, async (req, res) => {
  if (isGeminiModel(req.body?.model)) return proxyGeminiCliAsOpenAIChat(req, res)
  return proxyCodexAsOpenAIChat(req, res)
})

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

  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers,
    signal: AbortSignal.timeout(10_000),
  })

  const text = await response.text()
  if (!response.ok) {
    const error = new Error(`Falha ao consultar uso do ${label}: HTTP ${response.status} ${text.slice(0, 160)}`)
    error.httpStatus = response.status
    error.responseBody = text.slice(0, 300)
    throw error
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

function updateHermesCodexCredential({ accessToken, refreshToken, accountId, label = null }) {
  const auth = readJson(HERMES_AUTH_PATH)
  if (!auth) throw new Error('~/.hermes/auth.json nao encontrado')
  if (!auth.credential_pool) auth.credential_pool = {}
  if (!Array.isArray(auth.credential_pool[HERMES_CODEX_PROVIDER_KEY])) {
    auth.credential_pool[HERMES_CODEX_PROVIDER_KEY] = []
  }
  const pool = auth.credential_pool[HERMES_CODEX_PROVIDER_KEY]
  if (pool.length === 0) {
    pool.push({
      id: crypto.randomBytes(3).toString('hex'),
      label: label || `codex-rotated-${Date.now()}`,
      auth_type: 'oauth',
      priority: 0,
      source: 'manual:panel_rotation',
      access_token: accessToken,
      refresh_token: refreshToken || null,
      account_id: accountId || null,
      last_status: 'ok',
      last_status_at: new Date().toISOString(),
      last_error_code: null,
      last_error_reason: null,
      last_error_message: null,
      last_error_reset_at: null,
      base_url: 'https://chatgpt.com/backend-api/codex',
      request_count: 0,
    })
  } else {
    pool[0].access_token = accessToken
    if (refreshToken) pool[0].refresh_token = refreshToken
    if (accountId) pool[0].account_id = accountId
    if (label) pool[0].label = label
    pool[0].last_status = 'ok'
    pool[0].last_status_at = new Date().toISOString()
    pool[0].last_error_code = null
    pool[0].last_error_reason = null
    pool[0].last_error_message = null
    pool[0].last_error_reset_at = null
    pool[0].source = 'manual:panel_rotation'
  }
  auth.updated_at = new Date().toISOString()
  atomicWriteJson(HERMES_AUTH_PATH, auth)
  return readHermesCodexCredential()
}

function summarizeHermesCodexCredential(credential) {
  if (!credential) return { exists: false, email: null, planType: null, accountIdHint: null, updatedAt: null }
  const accountId = credential.account_id || null
  const email = extractEmailFromTokens({ tokens: { id_token: credential.id_token, access_token: credential.access_token } }) || null
  const planType = extractPlanTypeFromTokens({ tokens: { id_token: credential.id_token, access_token: credential.access_token } }) || null
  return {
    exists: true,
    email: redactEmail(email),
    planType,
    accountIdHint: accountId ? `${String(accountId).slice(0, 6)}***${String(accountId).slice(-4)}` : null,
    updatedAt: credential.last_status_at || null,
  }
}

async function readHermesCodexSnapshot() {
  let credential = null
  const source = {
    label: 'Hermes OpenAI Codex',
    authPath: HERMES_AUTH_PATH,
    provider: HERMES_CODEX_PROVIDER_KEY,
    endpoint: 'https://chatgpt.com/backend-api/codex',
  }
  try {
    credential = readHermesCodexCredential()
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
    if (credential) markHermesCodexCredentialError({ code: `HTTP_${error.httpStatus || 'ERR'}`, reason: providerErrorReason(error), message: error.message })
    return { ok: false, ...source, credentialLabel: credential?.label || null, error: error.message, checkedAt: new Date().toISOString() }
  }
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
  const normalizeWindow = (window, label) => {
    if (!window) return null
    const usedPercent = Number(window.used_percent ?? window.usedPercent)
    const windowSeconds = Number(window.limit_window_seconds ?? window.windowSeconds)
    const resetAfterSeconds = Number(window.reset_after_seconds ?? window.resetAfterSeconds)
    const resetAtSeconds = Number(window.reset_at ?? (window.resetAt ? Date.parse(window.resetAt) / 1000 : 0))
    if (!Number.isFinite(usedPercent)) return null
    return {
      label,
      usedPercent,
      remainingPercent: Math.max(0, 100 - usedPercent),
      windowSeconds: Number.isFinite(windowSeconds) ? windowSeconds : 0,
      resetAfterSeconds: Number.isFinite(resetAfterSeconds) ? resetAfterSeconds : 0,
      resetAt: Number.isFinite(resetAtSeconds) && resetAtSeconds > 0 ? new Date(resetAtSeconds * 1000).toISOString() : null,
      elapsedSeconds: Number.isFinite(windowSeconds) && Number.isFinite(resetAfterSeconds)
        ? Math.max(0, windowSeconds - resetAfterSeconds)
        : 0,
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    account: {
      email: redactEmail(usage.email || extractEmailFromTokens(readJson(authPath))),
      planType: usage.plan_type,
      userId: usage.user_id,
    },
    status: {
      allowed: usage.rate_limit?.allowed ?? false,
      limitReached: usage.rate_limit?.limit_reached ?? false,
      reachedType: formatReachedType(usage.rate_limit_reached_type),
    },
    windows: {
      primary: normalizeWindow(primary, 'Janela principal de 5 horas'),
      secondary: normalizeWindow(secondary, 'Janela semanal'),
    },
    credits: usage.credits || null,
    rawAgeSeconds: primary?.reset_at ? Math.max(0, primary.reset_at - now) : null,
  }
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

  const zenStatus = getOpenCodeZenStatus()
  if (zenStatus.lastRateLimitAt) {
    const msSince = Date.now() - new Date(zenStatus.lastRateLimitAt).getTime()
    if (msSince < 5 * 60 * 1000) {
      alerts.push({
        id: 'opencode-zen-rate-limit',
        severity: 'warning',
        module: 'ai',
        title: 'OpenCode Zen rate limit ativo',
        message: `Último 429 há ${Math.round(msSince / 1000)}s. Relay via servidor pode estar bloqueado.`,
        createdAt: now,
        sourceId: 'opencode-zen',
      })
    }
  }

  return alerts
}

async function buildLimitsPayload() {
  const hermesCredential = readHermesCodexCredential()
  let hermesUsage = null
  let hermesError = null
  if (hermesCredential?.access_token) {
    try {
      hermesUsage = normalizeUsage(await fetchUsageWithToken({
        accessToken: hermesCredential.access_token,
        accountId: hermesCredential.account_id || '',
        label: 'Hermes OpenAI Codex',
      }))
    } catch (error) {
      hermesError = error.message
      markHermesCodexCredentialError({ code: `HTTP_${error.httpStatus || 'ERR'}`, reason: providerErrorReason(error), message: error.message })
    }
  }

  // Tenta pegar o usage do Codex CLI standalone também para comparação, mas não falha se não existir
  let codexCliUsage = null
  let codexCliError = null
  try {
    codexCliUsage = normalizeUsage(await fetchCodexUsage(), CODEX_AUTH_PATH)
  } catch (error) {
    codexCliError = error.message
  }

  return {
    usage: hermesUsage || codexCliUsage,
    hermesCodex: hermesCredential ? {
      ok: Boolean(hermesUsage),
      usage: hermesUsage,
      credentialLabel: hermesCredential.label || null,
      ...(hermesError ? { error: hermesError } : {}),
    } : { ok: false, error: 'Sem credencial Hermes OpenAI Codex' },
    codexCli: codexCliUsage ? { ok: true, usage: codexCliUsage } : { ok: false, error: codexCliError || 'Codex CLI nao esta logado' },
    local: readLocalMetrics(),
  }
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

  return { ok: true, checkedAt: new Date().toISOString(), machines, ai: { limits, deepseek, openCodeZen: await getOpenCodeZenStatus() }, projects, alerts }
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

// ─── OpenCode Zen Relay ──────────────────────────────────────────

function trackOpenCodeZenRequest(req) {
  const now = Date.now()
  openCodeZenState.totalRequests++
  openCodeZenState.lastRequestAt = new Date(now).toISOString()
  openCodeZenState.requestsWindow.push(now)
  openCodeZenState.requestsWindow = openCodeZenState.requestsWindow.filter(t => now - t <= 60_000)
  // Track per-source stats
  if (req) {
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()
    if (ip) {
      if (!openCodeZenState.sourceStats[ip]) {
        openCodeZenState.sourceStats[ip] = { count: 0, lastAt: null, machineName: ZEN_MACHINE_MAP[ip] || ip }
      }
      openCodeZenState.sourceStats[ip].count++
      openCodeZenState.sourceStats[ip].lastAt = new Date(now).toISOString()
    }
  }
}

function trackOpenCodeZenRateLimit() {
  openCodeZenState.errors429++
  openCodeZenState.lastRateLimitAt = new Date().toISOString()
}

async function probeAcerProxy() {
  const now = Date.now()
  if (!openCodeZenState._lastAcerProbeAt || now - openCodeZenState._lastAcerProbeAt > ACER_PROBE_INTERVAL_MS) {
    openCodeZenState._lastAcerProbeAt = now
    try {
      const resp = await fetch(ACER_PROXY_URL + '/health', { signal: AbortSignal.timeout(5_000) })
      const wasOnline = openCodeZenState.acerProxyOnline
      openCodeZenState.acerProxyOnline = resp.ok
      if (wasOnline !== resp.ok) {
        console.log('[AcerProxy] Status: ' + (resp.ok ? 'ONLINE' : 'OFFLINE') + ' (HTTP ' + resp.status + ')')
      }
    } catch (e) {
      if (openCodeZenState.acerProxyOnline !== false) {
        console.log('[AcerProxy] Status: OFFLINE (' + e.message + ')')
      }
      openCodeZenState.acerProxyOnline = false
    }
  }
  return openCodeZenState.acerProxyOnline
}

async function getOpenCodeZenStatus() {
  const now = Date.now()
  const windowMs = 60_000
  const win = (openCodeZenState.requestsWindow || []).filter(t => now - t <= windowMs)
  // Probe the upstream Zen API every 30s to check liveness
  if (!openCodeZenState._lastProbeAt || now - openCodeZenState._lastProbeAt > 30_000) {
    openCodeZenState._lastProbeAt = now
    try {
      const resp = await fetch('https://opencode.ai/zen/v1/models', {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      })
      openCodeZenState._upstreamOk = resp.ok
      openCodeZenState._upstreamError = null
    } catch (err) {
      openCodeZenState._upstreamOk = false
      openCodeZenState._upstreamError = err.message
    }
  }
  // Probe Acer proxy health periodically
  await probeAcerProxy()
  return {
    totalRequests: openCodeZenState.totalRequests,
    errors429: openCodeZenState.errors429,
    lastRateLimitAt: openCodeZenState.lastRateLimitAt,
    lastRequestAt: openCodeZenState.lastRequestAt,
    sourceStats: openCodeZenState.sourceStats,
    requestsPerMinute: win.length,
    upstreamOk: openCodeZenState._upstreamOk === true,
    upstreamError: openCodeZenState._upstreamError || null,
    // Fallback fields
    fallbackActive: openCodeZenState.fallbackActive,
    fallbackIp: openCodeZenState.fallbackIp,
    fallbackAt: openCodeZenState.fallbackAt,
    fallbackAttempts: openCodeZenState.fallbackAttempts,
    fallbackRecoveries: openCodeZenState.fallbackRecoveries,
    acerProxyOnline: openCodeZenState.acerProxyOnline,
  }
}

async function proxyOpenCodeZenRelay(req, res) {
  const subpath = req.path.replace(/^\/v1\/zen/, '') || '/chat/completions'
  const isStream = req.body?.stream !== false

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
  }

  // Decide rota: direto ou fallback via Acer
  const useFallback = openCodeZenState.fallbackActive
  const directUrl = 'https://opencode.ai/zen/v1' + subpath
  const fallbackUrl = ACER_PROXY_URL + '/zen/v1' + subpath

  // 1) Tenta fetch direto
  if (!useFallback) {
    try {
      const upstream = await fetch(directUrl, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', Accept: isStream ? 'text/event-stream' : 'application/json' },
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
      })

      if (upstream.status !== 429 && upstream.status !== 403 && upstream.ok) {
        // Sucesso direto — se estava em fallback, recupera
        if (openCodeZenState.fallbackActive) {
          openCodeZenState.fallbackActive = false
          openCodeZenState.fallbackIp = '45.236.212.84'
          openCodeZenState.fallbackRecoveries++
          console.log('[Fallback] Recuperado: volta ao IP direto do servidor')
        }
        if (isStream) {
          for await (const chunk of upstream.body) res.write(chunk)
          return res.end()
        }
        return res.json(await upstream.json())
      }

      // Rate limit ou erro — marca e tenta fallback
      if (upstream.status === 429 || upstream.status === 403) {
        trackOpenCodeZenRateLimit()
        console.log('[Fallback] Rate limit detectado (HTTP ' + upstream.status + '), tentando fallback via Acer proxy...')
      } else {
        const errText = await upstream.text()
        console.log('[Fallback] Erro upstream (HTTP ' + upstream.status + '), tentando fallback via Acer proxy...')
        if (!res.headersSent && !isStream) {
          res.status(upstream.status)
          return res.json({ error: { message: 'OpenCode Zen upstream error: ' + upstream.status, detail: errText.slice(0, 200) } })
        }
      }
    } catch (err) {
      console.log('[Fallback] Erro de conexao direta: ' + err.message + ', tentando fallback...')
    }
  }

  // 2) Fallback via proxy Acer
  // So tenta fallback se nao estiver em cooldown apos falha completa
  const cooldownUntil = openCodeZenState._fallbackCooldownUntil || 0
  if (Date.now() < cooldownUntil) {
    console.log('[Fallback] Em cooldown, nao tentando fallback')
    if (!res.headersSent) {
      if (isStream) {
        res.write('data: ' + JSON.stringify({ error: { message: 'OpenCode Zen rate limit - fallback em cooldown', type: 'rate_limit_error', code: 429 } }) + '\n\n')
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      return res.json({ error: { message: 'OpenCode Zen rate limit - fallback em cooldown', type: 'rate_limit_error', code: 429 } })
    }
    return
  }

  try {
    const fallbackResp = await fetch(fallbackUrl, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', Accept: isStream ? 'text/event-stream' : 'application/json' },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    })

    if (!fallbackResp.ok) {
      const fbErr = await fallbackResp.text().catch(() => '')
      console.log('[Fallback] Falha no Acer proxy: HTTP ' + fallbackResp.status + ' ' + fbErr.slice(0, 100))
      // Marca cooldown para nao ficar tentando sem parar
      openCodeZenState._fallbackCooldownUntil = Date.now() + FALLBACK_COOLDOWN_MS
      if (!res.headersSent) {
        if (isStream) {
          res.write('data: ' + JSON.stringify({ error: { message: 'OpenCode Zen rate limit - fallback tambem falhou', type: 'rate_limit_error', code: 429 } }) + '\n\n')
          res.write('data: [DONE]\n\n')
          return res.end()
        }
        return res.json({ error: { message: 'OpenCode Zen rate limit - fallback tambem falhou', type: 'rate_limit_error', code: 429 } })
      }
      return
    }

    // Fallback funcionou!
    if (!openCodeZenState.fallbackActive) {
      openCodeZenState.fallbackActive = true
      openCodeZenState.fallbackAt = new Date().toISOString()
      openCodeZenState.fallbackIp = '177.23.254.196'
      openCodeZenState.fallbackAttempts++
      console.log('[Fallback] Ativado! Requisicoes agora saem pelo IP do Acer (177.23.254.196)')
    }

    if (isStream) {
      for await (const chunk of fallbackResp.body) res.write(chunk)
      return res.end()
    }
    return res.json(await fallbackResp.json())
  } catch (err) {
    console.log('[Fallback] Erro no Acer proxy: ' + err.message)
    openCodeZenState._fallbackCooldownUntil = Date.now() + FALLBACK_COOLDOWN_MS
    if (!res.headersSent) {
      if (isStream) {
        res.write('data: ' + JSON.stringify({ error: { message: 'Rate limit OpenCode Zen - fallback error: ' + err.message, type: 'rate_limit_error', code: 429 } }) + '\n\n')
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      return res.json({ error: { message: 'Rate limit OpenCode Zen - fallback error: ' + err.message, type: 'rate_limit_error', code: 429 } })
    }
  }
}

app.get('/v1/zen/models', requireAgentSecret, async (_req, res) => {
  try {
    const upstream = await fetch('https://opencode.ai/zen/v1/models', { headers: { Accept: 'application/json' } })
    const data = await upstream.json()
    const freeIds = new Set(['big-pickle', 'deepseek-v4-flash-free', 'nemotron-3-super-free', 'qwen3.6-plus-free', 'minimax-m2.5-free'])
    const freeModels = (data.data || []).filter(m => m.id.endsWith('-free') || freeIds.has(m.id))
    res.json({ ...data, data: freeModels })
  } catch (err) {
    res.status(502).json({ error: err.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/v1/zen/chat/completions', async (req, res) => {
  trackOpenCodeZenRequest(req)
  await proxyOpenCodeZenRelay(req, res)
})

app.get('/api/opencode-zen', requireAdmin, async (_req, res) => {
  const status = await getOpenCodeZenStatus()
  res.json({ ok: true, ...status, checkedAt: new Date().toISOString() })
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

app.get('/api/codex-profiles', requireAdmin, async (_req, res) => {
  try {
    res.json({ ok: true, ...await listCodexProfilesWithUsage(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-profiles/save-current', requireAdmin, requireAdminAction, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) return res.status(400).json({ error: 'Nome do perfil obrigatorio' })
    const profile = saveCurrentCodexProfile(name)
    res.json({ ok: true, profile, ...await listCodexProfilesWithUsage(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/codex-profiles/:slug/activate', requireAdmin, requireAdminAction, async (req, res) => {
  try {
    const result = await activateCodexProfile(req.params.slug)
    res.json({ ok: true, result, ...await listCodexProfilesWithUsage(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.delete('/api/codex-profiles/:slug', requireAdmin, requireAdminAction, async (req, res) => {
  try {
    const result = deleteCodexProfile(req.params.slug)
    res.json({ ok: true, result, ...await listCodexProfilesWithUsage(), checkedAt: new Date().toISOString() })
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

app.get('/api/gemini-login/status', requireAdmin, (_req, res) => {
  res.json(geminiLoginStatusPayload())
})

app.post('/api/gemini-login/start', requireAdmin, requireAdminAction, (_req, res) => {
  try {
    res.json(startGeminiLoginProcess())
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/gemini-login/submit-code', requireAdmin, requireAdminAction, (req, res) => {
  try {
    res.json(submitGeminiLoginCode(req.body?.code))
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

app.post('/api/gemini-login/cancel', requireAdmin, requireAdminAction, (_req, res) => {
  res.json(cancelGeminiLoginProcess())
})

app.post('/api/codex-login/auto-save', requireAdmin, requireAdminAction, async (_req, res) => {
  try {
    const auth = readJson(CODEX_AUTH_PATH)
    if (!auth) return res.status(400).json({ error: 'Nenhuma conta ativa no CLI' })

    const email = extractEmailFromTokens(auth)
    if (!email) return res.status(400).json({ error: 'Nao foi possivel extrair email da conta' })

    const chatgptAccountId = extractChatgptAccountId(auth)
    const profileName = email.trim() || 'conta-' + Date.now()

    // Verifica se ja existe um perfil com a mesma conta (pelo chatgpt_account_id nos JWTs)
    const allProfiles = listCodexProfiles().profiles
    const existing = allProfiles.find((p) => {
      const pAuth = readJson(path.join(CODEX_PROFILES_DIR, p.slug, 'auth.json'))
      const pChatId = extractChatgptAccountId(pAuth)
      return pChatId && chatgptAccountId && pChatId === chatgptAccountId
    })

    let slug
    if (existing) {
      // Atualiza o perfil existente com os novos tokens
      slug = existing.slug
      const dir = profilePath(slug)
      const targetAuth = path.join(dir, 'auth.json')
      fs.copyFileSync(CODEX_AUTH_PATH, targetAuth)
      chmodPrivate(targetAuth)
      // Atualiza metadado
      const metaPath = path.join(dir, 'meta.json')
      const meta = readJson(metaPath) || {}
      meta.updatedAt = new Date().toISOString()
      meta.name = profileName
      atomicWriteJson(metaPath, meta)
    } else {
      // Cria novo perfil
      const profile = saveCurrentCodexProfile(profileName)
      slug = profile.slug
    }

    // Ativa o perfil
    const activation = await activateCodexProfile(slug)

    res.json({ ok: true, slug, activation, ...listCodexProfiles(), checkedAt: new Date().toISOString() })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
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

app.post('/api/llm-route', requireAgentSecret, async (req, res) => {
  try {
    res.json(await llmRoutePayload({ task: req.body?.task || 'local-automation' }))
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
})

// ─── Codex credential endpoint for agents via Bearer token ──────
//
// Returns the current active Codex credential so remote agents (Vertex,
// Hermes clones, etc.) can use GPT without having ~/.hermes/auth.json locally.
// Auth: Bearer token via LIMITS_PANEL_AGENT_SECRET.
//
app.post('/api/codex-credential', requireAgentSecret, (_req, res) => {
  try {
    const credential = readHermesCodexCredential()
    if (!credential?.access_token) {
      return res.status(404).json({ error: 'Nenhuma credencial Codex ativa no momento', checkedAt: new Date().toISOString() })
    }
    res.json({
      ok: true,
      credential: {
        access_token: credential.access_token,
        account_id: credential.account_id || '',
        base_url: credential.base_url || 'https://chatgpt.com/backend-api/codex',
        label: credential.label || null,
        source: credential.source || 'panel',
      },
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    res.status(500).json({ error: error.message, checkedAt: new Date().toISOString() })
  }
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

  staticApp.use(['/api', '/v1'], express.raw({ type: '*/*', limit: '2mb' }), proxyToApi)

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
// Probe Acer proxy health on startup and every 30s
setTimeout(() => probeAcerProxy().catch(() => {}), 1000)
setInterval(() => probeAcerProxy().catch(() => {}), 30000)

const server = app.listen(API_PORT, '0.0.0.0', () => {
  console.log(`Painel de limites API em http://127.0.0.1:${API_PORT}`)
  startStaticServer()
})

// PM2 handles restart — just clean up, don't fight it
process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
