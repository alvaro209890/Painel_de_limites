# Roteamento local de LLM para automações

O Painel de Limites expõe `POST /api/llm-route` para automações locais que precisam escolher modelo sem embutir regras de conta/limite em cada script.

## Política atual

- **Primário:** Hermes provider `openai-codex`, modelo `gpt-5.5`, reasoning/effort `medium`.
- **Fallback:** DeepSeek `deepseek-v4-pro`, reasoning/effort `medium`.
- **Roteamento automático:** antes de responder, o painel verifica a credencial ativa em `~/.hermes/auth.json` → `credential_pool.openai-codex` pela API `wham/usage`.
- **Rotação:** se a credencial ativa estiver sem limite e a rotação automática estiver habilitada, o painel tenta `runCodexRotationOnce()` e revalida a credencial antes de montar a rota.
- **Sem proxy de prompt:** o painel não recebe nem executa prompts. Ele só retorna provider/model/política. A chamada ao LLM continua sendo feita pelo consumidor, normalmente via Hermes CLI.

## Autenticação

O endpoint usa o mesmo segredo dos agents remotos:

```http
Authorization: Bearer <LIMITS_PANEL_AGENT_SECRET>
```

Se `LIMITS_PANEL_AGENT_SECRET` não estiver configurado no servidor, o endpoint responde `503`.

## Requisição

```bash
curl -sS http://127.0.0.1:8787/api/llm-route \
  -H "Authorization: Bearer $LIMITS_PANEL_AGENT_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"task":"trello-obsidian-daily-memory"}' | jq
```

## Resposta

```json
{
  "ok": true,
  "policy": "gpt-5.5-medium-via-limits-panel-with-deepseek-v4-pro-fallback",
  "routes": [
    {
      "role": "primary",
      "provider": "openai-codex",
      "model": "gpt-5.5",
      "reasoningEffort": "medium",
      "label": "GPT-5.5 Medium via Hermes OpenAI Codex"
    },
    {
      "role": "fallback",
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "reasoningEffort": "medium",
      "label": "DeepSeek v4 Pro fallback"
    }
  ],
  "diagnostics": {
    "primaryAvailable": true,
    "reasons": []
  }
}
```

Quando o primário não está disponível, a resposta ainda inclui o DeepSeek como `primary-fallback`, permitindo que o consumidor tente diretamente o fallback.

## Consumidor inicial

O projeto `hermes-whatsapp-trello-obsidian` usa este endpoint em `scripts/llm_memory.py` para adicionar sínteses IA nas memórias Obsidian quando `TRELLO_BRAIN_LLM_ENABLED=1`.
