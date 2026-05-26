# Arquitetura

Este projeto começou como um painel de limites do Codex e foi expandido para uma **Central DevOps Pessoal / Central IA** com **agentes remotos** para monitorar múltiplos PCs.

## Visão geral

- **Frontend:** React + TypeScript + Vite + Tailwind CSS v4.
- **Backend:** Express em `server.js`.
- **Persistência local:** arquivos JSON seguros em `~/.config/codex-profiles` e leitura de SQLite do Codex CLI.
- **Deploy local:** PM2.
- **Exposição pública:** Cloudflare Tunnel apontando para o site estático do backend.
- **Rede remota:** Tailscale (WireGuard) para SSH em PCs Windows/Linux remotos.
- **Agentes:** `agent/limits-agent.py` — script Python 3 cross-platform (stdlib).

## Processo Node

O mesmo `server.js` inicia dois servidores:

- API em `LIMITS_PANEL_PORT` — padrão `8787`.
- site estático/proxy em `LIMITS_PANEL_SITE_PORT` — padrão `4173`.

O site estático serve `dist/` e faz proxy para `/api/*` preservando headers necessários para autenticação e proteção de origem.

## Agentes remotos (limits-agent)

### Arquitetura

```
┌─────────────────────────┐   POST /api/agent/heartbeat   ┌──────────────────────┐
│  PC Windows/Linux       │  ──────────────────────────>  │  Servidor Central    │
│  limits-agent.py ───────│  { machineId, metrics,        │  server.js            │
│  a cada N segundos      │    hostname, agentVersion }   │  ├── agentHeartbeats  │
│                         │  Authorization: Bearer token  │  └── collectMachines()│
└─────────────────────────┘                               └──────────┬───────────┘
                                                                     │
                                                          ┌──────────▼───────────┐
                                                          │  Painel Web          │
                                                          │  /api/machines       │
                                                          │  mostra online/      │
                                                          │  offline + métricas  │
                                                          └──────────────────────┘
```

### Cross-platform

O mesmo script `agent/limits-agent.py` roda em **Linux** e **Windows** sem dependências (stdlib Python 3):

| Métrica | Linux | Windows |
|---------|-------|---------|
| CPU | `/proc/stat` | `wmic cpu get loadpercentage` |
| CPU info | `/proc/cpuinfo` | `wmic cpu get name,NumberOfCores` |
| RAM | `/proc/meminfo` | `wmic OS get TotalVisibleMemorySize,FreePhysicalMemory` |
| Disco | `df -B1` | PowerShell `Get-CimInstance Win32_LogicalDisk` |
| Temperatura | `/sys/class/thermal` + `sensors` | WMI `MSAcpi_ThermalZoneTemperature` |
| Uptime | `/proc/uptime` | `wmic OS get LastBootUpTime` |

### Auto-registro

Se um agent se conectar com `machine_id` desconhecido, o servidor cria
automaticamente uma entrada em `config/machines.json`. O nome pode ser
editado pelo painel (botão ✎).

### Instalação como serviço

| SO | Comando | Tecnologia |
|----|---------|------------|
| Linux | `sudo limits-agent --install` | systemd service |
| Windows | `limits-agent --install` (Admin) | Scheduled Task (ONLOGON) |
| Windows (rápido) | `limits-agent --run` | `pythonw.exe` background |

## Tailscale — acesso remoto aos PCs

Todas as máquinas com limits-agent podem ser acessadas via SSH
através da rede Tailscale (WireGuard):

```
Servidor (server-desktop)    100.65.138.58
PC Trabalho (PCQUE001IMAP)   100.102.60.73  ← Windows + WSL
```

Benefícios:
- **SSH direto** pelo IP Tailscale (sem porta exposta)
- **Criptografia ponta-a-ponta** (WireGuard)
- **Zero configuração** de firewall/NAT
- **Cliente grátis** para Windows, Linux, macOS, iOS, Android

## Máquinas

Fonte principal: `config/machines.json`.

- `role: "server"` representa a máquina local onde o painel roda.
- A máquina local coleta CPU, RAM, disco, temperatura e uptime **sem agent**.
- PCs remotos usam `limits-agent` para enviar métricas (`agent: true`).
- Heartbeats expiram após 120s sem atualização (configurável via `LIMITS_PANEL_AGENT_TTL_MS`).
- O nome da máquina pode ser renomeado pelo painel (endpoint `POST /api/machines/:id/rename`).

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
- ativar perfil salvo no credential pool do Hermes com backup automático;
- consultar limite disponível de cada perfil salvo antes da ativação;
- excluir perfil;
- configurar e executar rotação automática para o Hermes `openai-codex`.

Importante: a rotação altera `~/.hermes/auth.json` no `credential_pool.openai-codex`. Ela não altera `~/.codex/auth.json`, que continua sendo apenas a conta do Codex CLI standalone.

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
- Heartbeat do agent usa `Authorization: Bearer <token>` com comparação timing-safe.
- Rede Tailscale é criptografada (WireGuard), sem portas expostas na internet.

## Arquivos principais

- `server.js`: API, autenticação, coleta de métricas, rotação, servidor estático e heartbeat agents.
- `agent/limits-agent.py`: script cross-platform Python 3 para coleta remota de métricas.
- `src/App.tsx`: layout principal, login admin e navegação por abas.
- `src/modules/*`: módulos visuais da Central.
- `src/modules/machines/MachinesModule.tsx`: cards de máquinas com rename inline e badge `agent remoto`.
- `src/types/dashboard.ts`: contratos TypeScript da API.
- `src/api/client.ts`: helper de fetch com cookies, header `x-admin-action` e helper `renameMachine()`.
- `config/*.example.json`: exemplos versionáveis de configuração local.
- `docs/codex-auto-rotation.md`: detalhes da rotação automática.
- `docs/operations.md`: runbook de operação/deploy.
- `docs/agent-setup.md`: guia de instalação do limits-agent (Linux, Windows, WSL).

## Próximos passos previstos

- Histórico de heartbeats no banco (para gráficos de CPU/RAM ao longo do tempo).
- Webhooks para Telegram quando PC ficar offline ou limite estourar.
- Separação futura do backend em módulos/rotas menores.
