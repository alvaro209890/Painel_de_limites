import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import Database from 'better-sqlite3'

const app = express()
const PORT = Number(process.env.LIMITS_PANEL_PORT || 8787)
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH || path.join(os.homedir(), '.codex', 'auth.json')
const CODEX_STATE_PATH = process.env.CODEX_STATE_PATH || path.join(os.homedir(), '.codex', 'state_5.sqlite')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function redactEmail(email) {
  if (!email || !email.includes('@')) return email || null
  const [name, domain] = email.split('@')
  return `${name.slice(0, 3)}***@${domain}`
}

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

app.listen(PORT, () => {
  console.log(`Painel de limites API em http://127.0.0.1:${PORT}`)
})
