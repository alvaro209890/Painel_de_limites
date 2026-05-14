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
- **Linux:** `/proc`, `df` e (opcional) `sensors` para temperatura
- **Windows:** Python 3 instalado + permissão de Administrador para `--install`
- Acesso HTTP ao servidor do Painel

---

## Instalação no Windows (PC com Windows)

### Pré-requisito: instalar Python 3

Se não tiver Python instalado, baixe do site oficial:
https://www.python.org/downloads/

**Importante:** na instalação, marque **"Add Python to PATH"**.

Para verificar se instalou certo, abra o **PowerShell** e digite:
```powershell
python --version
```

### Setup automático (recomendado)

Abra o **PowerShell como Administrador** (clique direito → Executar como administrador):

```powershell
# 1. Baixar o script
curl.exe -sSLo $env:USERPROFILE\limits-agent.py `
  https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py

# 2. Configurar (assistente interativo)
python $env:USERPROFILE\limits-agent.py --setup

# 3. Instalar como serviço (Scheduled Task — auto-start ao logar)
python $env:USERPROFILE\limits-agent.py --install
```

O PowerShell vai perguntar a URL, o ID da máquina e o token. Depois disso o agent já começa a rodar e vai iniciar automaticamente sempre que você ligar o PC e logar.

### Setup via flags (uma linha)

Se já sabe os parâmetros:
```powershell
python $env:USERPROFILE\limits-agent.py --server-url https://limites.cursar.space `
                                        --machine-id pc-trabalho `
                                        --secret SEU_TOKEN
python $env:USERPROFILE\limits-agent.py --install
```

### Opcional: manter o script em um local fixo

Depois de testar, mova o script para uma pasta de programas:
```powershell
move $env:USERPROFILE\limits-agent.py C:\ProgramData\limits-agent.py
# E use o caminho novo nos comandos:
python "C:\ProgramData\limits-agent.py" --setup
```

### Verificar se está rodando

```powershell
python $env:USERPROFILE\limits-agent.py --status
```

Deve mostrar o status "Ready" ou "Running" na Scheduled Task.

### Parar / remover

```powershell
# PowerShell como Administrador
python $env:USERPROFILE\limits-agent.py --uninstall
```

---

## Instalação no WSL (Windows Subsystem for Linux)

Se o PC Windows tiver WSL, instalar o agent **dentro do WSL** é mais
robusto que a Scheduled Task. O agent ganha systemd nativo.

### Pelo PowerShell (uma linha no WSL)

```powershell
wsl -d Ubuntu -e bash -c "
sudo curl -sSLo /usr/local/bin/limits-agent \
  https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
sudo chmod +x /usr/local/bin/limits-agent
limits-agent --setup
sudo limits-agent --install
"
```

O assistente `--setup` vai pedir os mesmos dados (URL, ID, token).

### Entrando direto no WSL

```powershell
wsl -d Ubuntu
```

Dentro do WSL (bash):

```bash
sudo curl -sSLo /usr/local/bin/limits-agent \
  https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
sudo chmod +x /usr/local/bin/limits-agent
limits-agent --setup
sudo limits-agent --install
```

### Vantagens do WSL vs Windows puro

| Aspecto | WSL (recomendado) | Windows puro |
|---------|-------------------|--------------|
| Serviço | systemd (nativo) | Scheduled Task |
| Auto-restart | `Restart=always` | Precisa de script |
| Logs | `journalctl -u limits-agent` | Sem logs fáceis |
| Atualizar | `sudo limits-agent --install` | Re-baixar script |
| Acesso remoto | SSH via Tailscale direto | PowerShell remoto |

---

## Tailscale — acesso remoto ao PC

Com Tailscale, você consegue acessar o PC remoto por SSH de qualquer
lugar, sem precisar de IP público ou configuração de roteador.

### Verificar se Tailscale está instalado

```bash
tailscale status
```

### Acessar o PC remoto via SSH

```bash
ssh usuario@100.102.60.73
```

Substitua `usuario` pelo nome de usuário do PC remoto e o IP pelo IP
Tailscale da máquina (aparece em `tailscale status`).

### Instalar Tailscale (se não tiver)

**Linux:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

**Windows:** Baixe de https://tailscale.com/download e faça login
com a mesma conta Google/Microsoft do servidor.

---

## Rodar sem instalar (--run)

Útil para testar rapidamente ou quando não quer criar um serviço permanente.
Usa `pythonw.exe` no Windows (sem console) e `nohup` no Linux.

**Windows:**
```powershell
python $env:USERPROFILE\limits-agent.py --run
```
O processo roda invisível em background. Pode fechar o PowerShell.
Para parar: Gerenciador de Tarefas → encerrar `pythonw.exe`.

**Linux:**
```bash
nohup /usr/local/bin/limits-agent --run &
```

---

## Instalação no Linux

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
| `limits-agent --run` | Roda em background (Windows: pythonw, Linux: nohup) |
| `limits-agent --uninstall` | Para e remove o serviço |
| `limits-agent --install` | Cria e ativa serviço (sudo no Linux, Admin no Windows) |
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

| `\` | Caractere de continuação de linha no PowerShell (substitui `\` do bash) |

## Troubleshooting

| Problema | Causa provável | Solução |
|----------|----------------|---------|
| `HTTP 503` | `AGENT_SECRET` não configurado no servidor | Definir env var e reiniciar PM2 |
| `HTTP 401` | Token não confere | Verificar `agent_secret` nos dois lados |
| `HTTP 400` | Payload inválido | Verificar `machine_id` e `metrics` |
| Conexão recusada | Servidor/Cloudflare Tunnel offline | Verificar `pm2 status` e tunnel |
| Sem heartbeat no painel | TTL de 120s expirou | Verificar se agent está rodando |
| `sensors` sem dados (Linux) | Pacote lm-sensors não instalado | `sudo apt install lm-sensors` (opcional) |
| `'python' não encontrado` (Windows) | Python não está no PATH | Reinstalar Python marcando "Add to PATH" |
| `Acesso negado` (Windows) | PowerShell sem Admin | Fechar e abrir como Administrador |
| Scheduled Task não inicia (Windows) | Task agendada desabilitada | `schtasks /Change /TN "LimitsAgent" /ENABLE` |
| Erro `403` no heartbeat (Windows) | Firewall/Proxy bloqueando saída | Verificar conectividade com `curl.exe`
