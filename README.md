# Painel de Limites

Dashboard local para monitoramento DevOps e de maquinas, com foco em:

- Heartbeats de agentes locais e remotos.
- CPU, RAM, discos, temperatura e uptime.
- Status de projetos/servicos via PM2 e health checks HTTP.
- Alertas de maquinas offline, discos quase cheios, projetos fora do ar e saldo baixo.
- Monitoramento das integracoes DeepSeek e Gemini.

## Comandos

```bash
npm run dev
npm run build
npm run preview
node server.js
```

## Backend

O `server.js` expoe apenas as rotas necessarias para o painel:

| Metodo | Rota | Descricao |
| --- | --- | --- |
| `GET` | `/api/health` | Health check simples |
| `GET` | `/api/admin/status` | Status da sessao admin |
| `POST` | `/api/admin/login` | Login admin |
| `POST` | `/api/admin/logout` | Logout admin |
| `GET` | `/api/dashboard` | Payload geral do dashboard |
| `GET` | `/api/machines` | Lista de maquinas e metricas |
| `POST` | `/api/machines/:id/rename` | Renomeia uma maquina cadastrada |
| `POST` | `/api/agent/heartbeat` | Recebe heartbeat do limits-agent |
| `GET` | `/api/projects` | Status de projetos configurados |
| `GET` | `/api/alerts` | Alertas derivados do estado atual |
| `GET` | `/api/pc-metrics` | Metricas locais do servidor |
| `GET` | `/api/deepseek` | Saldo/disponibilidade DeepSeek |
| `GET` | `/api/gemini-login/status` | Status OAuth da Gemini CLI |
| `POST` | `/api/gemini-login/start` | Inicia login Gemini CLI |
| `POST` | `/api/gemini-login/submit-code` | Envia codigo do device flow Gemini |
| `POST` | `/api/gemini-login/cancel` | Cancela login Gemini em andamento |

## Configuracao

- `LIMITS_PANEL_PORT`: porta da API Express, padrao `8787`.
- `LIMITS_PANEL_SITE_PORT`: porta do servidor estatico, padrao `4173`.
- `LIMITS_PANEL_ADMIN_PASSWORD`: senha admin.
- `LIMITS_PANEL_SESSION_SECRET`: segredo de assinatura da sessao admin.
- `LIMITS_PANEL_AGENT_SECRET`: bearer token para heartbeats de agentes.
- `DEEPSEEK_API_KEY`: chave usada para consultar saldo DeepSeek.

Arquivos locais usados pelo painel:

- `config/machines.json`: cadastro de maquinas.
- `config/projects.json`: cadastro de projetos/servicos.
- `config/admin-secret.json`: fallback local para senha/segredo admin.
- `config/gemini-agent-secret.json`: segredo opcional para tarefas Gemini internas.
- `data/agent-heartbeats.json`: ultimos heartbeats recebidos.
- `data/gemini-backups/`: backups das credenciais Gemini antes de novo login.

## Build

```bash
npm run build
```

O build gera `dist/`, usado pelo servidor estatico iniciado por `node server.js`.
