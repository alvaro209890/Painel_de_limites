# Operacao

## Build e execucao

```bash
npm run build
node server.js
```

## Variaveis

- `LIMITS_PANEL_PORT`: porta da API.
- `LIMITS_PANEL_SITE_PORT`: porta do frontend estatico.
- `LIMITS_PANEL_ADMIN_PASSWORD`: senha admin.
- `LIMITS_PANEL_SESSION_SECRET`: segredo da sessao.
- `LIMITS_PANEL_AGENT_SECRET`: segredo dos agentes remotos.
- `DEEPSEEK_API_KEY`: chave para saldo DeepSeek.

## Arquivos importantes

- `config/machines.json`
- `config/projects.json`
- `config/admin-secret.json`
- `data/agent-heartbeats.json`
- `data/gemini-backups/`

## Verificacoes rapidas

```bash
curl -sS http://127.0.0.1:8787/api/health
npm run build
node --check server.js
```
