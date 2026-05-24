#!/usr/bin/env bash
# Instala o limits-agent em outro PC Linux para enviar métricas ao Painel de Limites.
# Uso rápido:
#   curl -fsSL https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/scripts/install-linux-agent.sh | bash
#
# Com flags:
#   bash install-linux-agent.sh --machine-id notebook-casa --secret 'TOKEN' --interval 60

set -euo pipefail

DEFAULT_SERVER_URL="https://limites.cursar.space"
DEFAULT_INTERVAL="60"
DEFAULT_AGENT_URL="https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py"
INSTALL_PATH="/usr/local/bin/limits-agent"
CONFIG_DIR="/root/.config/limits-agent"
CONFIG_FILE="${CONFIG_DIR}/config.json"
SERVICE_NAME="limits-agent"

SERVER_URL="${LIMITS_PANEL_URL:-$DEFAULT_SERVER_URL}"
MACHINE_ID="${LIMITS_AGENT_MACHINE_ID:-}"
AGENT_SECRET="${LIMITS_PANEL_AGENT_SECRET:-}"
INTERVAL_SECONDS="${LIMITS_AGENT_INTERVAL:-$DEFAULT_INTERVAL}"
AGENT_URL="$DEFAULT_AGENT_URL"
ASSUME_YES="0"
INSTALL_SERVICE="1"

usage() {
  cat <<'USAGE'
Instala o limits-agent em um PC Linux remoto e registra métricas no Painel de Limites.

Opções:
  --server-url URL       URL do painel (padrão: https://limites.cursar.space)
  --machine-id ID        ID único desta máquina (ex: notebook-casa, pc-trabalho)
  --secret TOKEN         Token LIMITS_PANEL_AGENT_SECRET do servidor
  --interval SEGUNDOS    Intervalo entre heartbeats (padrão: 60)
  --agent-url URL        URL raw do agent Python
  --no-install           Só baixa o agent e grava config; não cria systemd
  -y, --yes              Não pedir confirmação
  -h, --help             Mostrar ajuda

Também aceita variáveis de ambiente:
  LIMITS_PANEL_URL, LIMITS_AGENT_MACHINE_ID, LIMITS_PANEL_AGENT_SECRET, LIMITS_AGENT_INTERVAL

Exemplos:
  curl -fsSL https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/scripts/install-linux-agent.sh | bash

  LIMITS_PANEL_AGENT_SECRET='TOKEN' bash install-linux-agent.sh --machine-id notebook-casa
USAGE
}

slugify_hostname() {
  local raw
  raw="$(hostname -s 2>/dev/null || hostname || echo linux-pc)"
  printf '%s' "$raw" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

ask() {
  local prompt="$1" default_value="${2:-}" value
  if [[ ! -r /dev/tty ]]; then
    printf '%s' "$default_value"
    return
  fi
  if [[ -n "$default_value" ]]; then
    read -r -p "$prompt [$default_value]: " value < /dev/tty
    printf '%s' "${value:-$default_value}"
  else
    read -r -p "$prompt: " value < /dev/tty
    printf '%s' "$value"
  fi
}

ask_secret() {
  local prompt="$1" value
  if [[ ! -r /dev/tty ]]; then
    printf ''
    return
  fi
  read -r -s -p "$prompt: " value < /dev/tty
  printf '\n' > /dev/tty
  printf '%s' "$value"
}

require_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "Erro: este instalador é para Linux. Para Windows/WSL veja docs/agent-setup.md." >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Erro: comando obrigatório não encontrado: $1" >&2
    echo "Instale com: sudo apt-get update && sudo apt-get install -y $1" >&2
    exit 1
  fi
}

run_sudo() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url|--url)
      SERVER_URL="${2:-}"; shift 2 ;;
    --machine-id|--id)
      MACHINE_ID="${2:-}"; shift 2 ;;
    --secret|--token)
      AGENT_SECRET="${2:-}"; shift 2 ;;
    --interval)
      INTERVAL_SECONDS="${2:-}"; shift 2 ;;
    --agent-url)
      AGENT_URL="${2:-}"; shift 2 ;;
    --no-install)
      INSTALL_SERVICE="0"; shift ;;
    -y|--yes)
      ASSUME_YES="1"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Argumento desconhecido: $1" >&2
      usage
      exit 1 ;;
  esac
done

require_linux
require_command python3
require_command curl
if [[ "$INSTALL_SERVICE" == "1" ]]; then
  require_command systemctl
fi
if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  require_command sudo
fi

if [[ -z "$MACHINE_ID" ]]; then
  MACHINE_ID="$(slugify_hostname)"
fi

if [[ "$ASSUME_YES" != "1" ]]; then
  echo ""
  echo "== limits-agent Linux installer =="
  echo "Este PC vai aparecer no Painel de Limites em: $SERVER_URL"
  echo "O machine_id será auto-registrado no primeiro heartbeat."
  echo ""
  SERVER_URL="$(ask 'URL do Painel de Limites' "$SERVER_URL")"
  MACHINE_ID="$(ask 'ID desta máquina' "$MACHINE_ID")"
  INTERVAL_SECONDS="$(ask 'Intervalo entre heartbeats em segundos' "$INTERVAL_SECONDS")"
fi

if [[ -z "$AGENT_SECRET" ]]; then
  AGENT_SECRET="$(ask_secret 'Token LIMITS_PANEL_AGENT_SECRET')"
fi

if [[ -z "$SERVER_URL" || -z "$MACHINE_ID" || -z "$AGENT_SECRET" ]]; then
  echo "Erro: server-url, machine-id e secret são obrigatórios." >&2
  exit 1
fi

if ! [[ "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Erro: --interval precisa ser número." >&2
  exit 1
fi
if (( INTERVAL_SECONDS < 10 || INTERVAL_SECONDS > 3600 )); then
  echo "Erro: --interval precisa ficar entre 10 e 3600." >&2
  exit 1
fi

SERVER_URL="${SERVER_URL%/}"

echo ""
echo "Baixando agent Python..."
run_sudo curl -fsSL --retry 3 --connect-timeout 15 -o "$INSTALL_PATH" "$AGENT_URL"
run_sudo chmod 0755 "$INSTALL_PATH"

echo "Gravando config root-owned em $CONFIG_FILE..."
tmp_config="$(mktemp)"
LIMITS_PANEL_URL="$SERVER_URL" \
LIMITS_AGENT_MACHINE_ID="$MACHINE_ID" \
LIMITS_PANEL_AGENT_SECRET="$AGENT_SECRET" \
LIMITS_AGENT_INTERVAL="$INTERVAL_SECONDS" \
python3 - <<'PY' > "$tmp_config"
import json
import os
payload = {
    "server_url": os.environ["LIMITS_PANEL_URL"].rstrip("/"),
    "machine_id": os.environ["LIMITS_AGENT_MACHINE_ID"],
    "agent_secret": os.environ["LIMITS_PANEL_AGENT_SECRET"],
    "interval_seconds": int(os.environ["LIMITS_AGENT_INTERVAL"]),
}
print(json.dumps(payload, indent=2))
PY
run_sudo mkdir -p "$CONFIG_DIR"
run_sudo install -m 0600 "$tmp_config" "$CONFIG_FILE"
rm -f "$tmp_config"

if [[ "$INSTALL_SERVICE" == "1" ]]; then
  echo "Instalando/iniciando serviço systemd..."
  run_sudo "$INSTALL_PATH" --install
else
  echo "Pulando instalação systemd (--no-install)."
fi

echo ""
echo "✓ limits-agent instalado."
echo "  Painel:     $SERVER_URL"
echo "  Máquina:    $MACHINE_ID"
echo "  Config:     $CONFIG_FILE"
echo "  Serviço:    $SERVICE_NAME"
echo ""
echo "Comandos úteis:"
echo "  sudo systemctl status $SERVICE_NAME --no-pager"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo "  sudo $INSTALL_PATH --status"
echo ""
echo "Depois de 1 heartbeat, abra $SERVER_URL → Máquinas. Se o ID for novo, o servidor cria a máquina automaticamente."
