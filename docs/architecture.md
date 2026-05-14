# Arquitetura

Este projeto começou como um painel de limites do Codex e foi expandido para uma **Central DevOps Pessoal / Central IA**.

## Visão geral

- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4.
- **Backend:** Express em `server.js`.
- **Persistência local:** arquivos JSON seguros em `~/.config/codex-profiles` e leitura de SQLite do Codex CLI.
- **Deploy local:** PM2.
- **Exposição pública:** Cloudflare Tunnel apontando para o site estático do backend.

## Processo Node

O mesmo `server.js` inicia dois servidores:

- API em `LIMITS_PANEL_PORT` — padrão `8787`.
- site estático/proxy em `LIMITS_PANEL_SITE_PORT` — padrão `4173`.

O site estático serve `dist/` e faz proxy para `/api/*` preservando headers necessários para autenticação e proteção de origem.

## Módulos do painel

### Máquinas

Fonte principal: `config/machines.json`.

- `role: "server"` representa a máquina local onde o painel roda.
- A máquina local coleta CPU, RAM, disco, temperatura e uptime.
- PCs remotos ficam como offline até existir um agent/heartbeat.

Arquivos exemplo:

- `config/machines.example.json`

### IA

Fontes:

- Codex CLI: `~/.codex/auth.json` + API interna `wham/usage`.
- Hermes: `~/.hermes/auth.json`, `credential_pool.openai-codex`.
- Métricas locais do Codex CLI: `~/.codex/state_5.sqlite`.
- DeepSeek: `~/.hermes/.env` ou `DEEPSEEK_API_KEY`.

A UI separa explicitamente:

- **Hermes / este assistente:** credencial usada pelo Hermes.
- **Codex CLI:** credencial usada pela ferramenta `codex` local.

### Contas Codex / Hermes

A aba de contas mostra a credencial Hermes em destaque e mantém as ferramentas de gerenciamento do Codex CLI separadas:

- login Codex CLI por device flow;
- salvar a conta atual da CLI como perfil;
- ativar perfil salvo com backup automático;
- excluir perfil;
- configurar e executar rotação automática da CLI.

Importante: a rotação altera `~/.codex/auth.json`; ela não altera automaticamente `~/.hermes/auth.json`.

### Projetos

Fonte principal: `config/projects.json`.

Cada projeto pode ter:

- `kind`: `pm2`, `http` ou `manual`;
- `pm2Name`: nome do processo PM2;
- `port`: porta local;
- `healthUrl`: URL usada no healthcheck;
- `publicUrl`: link exibido no painel;
- `deployTarget`: descrição do deploy.

Arquivo exemplo:

- `config/projects.example.json`

### Alertas

Alertas são derivados em memória a cada chamada do dashboard:

- PC offline;
- disco acima de 80% ou 90%;
- DeepSeek com saldo baixo;
- Codex com janela principal acima de 95% ou 99%;
- projeto offline.

## Segurança

- Apenas `/api/health` é público.
- Endpoints sensíveis exigem sessão admin.
- Ações destrutivas/sensíveis exigem também o header `x-admin-action: 1`.
- Cookies admin são `HttpOnly`, `SameSite=Lax` e `Secure` quando o request vem por HTTPS/domínio público.
- E-mails são mascarados antes de ir ao frontend.
- Tokens, refresh tokens, `auth.json` bruto e chaves de API nunca são enviados ao navegador.
- Configs reais em `config/*.json` são ignorados pelo Git; apenas `*.example.json` deve ser commitado.

## Arquivos principais

- `server.js`: API, autenticação, coleta de métricas, rotação e servidor estático.
- `src/App.tsx`: layout principal, login admin e navegação por abas.
- `src/modules/*`: módulos visuais da Central.
- `src/types/dashboard.ts`: contratos TypeScript da API.
- `src/api/client.ts`: helper de fetch com cookies e header de ações admin.
- `config/*.example.json`: exemplos versionáveis de configuração local.
- `docs/codex-auto-rotation.md`: detalhes da rotação automática.
- `docs/operations.md`: runbook de operação/deploy.

## Próximos passos previstos

- Agent leve para PCs remotos enviarem heartbeat/métricas.
- Persistência histórica dos alertas.
- Webhooks para Telegram quando serviço cair ou limite estourar.
- Separação futura do backend em módulos/rotas menores.
