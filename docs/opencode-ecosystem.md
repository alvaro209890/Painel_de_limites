# OpenCode Ecosystem no Painel de Limites

Este documento consolida **tudo** relacionado ao OpenCode no Painel de Limites: o relay OpenCode Zen, o gateway OpenAI-compatible, a integração com Hermes, e o Gemini via OpenCode.

> **Nota:** Documentos anteriores (`docs/hermes-opencode-free.md`, `docs/openai-gateway.md`, `docs/gemini-opencode-local.md`) permanecem como referências detalhadas. Este é o mapa geral.

---

## Sumário

1. [Arquitetura Geral](#1-arquitetura-geral)

## 1-A. Fluxo de Requisicoes e IP de Saida

### Quem faz a requisicao upstream para a OpenCode?

**Sempre o servidor (45.236.212.84).** O Painel de Limites roda exclusivamente no servidor. 
Quando qualquer cliente (Hermes do notebook, Hermes do servidor, OpenCode CLI, curl) faz uma 
requisicao para o relay Zen (`/v1/zen/chat/completions`), o servidor faz o proxy chamando:

```js
fetch('https://opencode.ai/zen/v1/chat/completions', ...)
```

A OpenCode enxerga **apenas o IP do servidor** como origem da requisicao.

### Diagrama de fluxo real

```
+---------------------------+     +---------------------------------------+     +------------------+
|  Hermes Acer (notebook)   |---->|                                       |---->|  OpenCode Zen    |
|  IP publico: 177.23.254.196|     |  Painel de Limites (servidor)        |     |  opencode.ai     |
+---------------------------+     |  IP de saida: 45.236.212.84          |     |  ve IP:          |
                                   |  proxyOpenCodeZenRelay               |     |  45.236.212.84   |
+---------------------------+     |  -> fetch(targetUrl)                  |     |  (servidor)      |
|  Hermes Servidor (local)  |---->|                                       |     +------------------+
|  IP: 127.0.0.1            |     +---------------------------------------+
+---------------------------+
```

**Resumo: ambos os PCs compartilham o mesmo IP de saida (45.236.212.84) e, portanto, 
o mesmo rate-limit/limite na OpenCode.**

### Como as requisicoes sao contabilizadas no painel

Apenas a **rota Zen** (`/v1/zen/chat/completions`) alimenta o `sourceStats` 
('Requisicoes por maquina'). A rota Codex (`/v1/chat/completions`) **nao contabiliza**.

#### Rastreamento por IP de origem

```javascript
// server.js:2191
const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()
```

| Origem da requisicao | IP que chega no servidor | Nome no ZEN_MACHINE_MAP | Aparece no painel como |
|---|---|---|---|
| Hermes Acer (via Cloudflare) -> `limites.cursar.space` | Cloudflare tunnel -> `127.0.0.1` | `'servidor (local)'` | servidor (local) |
| Hermes Acer (via Tailscale direto) -> `100.65.138.58:8787` | `100.102.202.63` (Tailscale) | `'Acer'` | **Acer** |
| Hermes Servidor (localhost) -> `127.0.0.1:8787` | `127.0.0.1` | `'servidor (local)'` | servidor (local) |
| Hermes Servidor (Tailscale) -> `100.65.138.58:8787` | `100.65.138.58` | `'servidor'` | servidor |

#### Mapa de IPs

```javascript
// server.js:978
const ZEN_MACHINE_MAP = {
  '100.102.202.63': 'Acer',
  '100.65.138.58':  'servidor',
  '127.0.0.1':      'servidor (local)',
  '::1':            'servidor (local)',
}
```

### Configuracao dos dois Hermes

#### Servidor (server-desktop)

```yaml
model:
  default: deepseek-v4-flash-free
  provider: opencode-zen-free
  base_url: http://127.0.0.1:8787/v1/zen
```

#### Acer (notebook)

```yaml
# Provider principal (Codex/GPT)
model:
  default: gpt-5.5
  provider: openai-codex
  base_url: https://limites.cursar.space/v1

# Provider adicional (OpenCode Zen) - via Cloudflare
providers:
  opencode-zen-free:
    name: OpenCode Zen Free
    base_url: https://limites.cursar.space/v1/zen
    api_mode: openai
    model: deepseek-v4-flash-free
    models:
      deepseek-v4-flash-free: { context_length: 128000 }
      nemotron-3-super-free:  { context_length: 128000 }
      big-pickle:             { context_length: 128000 }

# Fallback automatico
fallback_providers:
- opencode-zen-free
```

**Nota:** quando o notebook usa os modelos Zen via Cloudflare, as requisicoes
aparecem como 'servidor (local)' no sourceStats. Para aparecer como 'Acer',
e necessario acessar o servidor via Tailscale direto (`http://100.65.138.58:8787/v1/zen`)
e o servidor Node precisa ouvir em `0.0.0.0:8787`.

---

2. [OpenCode Zen Relay](#2-opencode-zen-relay)
3. [Gateway OpenAI-compatible (Codex/GPT)](#3-gateway-openai-compatible-codexgpt)
4. [Hermes + OpenCode Zen Free](#4-hermes--opencode-zen-free)
5. [Gemini via OpenCode](#5-gemini-via-opencode)
6. [Endpoints da API](#6-endpoints-da-api)
7. [Métricas e Dashboard](#7-métricas-e-dashboard)
8. [Troubleshooting](#8-troubleshooting)
9. [Diagrama de Fluxo](#9-diagrama-de-fluxo)

---

## 1. Arquitetura Geral

O Painel de Limites atua como **hub central** para modelos de IA no ambiente do Álvaro. Três fluxos distintos de OpenCode passam pelo servidor:

```
┌──────────────────────────────────────────────────┐
│                 Painel de Limites                 │
│               (limites.cursar.space)              │
│                                                   │
│  ┌────────────────┐  ┌──────────────────────────┐ │
│  │ OpenCode Zen   │  │ Gateway OpenAI-compatible │ │
│  │ Relay          │  │ (Codex Responses API)     │ │
│  │ /v1/zen/*      │  │ /v1/*                     │ │
│  ├────────────────┤  ├──────────────────────────┤ │
│  │ → opencode.ai  │  │ → chatgpt.com (Codex)    │ │
│  │   /zen/v1      │  │ → gemini CLI (experim.)  │ │
│  └────────────────┘  └──────────────────────────┘ │
│                                                   │
│  ┌──────────────────────────────────────────────┐ │
│  │ Hermes Gateway (server-desktop)              │ │
│  │ provider: opencode-zen-free                  │ │
│  │ → usa /v1/zen/chat/completions (via proxy)   │ │
│  └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

**Máquinas envolvidas:**

| Máquina | Tailscale IP | Acesso | Função OpenCode |
|---------|-------------|--------|-----------------|
| servidor (server-desktop) | 100.65.138.58 | Local + SSH | Relay + Gateway + Hermes |
| Acer (Alvaro) | 100.102.202.63 | Tailscale | Cliente OpenCode CLI |

---

## 2. OpenCode Zen Relay

Um proxy inteligente que **roteia chamadas para a API gratuita da OpenCode Zen** (`https://opencode.ai/zen/v1`) pelo servidor.

### Por que existe?

O IP residencial do Acer é eventualmente bloqueado pelo Cloudflare do OpenCode Zen. Ao rotear pelo servidor (IP fixo 45.236.212.84), as requisições passam por um IP diferente, distribuindo a carga.

### Como funciona

```javascript
// server.js:985
let openCodeZenState = {
  totalRequests: 0,       // requisições desde o último restart do PM2
  errors429: 0,           // rate limits detectados
  lastRateLimitAt: null,  // timestamp do último 429
  lastRequestAt: null,    // timestamp da última requisição
  requestsWindow: [],     // janela deslizante de 60s para RPM
  sourceStats: {},        // { ip: { count, lastAt, machineName } }
}
```

**Endpoint:** `/v1/zen/chat/completions` — sem autenticação (não precisa de `agent_secret`).

**Comportamento:**

- **Streaming:** suportado — faz pipe direto do stream upstream para o cliente.
- **429 (rate limit):** retorna erro estruturado (não quebra o cliente) e incrementa `errors429`.
- **403 (IP block no Cloudflare):** tratado como 429 — força fallback chain no Hermes.
- **Modelos free filtrados:** `/v1/zen/models` filtra apenas modelos com sufixo `-free` + lista fixa.
- **Liveness probe:** a cada 30s consulta `https://opencode.ai/zen/v1/models` e atualiza `upstreamOk`/`upstreamError`.

### Mapa de IPs para máquinas

```javascript
// server.js:978
const ZEN_MACHINE_MAP = {
  '100.102.202.63': 'Acer',
  '100.65.138.58':  'servidor',
  '127.0.0.1':      'servidor (local)',
  '::1':            'servidor (local)',
}
```

### Modelos free disponíveis

- `deepseek-v4-flash-free`
- `nemotron-3-super-free`
- `big-pickle`
- `qwen3.6-plus-free`
- `minimax-m2.5-free`

(Os 3 primeiros são os principais usados pelo Hermes.)

---

## 3. Gateway OpenAI-compatible (Codex/GPT)

Uma API compatível com OpenAI Chat Completions exposta para clientes como OpenCode CLI.

### Endpoints

```text
GET  /v1/models              → lista modelos disponíveis
POST /v1/chat/completions    → proxy para Codex Responses API
```

### Autenticação

`Authorization: Bearer <LIMITS_PANEL_AGENT_SECRET>` (requerido).

O `requireAgentSecret` verifica contra `LIMITS_PANEL_AGENT_SECRET` e `GEMINI_AGENT_SECRET`.

### Modelos suportados

| Model ID (OpenCode) | Código Codex upstream | Contexto | Output |
|---------------------|----------------------|----------|--------|
| limites/gpt-5.5       | gpt-5.5 (padrão)     | 400K     | 128K   |
| limites/gpt-5.4       | gpt-5.4              | 320K     | 96K    |
| limites/gpt-5.3-codex | gpt-5.3-codex        | 256K     | 64K    |

**Nota:** o prefixo `limites/` é uma convenção do OpenCode CLI. A API ignora o prefixo e usa o nome do modelo diretamente.

### Reasoning effort

```text
"minimal" → "low"     (Codex não aceita minimal)
"max"     → "xhigh"
"none"/"low"/"medium"/"high"/"xhigh" → passam direto
ausente   → "medium"
```

No OpenCode CLI:
```bash
opencode run "prompt" --model limites/gpt-5.5 --variant low
```

### Rotação de contas

Antes de cada chamada Codex, o gateway verifica o uso da credencial ativa. Se esgotada e a rotação automática estiver habilitada (`rotation-config.json` → `enabled: true`), a rotação executa automaticamente.

### Gemini passthrough

Se o token de autenticação for o `GEMINI_AGENT_SECRET`, o gateway também inclui modelos Gemini na listagem (`/v1/models`) e roteia chamadas Gemini para `proxyGeminiCliAsOpenAIChat()`.

---

## 4. Hermes + OpenCode Zen Free

O Hermes Gateway do servidor usa o provider `opencode-zen-free` para os modelos free da OpenCode.

### Configuração

```yaml
# ~/.hermes/hermes-agent/config.yaml
provider: opencode-zen-free
model: deepseek-v4-flash-free
```

**Provider Hermes:** `opencode-zen-free` (built-in, não custom).  
**Endpoint:** `https://opencode.ai/zen/v1` (acessado via relay do Painel em `http://127.0.0.1:8787/v1/zen`).  
**Modelos free:** `deepseek-v4-flash-free`, `nemotron-3-super-free`, `big-pickle`.

### Streaming (problema conhecido)

O endpoint free da OpenCode fecha respostas chunked antes do frame final. Correção aplicada no Hermes:

- `agent/conversation_loop.py`: quando `provider == "opencode-zen-free"` ou `base_url` contém `opencode.ai/zen`, streaming é desabilitado.
- Chat completions **non-streaming** são estáveis.

### Verificação

```bash
cd ~/.hermes/hermes-agent
for m in deepseek-v4-flash-free nemotron-3-super-free big-pickle; do
  ./venv/bin/python -m hermes_cli.main chat -Q \
    --provider opencode-zen-free --model "$m" \
    -q "Responda exatamente: OK"
done
```

Resultado esperado:
```
deepseek-v4-flash-free -> OK
nemotron-3-super-free  -> OK
big-pickle             -> OK
```

---

## 5. Gemini via OpenCode

Experimental — expõe modelos Gemini pelo gateway OpenAI-compatible.

### Token separado

O segredo `GEMINI_AGENT_SECRET` (em `~/.config/codex-profiles/gemini-agent-secret.json`) controla acesso separado aos modelos Gemini.

### Modelos

```
gemini-2.5-pro
gemini-2.5-flash
gemini-2.5-flash-lite
```

### Uso no OpenCode do Acer

```bash
opencode run 'prompt' --model limites-gemini/gemini-2.5-flash
```

### Arquitetura

Cada chamada roda a Gemini CLI como subprocesso:
```bash
gemini -p '<prompt>' --model gemini-2.5-flash --output-format json --skip-trust
```

A resposta JSON é convertida para formato OpenAI Chat Completions.

### Limitações

- Não implementa tool calls OpenAI-compatible
- Streaming é simulado (resposta completa, depois chunks)
- Latência maior (cada request sobe uma CLI)
- Indicado para perguntas/planejamento, não para edição de código

---

## 6. Endpoints da API

### Relay Zen (sem auth)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/v1/zen/models` | Lista modelos free disponíveis na OpenCode Zen |
| `POST` | `/v1/zen/chat/completions` | Proxy chat completions para OpenCode Zen |
| `GET` | `/api/opencode-zen` | Status do relay (admin) |

### Gateway OpenAI-compatible (agent secret)

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/v1/models` | Lista modelos disponíveis (Codex + Gemini se token Gemini) |
| `POST` | `/v1/chat/completions` | Chat completions (Codex ou Gemini) |

---

## 7. Métricas e Dashboard

O Painel de Limites exibe estatísticas do OpenCode Zen no módulo **IA**:

| Métrica | Origem | Descrição |
|---------|--------|-----------|
| Req/min | `requestsWindow` (janela 60s) | Requisições por minuto |
| Total | `totalRequests` | Acumulado desde o restart do PM2 |
| Erros 429 | `errors429` | Rate limits recebidos |
| Último 429 | `lastRateLimitAt` | Timestamp do último rate limit |
| Último request | `lastRequestAt` | Timestamp da última requisição |
| Por máquina | `sourceStats` | Requisições agregadas por IP de origem |
| Upstream | `upstreamOk` | Liveness probe (cada 30s) no endpoint OpenCode Zen |

### Aba Credenciais — card OpenCode Zen

A aba **Credenciais** também mostra o estado do relay com badge online/offline baseado no `upstreamOk`.

---

## 8. Troubleshooting

### 8.1 Streaming instável no Zen Free

**Sintoma:** Erro `RemoteProtocolError: incomplete chunked read` no Hermes Gateway.

**Causa:** O endpoint `opencode.ai/zen/v1` encerra respostas chunked antes do frame final.

**Solução:** Forçar non-streaming via `stream: false` ou usar o relay do Painel (que lida com o streaming upstream e retorna resposta completa).

Já corrigido no Hermes: toda request para `opencode-zen-free` ou com `base_url` contendo `opencode.ai/zen` usa non-streaming.

### 8.2 Rate limit / IP bloqueado

**Sintoma:** Erro 429 ou 403 da OpenCode Zen.

**Solução:** O relay detecta e trata ambos como rate limit. Se persistir, alternar o Hermes para o modelo principal (DeepSeek) até o rate limit expirar. O relay do servidor tem liveness probe que mostra `upstreamError` no dashboard.

### 8.3 Gemini OAuth expirado

**Sintoma:** Gateway retorna 502 nas chamadas Gemini.

**Solução:** Refazer login Gemini pelo painel (aba Credenciais → Login Gemini CLI). O dashboard mostra `oauthExpired: true` quando o token venceu.

### 8.4 Gateway retornando 401 (token inválido)

**Sintoma:** `curl` para `/v1/models` retorna 401.

**Causa:** `LIMITS_PANEL_AGENT_SECRET` não configurado ou token errado.

**Solução:** Verificar `~/.hermes/.env` ou `~/.config/codex-profiles/` para o secret correto, e o `openCodexConfig` no OpenCode CLI.

---

## 9. Diagrama de Fluxo

```
                         ┌──────────────────────────┐
                         │     OpenCode Zen API      │
                         │   opencode.ai/zen/v1      │
                         └──────────┬───────────────┘
                                    │
                         ┌──────────▼───────────────┐
                         │  Painel de Limites Relay  │
                         │  /v1/zen/chat/completions │
                         │  ─ fluxo streaming pipe   │
                         │  ─ detecta 429/403        │
                         │  ─ liveness probe 30s     │
                         └──────────┬───────────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
    ┌───────────▼────────┐ ┌───────▼────────┐ ┌───────▼──────────┐
    │   Acer (OpenCode)  │ │  Hermes Agent  │ │  Outros clients  │
    │  opencode run ...  │ │  server-desk   │ │  curl, scripts   │
    │  Tailscale:        │ │  provider:     │ │                  │
    │  100.102.202.63    │ │  opencode-zen  │ │                  │
    └────────────────────┘ └────────────────┘ └──────────────────┘

                    ┌──────────────────────────────┐
                    │  Gateway OpenAI-compatible    │
                    │  /v1/chat/completions         │
                    │                               │
                    │  ┌──────────────────────┐    │
                    │  │ Codex Responses API   │    │
                    │  │ chatgpt.com           │    │
                    │  └──────────────────────┘    │
                    │  ┌──────────────────────┐    │
                    │  │ Gemini CLI (exper.)   │    │
                    │  │ gemini -p ...         │    │
                    │  └──────────────────────┘    │
                    └──────────────────────────────┘
```

---

## Arquivos Relacionados

| Arquivo | Conteúdo |
|---------|----------|
| `server.js:985-992` | Estado do relay Zen (in-memory) |
| `server.js:978-983` | Mapa IP → máquina |
| `server.js:2181-2322` | Implementação do relay Zen |
| `server.js:1586-1635` | Gateway OpenAI-compatible |
| `gateway-utils.mjs` | Utilitários de modelos e payload |
| `src/modules/ai/AiModule.tsx:103-133` | UI do relay no dashboard |
| `src/modules/codex-accounts/CodexAccountsModule.tsx:121-354` | Card OpenCode Zen nas credenciais |
| `src/types/dashboard.ts:86-95, 193-200` | Tipos TypeScript do relay |
| `docs/hermes-opencode-free.md` | Diagnóstico e correção Hermes+Zen Free |
| `docs/openai-gateway.md` | Gateway OpenAI-compatible |
| `docs/gemini-opencode-local.md` | Gemini via OpenCode |
