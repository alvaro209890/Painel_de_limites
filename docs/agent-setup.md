# limits-agent — Agente de métricas remotas

Coleta métricas de CPU, RAM, disco e temperatura de um PC remoto e
envia periodicamente para o servidor do Painel de Limites.

## Arquitetura

```
┌──────────────────────┐      POST /api/agent/heartbeat      ┌────────────────────┐
│  PC Trabalho         │  ──────────────────────────────────  │  Servidor Central  │
│  limits-agent.py ────│  { machineId, metrics, hostname }   │  server.js         │
│  a cada 60s          │  Authorization: Bearer <secret>     │  ├── agentHeartbeats│
└──────────────────────┘                                      │  └── collectMacines │
                                                              │       ↓             │
                                                              │  /api/machines      │
                                                              │  + agent: true      │
                                                              └────────────────────┘
```

## Dependências

- **Python 3** (stdlib apenas — sem pip necessário)
- **Linux** com `/proc`, `df` e (opcional) `sensors` para temperatura
- Acesso HTTP ao servidor do Painel

## Instalação no PC remoto

### Setup automático (recomendado)

Antes de tudo, o servidor precisa ter o token configurado
(`LIMITS_PANEL_AGENT_SECRET`). Se já está configurado, vá direto
para o PC remoto.

No PC remoto, execute:

```bash
# 1. Baixar o script
sudo curl -sSLo /usr/local/bin/limits-agent \
  https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
sudo chmod +x /usr/local/bin/limits-agent

# 2. Configurar (assistente interativo — pergunta URL, ID e token)
limits-agent --setup

# 3. Instalar como serviço (auto-start na inicialização)
sudo limits-agent --install
```

Pronto. O agent já vai estar rodando e vai iniciar automaticamente
toda vez que o PC ligar.

> **Auto-registro:** se o `machine_id` não existir em `config/machines.json`,
> o servidor cria uma entrada automaticamente no primeiro heartbeat.
> Depois é só renomear do painel (botão ✎ ao lado do nome).

### Setup via flags (uma linha)

Se já sabe os parâmetros, pode configurar de uma vez:

```bash
sudo curl -sSLo /usr/local/bin/limits-agent \
  https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
sudo chmod +x /usr/local/bin/limits-agent

# Cria config + já instala serviço
limits-agent --server-url https://limites.cursar.space \
             --machine-id pc-trabalho \
             --secret SEU_TOKEN \
  && sudo limits-agent --install
```

### Setup manual (alternativa)

Se preferir configurar manualmente, primeiro configure o servidor:

```bash
# Editar ~/.hermes/.env ou o ambiente do PM2
echo 'LIMITS_PANEL_AGENT_SECRET=uma_senha_forte_aqui' >> /path/to/.env

# Se usar PM2 com ecosystem.config.cjs, adicione em env:
# LIMITS_PANEL_AGENT_SECRET: "uma_senha_forte_aqui"

pm2 restart painel-limites
```

Testar se o endpoint está acessível:

```bash
curl -sS https://limites.cursar.space/api/health
```

### 2. Copiar o script para o PC remoto

```bash
# Opção A — copiar via scp do servidor
scp /caminho/no/servidor/agent/limits-agent.py usuario@pc-trabalho:/tmp/

# Opção B — baixar direto do GitHub no PC remoto
curl -sSLO https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
```

### 3. Mover para diretório acessível

```bash
sudo mv limits-agent.py /usr/local/bin/limits-agent
sudo chmod +x /usr/local/bin/limits-agent
```

### 4. Criar config

```bash
mkdir -p ~/.config/limits-agent
```

Crie `~/.config/limits-agent/config.json`:

```json
{
  "server_url": "https://limites.cursar.space",
  "machine_id": "pc-trabalho",
  "agent_secret": "mesma_senha_definida_no_servidor",
  "interval_seconds": 60
}
```

Campos:

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `server_url` | ✅ | URL base do Painel de Limites (com https://) |
| `machine_id` | ✅ | ID da máquina em `config/machines.json` (ex: `pc-trabalho`) |
| `agent_secret` | ✅ | Mesmo valor de `LIMITS_PANEL_AGENT_SECRET` do servidor |
| `interval_seconds` | ❌ | Intervalo entre heartbeats (10-3600, padrão 60) |

### 5. Testar

```bash
/usr/local/bin/limits-agent
```

Deve aparecer:
```
[limits-agent] Iniciando agent para pc-trabalho
[limits-agent] Servidor: https://limites.cursar.space
[limits-agent] Intervalo: 60s
[2026-05-14T18:00:00] ✓ Heartbeat #1 — CPU: 12.5% | RAM: 45% | Uptime: 86,400s
```

Pare com Ctrl+C.

### 6. Instalar como serviço systemd (recomendado)

```bash
sudo tee /etc/systemd/system/limits-agent.service > /dev/null << 'SERVICE'
[Unit]
Description=Limits Agent — métricas do PC para o Painel de Limites
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/limits-agent
Restart=always
RestartSec=10
User=seu_usuario
Group=seu_usuario

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable --now limits-agent
sudo systemctl status limits-agent
```

### 7. Renomear pelo painel

O nome da máquina pode ser editado diretamente no painel:
1. Acesse https://limites.cursar.space → login admin
2. Aba **Máquinas**
3. Clique no ícone **✎** ao lado do nome
4. Digite o novo nome e pressione Enter ou clique ✔

### 8. Auto-registro de novas máquinas

Se um agent se conectar com um `machine_id` que não existe em
`config/machines.json`, o servidor cria uma entrada automaticamente
com um nome gerado a partir do ID. Depois é só renomear pelo painel.

## Atualizar machines.json no servidor (se necessário)

Acesse https://limites.cursar.space → faça login admin →
módulo **Máquinas**. A máquina deve aparecer como `online`
com as métricas do PC remoto.

## Atualizar machines.json no servidor (se necessário)

Se adicionar um novo PC, edite `config/machines.json` no servidor:

```json
{
  "id": "pc-novo",
  "name": "PC novo",
  "role": "work",
  "hostname": null,
  "notes": "Usa limits-agent para enviar métricas"
}
```

E no PC remoto use `"machine_id": "pc-novo"` no config do agent.

## Comandos do agent

| Comando | Descrição |
|---------|-----------|
| `limits-agent` | Modo normal — coleta e envia heartbeats |
| `limits-agent --setup` | Assistente interativo para criar config |
| `limits-agent --status` | Mostra status do serviço e config atual |
| `limits-agent --uninstall` | Para e remove o serviço systemd |
| `limits-agent --install` | Cria e ativa serviço systemd (precisa de sudo) |
| `limits-agent --help` | Mostra todas as opções |

Flags diretas (criam config automaticamente):

| Flag | Exemplo |
|------|---------|
| `--server-url` | `--server-url https://limites.cursar.space` |
| `--machine-id` | `--machine-id pc-trabalho` |
| `--secret` | `--secret MEU_TOKEN_AQUI` |
| `--interval` | `--interval 30` (10-3600s) |

## Logs e diagnóstico

No PC remoto:

```bash
# Ver logs do serviço
sudo journalctl -u limits-agent -f

# Testar manualmente com verbose
/usr/local/bin/limits-agent
```

No servidor:

```bash
# Ver heartbeats recebidos (arquivo JSON)
cat ~/.config/codex-profiles/agents-heartbeats.json

# Ver resposta da API de máquinas (requer cookie admin)
curl -sS https://limites.cursar.space/api/machines -H 'Cookie: limits_admin=...' | jq '.machines[] | {id, status, hostname, agent}'
```

## Troubleshooting

| Problema | Causa provável | Solução |
|----------|----------------|---------|
| `HTTP 503` | `AGENT_SECRET` não configurado no servidor | Definir env var e reiniciar PM2 |
| `HTTP 401` | Token não confere | Verificar `agent_secret` nos dois lados |
| `HTTP 400` | Payload inválido | Verificar `machine_id` e `metrics` |
| Conexão recusada | Servidor/Cloudflare Tunnel offline | Verificar `pm2 status` e tunnel |
| Sem heartbeat no painel | TTL de 120s expirou | Verificar se agent está rodando |
| `sensors` sem dados | Pacote lm-sensors não instalado | `sudo apt install lm-sensors` (opcional) |
