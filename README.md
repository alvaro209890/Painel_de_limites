# Painel de Limites do Codex

Dashboard local para acompanhar limites de uso do Codex (janela de 5h, janela semanal, créditos), métricas locais por modelo, saldo do DeepSeek e métricas da máquina (CPU, RAM, disco, temperatura).

**URL pública:** https://limites.cursar.space/

---

## Funcionalidades

### 🧭 Central DevOps Pessoal
- **Módulo Máquinas:** PC servidor com métricas locais reais e PCs remotos via `limits-agent`/heartbeat; novas máquinas são auto-registradas no primeiro envio.
- **Módulo IA:** OpenAI/Codex CLI, Hermes OpenAI Codex, DeepSeek e métricas locais por modelo.
- **Módulo Contas Codex/Hermes:** mostra a conta usada pelo Hermes (`~/.hermes/auth.json`) separada da conta do Codex CLI (`~/.codex/auth.json`), além de login CLI, perfis salvos, ativação de contas com backup e rotação automática da CLI.
- **Módulo Projetos:** serviços, portas, healthchecks, deploy target e links públicos.
- **Módulo Alertas:** disco cheio, saldo baixo, limite de IA alto, PC offline e serviço caído.
- **Login admin global:** dados sensíveis não são carregados sem autenticação.

### 📊 Módulo IA / Codex
- Limite da janela **principal** (5 horas) — percentual usado e restante
- Limite da **janela secundária** (semanal) — percentual usado e restante
- Status de créditos e balance
- Lista de sessões recentes (últimas threads)
- Métricas de uso por modelo (tokens, threads)
- Atualização automática a cada 60 segundos

### 📈 Módulo Máquinas
- **CPU:** modelo, núcleos, uso percentual, load average
- **RAM:** total, usado, livre
- **Disco:** dispositivos, tamanho, uso
- **Temperatura:** sensores disponíveis
- **Uptime** do servidor

### 🚀 Módulo Projetos
- Status por PM2 e/ou HTTP healthcheck
- Porta local, link público e destino de deploy
- Configuração em `config/projects.json`

### 🚨 Módulo Alertas
- PCs offline
- Discos acima de 80%/90%
- Saldo DeepSeek baixo
- Limite principal Codex acima de 95%
- Projetos offline

---

## Rotas da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/health` | Health check público |
| `GET` | `/api/dashboard` | Payload agregado dos módulos *(admin)* |
| `GET` | `/api/machines` | Máquinas cadastradas e métricas *(admin)* |
| `GET` | `/api/projects` | Serviços/projetos e status *(admin)* |
| `GET` | `/api/alerts` | Alertas derivados *(admin)* |
| `GET` | `/api/limits` | Limites Codex (wham API + SQLite local) *(admin)* |
| `GET` | `/api/pc-metrics` | Métricas do servidor (CPU, RAM, disco, temp) *(admin)* |
| `POST` | `/api/agent/heartbeat` | Heartbeat de métricas de PCs remotos via `limits-agent` *(agent secret)* |
| `GET` | `/api/deepseek` | Saldo da DeepSeek *(admin)* |
| `GET` | `/api/codex-profiles/status` | Status de autenticação admin |
| `POST` | `/api/codex-profiles/login` | Autenticar como admin |
| `POST` | `/api/codex-profiles/logout` | Deslogar admin |
| `GET` | `/api/codex-profiles` | Lista perfis salvos *(admin)* |
| `POST` | `/api/codex-profiles/save-current` | Salvar conta ativa como perfil *(admin)* |
| `POST` | `/api/codex-profiles/:slug/activate` | Ativar um perfil salvo *(admin)* |
| `DELETE` | `/api/codex-profiles/:slug` | Deletar um perfil *(admin)* |
| `GET` | `/api/codex-login/status` | Status do processo de login Codex CLI *(admin)* |
| `POST` | `/api/codex-login/start` | Iniciar login Codex CLI pelo painel *(admin)* |
| `POST` | `/api/codex-login/cancel` | Cancelar login em andamento *(admin)* |
| `GET` | `/api/codex-rotation` | Status/config/eventos da rotação automática *(admin)* |
| `POST` | `/api/codex-rotation/config` | Atualizar configuração da rotação automática *(admin)* |
| `POST` | `/api/codex-rotation/run-once` | Executar teste ou rotação manual *(admin)* |
| `POST` | `/api/llm-route` | Rota local para automações: GPT-5.5 Medium via Hermes Codex + fallback DeepSeek v4 Pro *(agent secret)* |

---

## Como rodar

### Desenvolvimento

```bash
# Terminal 1 — API
npm run api

# Terminal 2 — Frontend (Vite dev server)
npm run dev -- --host 127.0.0.1
```

Abra http://127.0.0.1:5173

### Produção (PM2)

```bash
# Build + start via PM2
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

O servidor API roda na porta **8787**.
O frontend estático (Vite build) roda na porta **4173**.

### Tunnel Cloudflare

```bash
cloudflared tunnel --url http://127.0.0.1:4173
```

Ou use um tunnel persistente apontando para o domínio `limites.cursar.space`.

---

## De onde vêm os dados

- **Limites Codex:** `~/.codex/auth.json` + endpoint interno `https://chatgpt.com/backend-api/wham/usage`
- **Métricas locais:** `~/.codex/state_5.sqlite`, tabela `threads`
- **Saldo DeepSeek:** `https://api.deepseek.com/v1/user/balance` (lê chave de `~/.hermes/.env`)
- **Métricas do PC servidor:** `/proc/stat`, `sensors`, `df`, `os` do Node.js
- **Métricas de PCs remotos:** `agent/limits-agent.py` envia `POST /api/agent/heartbeat`; últimos heartbeats ficam em `~/.config/codex-profiles/agents-heartbeats.json`
- **Máquinas:** `config/machines.json` + auto-registro quando um `machine_id` novo envia heartbeat
- **Projetos:** `config/projects.json` + `pm2 jlist` + HTTP healthcheck

---

## Configuração de máquinas

Arquivo: `config/machines.json`

```json
[
  { "id": "pc-servidor", "name": "PC servidor", "role": "server", "hostname": "server-desktop" }
]
```

- `role: "server"` coleta métricas locais da máquina onde o Painel roda.
- PCs remotos não precisam ser cadastrados antes: instale o `limits-agent` no outro Linux e o servidor cria a entrada automaticamente no primeiro heartbeat.
- Evite placeholders offline; eles poluem o painel.

### Instalar métricas em outro PC Linux

No outro PC Linux, rode:

```bash
curl -fsSL https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/scripts/install-linux-agent.sh | bash
```

Ou com parâmetros:

```bash
export LIMITS_PANEL_AGENT_SECRET='SEU_TOKEN_LIMITS_PANEL_AGENT_SECRET'
curl -fsSL https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/scripts/install-linux-agent.sh \
  | bash -s -- --machine-id notebook-casa --interval 60
unset LIMITS_PANEL_AGENT_SECRET
```

Documentação completa: [`docs/agent-setup.md`](docs/agent-setup.md).

## Configuração de projetos

Arquivo: `config/projects.json`

```json
[
  {
    "id": "painel-limites",
    "name": "Painel de Limites",
    "kind": "pm2",
    "pm2Name": "painel-limites",
    "port": 4173,
    "healthUrl": "http://127.0.0.1:4173/api/health",
    "publicUrl": "https://limites.cursar.space/",
    "deployTarget": "PM2 + Cloudflare Tunnel"
  }
]
```

Campos principais:
- `kind`: `pm2`, `http` ou `manual`
- `pm2Name`: nome do processo no PM2
- `healthUrl`: URL usada para confirmar se está online
- `publicUrl`: link exibido no painel

## Alertas automáticos

- Disco warning: >= 80%
- Disco crítico: >= 90%
- DeepSeek warning: <= US$ 1
- DeepSeek crítico: <= US$ 0.10
- Codex warning: janela principal >= 95%
- Codex crítico: janela principal >= 99%
- PC offline: warning
- Projeto offline: crítico

---

## Gerenciamento de contas Codex

### Caminhos usados

| Caminho | Descrição |
|---------|-----------|
| `~/.codex/auth.json` | Conta ativa (usada pelo Codex CLI) |
| `~/.config/codex-profiles/profiles/<slug>/auth.json` | Perfis salvos |
| `~/.config/codex-profiles/backups/` | Backups automáticos |
| `~/.config/codex-profiles/admin-secret.json` | Senha admin local |
| `~/.config/codex-profiles/rotation-config.json` | Configuração da rotação automática |
| `~/.config/codex-profiles/rotation-events.jsonl` | Log de eventos da rotação |

### Fluxo recomendado

1. Entre como admin na aba "Contas Codex" usando a senha
2. Clique em **"Iniciar login Codex"**
3. Abra o link/código retornado pelo CLI
4. Depois do login, salve a conta ativa como perfil ("Salvar como perfil")
5. Use **"Ativar"** em um perfil salvo para copiar o `auth.json` dele para `~/.codex/auth.json`
6. Opcional: ative **Rotação automática** para o backend alternar contas quando detectar limite esgotado


### Rotação automática de contas

A rotação automática roda no backend/PM2 e não depende do navegador aberto. Quando a conta ativa aparece bloqueada, não permitida, ou com janela de uso acima do limite configurado, o painel testa os perfis salvos e ativa o primeiro que ainda tiver limite disponível.

Configuração padrão:

```json
{
  "enabled": false,
  "intervalSeconds": 60,
  "cooldownSeconds": 300,
  "thresholdUsedPercent": 99.5,
  "notifyOnly": false,
  "preferredOrder": [],
  "skipSlugs": []
}
```

Documentação completa: [`docs/codex-auto-rotation.md`](docs/codex-auto-rotation.md).

## Roteamento local de LLM

Automações locais podem consultar `POST /api/llm-route` para usar GPT-5.5 Medium via Hermes OpenAI Codex quando houver limite disponível, com fallback automático para DeepSeek v4 Pro. A rota é protegida por `LIMITS_PANEL_AGENT_SECRET` e documentada em [`docs/llm-routing.md`](docs/llm-routing.md).

## Variáveis principais

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `LIMITS_PANEL_PORT` | Porta da API | `8787` |
| `LIMITS_PANEL_SITE_PORT` | Porta do site estático | `4173` |
| `LIMITS_PANEL_ADMIN_PASSWORD` | Senha admin do painel | lê de `admin-secret.json` |
| `LIMITS_PANEL_SESSION_SECRET` | Segredo para cookie de sessão | geração aleatória |
| `CODEX_PROFILES_ROOT` | Raiz para perfis/backups | `~/.config/codex-profiles` |
| `CODEX_AUTH_PATH` | Caminho do auth.json | `~/.codex/auth.json` |
| `CODEX_STATE_PATH` | Caminho do state SQLite | `~/.codex/state_5.sqlite` |

---

## Segurança

- Nunca commitar `auth.json`, `admin-secret.json` ou `.env`
- Senha admin forte (recomendado usar env var em vez de arquivo)
- Respostas da API nunca expõem access_token, refresh_token ou auth.json bruto
- E-mails são mascarados antes de sair da API
- Painel marcado como `noindex,nofollow` no HTML
- Opcional: proteger o domínio com Cloudflare Access

---

## Scripts npm

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Vite dev server |
| `npm run api` | API server (Express) |
| `npm run build` | Build TypeScript + Vite |
| `npm run serve` | Build + API server |
| `npm run dev:all` | API + Vite simultâneos |

---

## Stack

- **Frontend:** React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4
- **Backend:** Express 5 + better-sqlite3
- **Deploy:** PM2 + Cloudflare Tunnel
