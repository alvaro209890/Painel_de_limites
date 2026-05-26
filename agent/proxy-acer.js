#!/usr/bin/env node
/**
 * proxy-acer.js — Relay de fallback do OpenCode Zen
 *
 * Roda no notebook Acer e expõe um proxy HTTP que faz fetch para a
 * OpenCode Zen API (https://opencode.ai/zen/v1) saindo pelo IP do Acer.
 *
 * O Painel de Limites (servidor) usa este proxy quando o IP do servidor
 * (45.236.212.84) toma rate limit na OpenCode. Assim a requisição sai
 * pelo IP do Acer (177.23.254.196), contornando o bloqueio temporário.
 *
 * Instalação:
 *   1. Copiar para o Acer: scp proxy-acer.js acer@100.102.202.63:~/
 *   2. Iniciar: nohup node ~/proxy-acer.js &
 *   3. Opcional: sistema systemd user
 *
 * Endpoints:
 *   GET  /health              — healthcheck
 *   POST /zen/v1/chat/completions — proxy chat (stream + non-stream)
 *   GET  /zen/v1/models       — lista modelos free
 *
 * Segurança: só aceita conexões da rede Tailscale (100.x.x.x) e localhost.
 */

const http = require('http');
const https = require('https');
const os = require('os');

const PORT = parseInt(process.env.ACER_PROXY_PORT || '8788', 10);

// Só aceita origens confiáveis (Tailscale + localhost)
const ALLOWED_SUBNETS = [
  '100.',       // Tailscale IPv4
  'fd7a:',      // Tailscale IPv6
  '127.',       // localhost
  '::1',        // localhost IPv6
  '192.168.',   // LAN local (opcional)
];

function isAllowed(ip) {
  return ALLOWED_SUBNETS.some(subnet => ip.startsWith(subnet));
}

// ─── Proxy handler ───────────────────────────────────────────────

async function proxyRequest(req, res) {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress?.replace(/^::ffff:/, '')
    || 'unknown';

  // Só aceita requisições da rede confiável
  if (!isAllowed(clientIp)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Acesso negado: origem nao permitida' }));
  }

  const start = Date.now();
  const method = req.method.toUpperCase();

  // GET /health
  if (req.url === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, hostname: os.hostname(), ip: clientIp }));
  }

  // Mapeia /zen/v1/* → https://opencode.ai/zen/v1/*
  let upstreamPath;
  if (req.url.startsWith('/zen/v1/')) {
    upstreamPath = req.url.replace(/^\/zen\/v1/, '');
  } else if (req.url === '/zen/v1/models') {
    upstreamPath = '/models';
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Rota nao encontrada' }));
  }

  const upstreamUrl = new URL(`https://opencode.ai/zen/v1${upstreamPath}`);
  const isStream = method === 'POST' && (req.headers['accept']?.includes('text/event-stream') || req.headers['content-type']?.includes('application/json'));

  // Constrói opções do fetch upstream
  const upstreamOptions = {
    hostname: upstreamUrl.hostname,
    port: 443,
    path: upstreamUrl.pathname + upstreamUrl.search,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': isStream ? 'text/event-stream' : 'application/json',
      'User-Agent': 'Acer-OpenCode-Proxy/1.0',
    },
    timeout: 60000,
  };

  // Se for POST, coleta o body
  let body = null;
  if (method === 'POST') {
    body = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
    upstreamOptions.headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve) => {
    const upstreamReq = https.request(upstreamOptions, (upstreamRes) => {
      const logPrefix = `[${new Date().toISOString()}] [Acer]`;

      // Se for rate limit, repassa o erro
      if (upstreamRes.statusCode === 429 || upstreamRes.statusCode === 403) {
        res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'application/json' });
        upstreamRes.pipe(res);
        console.log(`${logPrefix} RATE_LIMIT ${upstreamRes.statusCode} client=${clientIp}`);
        return resolve();
      }

      console.log(`${logPrefix} ${method} ${upstreamPath} -> ${upstreamRes.statusCode} (${Date.now() - start}ms)`);

      // Streaming: faz pipe direto
      if (isStream && upstreamRes.statusCode === 200) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        upstreamRes.pipe(res);
        upstreamRes.on('end', () => res.end());
        return resolve();
      }

      // Non-streaming: coleta e repassa
      const chunks = [];
      upstreamRes.on('data', chunk => chunks.push(chunk));
      upstreamRes.on('end', () => {
        const data = Buffer.concat(chunks);
        res.writeHead(upstreamRes.statusCode, { 'Content-Type': upstreamRes.headers['content-type'] || 'application/json' });
        res.end(data);
        resolve();
      });
    });

    upstreamReq.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] [Acer] ERRO ${upstreamPath}: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acer proxy error: ' + err.message }));
      }
      resolve();
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Acer proxy timeout' }));
      }
      resolve();
    });

    if (body) upstreamReq.write(body);
    upstreamReq.end();
  });
}

// ─── Servidor ────────────────────────────────────────────────────

const server = http.createServer(proxyRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Acer OpenCode Proxy] Rodando em http://0.0.0.0:${PORT}`);
  console.log(`[Acer OpenCode Proxy] Modelos: deepseek-v4-flash-free, nemotron-3-super-free, big-pickle`);
  console.log(`[Acer OpenCode Proxy] Aceitando conexoes apenas de rede confiavel`);
});

server.on('error', (err) => {
  console.error(`[Acer OpenCode Proxy] ERRO: ${err.message}`);
  process.exit(1);
});
