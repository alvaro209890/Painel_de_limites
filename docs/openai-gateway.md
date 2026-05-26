# Gateway OpenAI-compatible para OpenCode / LLM Clients

O Painel de Limites expoe uma API OpenAI-compatible para clientes como OpenCode usarem GPT/Codex sem conhecer as contas diretamente.

## Endpoints

```text
GET  /v1/models
POST /v1/chat/completions
```

Autenticacao: `Authorization: Bearer <LIMITS_PANEL_AGENT_SECRET>`

O endpoint publico `https://limites.cursar.space/v1/...` e encaminhado pelo servidor estatico para a API em `127.0.0.1:8787`.

## Modelos expostos

| Model ID (OpenCode)   | Codigo Codex upstream | Contexto | Output |
|-----------------------|----------------------|----------|--------|
| limites/gpt-5.5       | gpt-5.5 (padrao)     | 400K     | 128K   |
| limites/gpt-5.4       | gpt-5.4              | 320K     | 96K    |
| limites/gpt-5.3-codex | gpt-5.3-codex        | 256K     | 64K    |

Sao os modelos suportados pelo Codex Responses API com conta ChatGPT Plus.
Modelos o3, o4, gpt-4.1, gpt-4o, claude-sonnet-4 NAO funcionam no Codex com ChatGPT Plus.

## Reasoning effort

Aceita `reasoning_effort` (raiz, formato Chat Completions) ou `reasoning.effort` (aninhado).

Mapeamento:
- `"minimal"` -> `"low"` (Codex Responses nao aceita minimal)
- `"max"` -> `"xhigh"`
- `"none"`, `"low"`, `"medium"`, `"high"`, `"xhigh"` passam direto
- valor ausente/invalido -> `"medium"`

No OpenCode: `--variant <level>`
```bash
opencode run "prompt" --model limites/gpt-5.5 --variant low
opencode run "prompt" --model limites/gpt-5.5 --variant high
```

## Rotacao de contas

Antes de chamar o Codex upstream, verifica uso da credencial ativa. Se esgotada e
`rotation-config.json` com `enabled: true`, roda `runCodexRotationOnce()` e usa nova credencial.

## Testes

```bash
# local no servidor
node --check server.js
node --test gateway-utils.test.mjs
npm run build
curl -sS http://127.0.0.1:8787/api/health

# via publico
curl -sS https://limites.cursar.space/v1/models -H "Authorization: Bearer $TOKEN"
curl -sS https://limites.cursar.space/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","stream":false,"messages":[{"role":"user","content":"Oi"}]}'
```
