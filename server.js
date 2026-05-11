import express from 'express'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'

const app = express()
const API_PORT = Number(process.env.LIMITS_PANEL_PORT || 8787)
const SITE_PORT = Number(process.env.LIMITS_PANEL_SITE_PORT || 4173)
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH || path.join(os.homedir(), '.codex', 'auth.json')
const CODEX_STATE_PATH = process.env.CODEX_STATE_PATH || path.join(os.homedir(), '.codex', 'state_5.sqlite')
const DIST_DIR = path.join(process.cwd(), 'dist')

// ─── Safe helpers ────────────────────────────────────────────────

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
      email: redactEmail(usage.email),
      planType: usage.plan_type,
      userId: usage.user_id,
    },
    status: {
      allowed: usage.rate_limit?.allowed ?? false,
      limitReached: usage.rate_limit?.limit_reached ?? false,
      reachedType: usage.rate_limit_reached_type,
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
