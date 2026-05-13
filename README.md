# Painel de Limites do Codex

Dashboard local para acompanhar limites de uso do Codex (janela de 5h, janela semanal, créditos), métricas locais por modelo, saldo do DeepSeek e métricas da máquina (CPU, RAM, disco, temperatura).

**URL pública:** https://limites.cursar.space/

---

## Funcionalidades

### 📊 Aba Codex (Limites da conta OpenAI Codex)
- Limite da janela **principal** (5 horas) — percentual usado e restante
- Limite da **janela secundária** (semanal) — percentual usado e restante
- Status de créditos e balance
- Lista de sessões recentes (últimas threads)
- Métricas de uso por modelo (tokens, threads)
- Atualização automática a cada 60 segundos

### ⚙️ Aba Contas Codex (Gerenciamento de perfis)
- Sistema de perfis para múltiplas contas Codex
- Salvar a conta atualmente logada como um perfil
- Ativar um perfil salvo (copia auth.json)
- Deletar perfis
- Login direto pelo navegador via Codex CLI
- Backup automático do auth.json antes de trocar de conta
- Rotação automática entre contas quando o limite da janela principal/semanal esgota
- Proteção por senha admin local

### 📈 Aba Métricas do PC
- **CPU:** modelo, núcleos, uso percentual, load average
- **RAM:** total, usado, livre
- **Disco:** dispositivos, tamanho, uso
- **Temperatura:** sensores disponíveis
- **Uptime** do servidor

### 🤖 Aba DeepSeek
- Saldo atual da conta DeepSeek
- Breakdown: saldo concedido vs. creditado
- Status de disponibilidade
- Lê a chave do `.env` do Hermes Agent

---

## Rotas da API

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/limits` | Limites Codex (wham API + SQLite local) |
| `GET` | `/api/pc-metrics` | Métricas do servidor (CPU, RAM, disco, temp) |
| `GET` | `/api/deepseek` | Saldo da DeepSeek |
| `GET` | `/api/codex-profiles` | Lista perfis salvos |
| `POST` | `/api/codex-profiles/login` | Autenticar como admin |
| `POST` | `/api/codex-profiles/logout` | Deslogar admin |
| `POST` | `/api/codex-profiles/save-current` | Salvar conta ativa como perfil |
| `POST` | `/api/codex-profiles/:slug/activate` | Ativar um perfil salvo |
| `DELETE` | `/api/codex-profiles/:slug` | Deletar um perfil |
| `GET` | `/api/codex-login/status` | Status do processo de login Codex CLI |
| `POST` | `/api/codex-login/start` | Iniciar login Codex CLI pelo painel |
| `POST` | `/api/codex-login/cancel` | Cancelar login em andamento |
| `GET` | `/api/codex-rotation` | Status/config/eventos da rotação automática |
| `POST` | `/api/codex-rotation/config` | Atualizar configuração da rotação automática |
| `POST` | `/api/codex-rotation/run-once` | Executar teste ou rotação manual |

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
- **Métricas do PC:** `/proc/stat`, `sensors`, `df`, `os` do Node.js

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

### Variáveis de ambiente

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
