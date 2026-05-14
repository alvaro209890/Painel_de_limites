#!/usr/bin/env python3
"""
limits-agent — Coleta métricas do PC e envia para o Painel de Limites central.

USO RÁPIDO (primeira vez):
  sudo curl -sSLo /usr/local/bin/limits-agent \
    https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
  sudo chmod +x /usr/local/bin/limits-agent
  limits-agent --setup    ← assistente interativo
  limits-agent --install  ← cria serviço systemd + ativa na inicialização

USO DIRETO:
  limits-agent --server-url https://limites.cursar.space \
               --machine-id pc-trabalho \
               --secret MEU_TOKEN

FLAGS:
  --setup        Assistente interativo para criar config.json
  --install      Cria serviço systemd (auto-start na inicialização)
  --uninstall    Remove o serviço systemd
  --server-url   URL do Painel de Limites (ex: https://limites.cursar.space)
  --machine-id   ID da máquina em config/machines.json
  --secret       Token de autenticação (mesmo do LIMITS_PANEL_AGENT_SECRET)
  --interval     Segundos entre heartbeats (10-3600, padrão 60)
  --status       Mostra status do serviço systemd e últimas execuções

Dependências: Python 3 padrão (stdlib apenas — sem pip necessário)
Requisitos: Linux com /proc, df e (opcional) sensors
"""

import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error

# ─── Config ───────────────────────────────────────────────────────

CONFIG_DIR = os.path.expanduser("~/.config/limits-agent")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
DEFAULT_INTERVAL = 60  # segundos entre heartbeats
REQUEST_TIMEOUT = 15   # segundos timeout HTTP
SERVICE_NAME = "limits-agent"
SERVICE_PATH = f"/etc/systemd/system/{SERVICE_NAME}.service"


def parse_args():
    """Parse CLI flags. Retorna dict com as opções."""
    args = sys.argv[1:]
    flags = {
        "setup": False,
        "install": False,
        "uninstall": False,
        "status": False,
        "server_url": None,
        "machine_id": None,
        "secret": None,
        "interval": None,
    }

    i = 0
    while i < len(args):
        if args[i] in ("--setup", "-s"):
            flags["setup"] = True
        elif args[i] in ("--install", "-i"):
            flags["install"] = True
        elif args[i] in ("--uninstall", "-u"):
            flags["uninstall"] = True
        elif args[i] in ("--status", "-S"):
            flags["status"] = True
        elif args[i] in ("--server-url", "--url"):
            i += 1
            if i < len(args):
                flags["server_url"] = args[i]
            else:
                print("--server-url requer um argumento")
                sys.exit(1)
        elif args[i] in ("--machine-id", "--id"):
            i += 1
            if i < len(args):
                flags["machine_id"] = args[i]
            else:
                print("--machine-id requer um argumento")
                sys.exit(1)
        elif args[i] in ("--secret", "--token"):
            i += 1
            if i < len(args):
                flags["secret"] = args[i]
            else:
                print("--secret requer um argumento")
                sys.exit(1)
        elif args[i] in ("--interval", "--int"):
            i += 1
            if i < len(args):
                try:
                    flags["interval"] = max(10, min(3600, int(args[i])))
                except ValueError:
                    print("--interval deve ser um número entre 10 e 3600")
                    sys.exit(1)
            else:
                print("--interval requer um argumento")
                sys.exit(1)
        elif args[i] in ("--help", "-h"):
            print(__doc__)
            sys.exit(0)
        else:
            print(f"Argumento desconhecido: {args[i]}")
            print("Use --help para ver as opções")
            sys.exit(1)
        i += 1

    return flags


def run_setup_wizard():
    """Assistente interativo para criar config.json."""
    print("╔══════════════════════════════════════════════╗")
    print("║     limits-agent — Assistente de setup      ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    print("Vou criar o arquivo de configuração em:")
    print(f"  {CONFIG_FILE}")
    print()

    server_url = input("URL do Painel de Limites (ex: https://limites.cursar.space): ").strip()
    while not server_url:
        server_url = input("  >> URL é obrigatória: ").strip()

    print()
    print("ID da máquina — deve bater com o id em config/machines.json no servidor.")
    print("Se não existir ainda, pode criar depois. IDs sugeridos:")
    print("  pc-trabalho, pc-reserva, pc-casa, pc-escritorio, notebook-1")
    machine_id = input("ID da máquina: ").strip()
    while not machine_id:
        machine_id = input("  >> ID é obrigatório: ").strip()

    print()
    agent_secret = input("Token secreto (mesmo do LIMITS_PANEL_AGENT_SECRET no servidor): ").strip()
    while not agent_secret:
        agent_secret = input("  >> Token é obrigatório: ").strip()

    print()
    interval_raw = input("Intervalo entre heartbeats em segundos [60]: ").strip()
    try:
        interval = max(10, min(3600, int(interval_raw)))
    except (ValueError, TypeError):
        interval = DEFAULT_INTERVAL

    config = {
        "server_url": server_url.rstrip("/"),
        "machine_id": machine_id,
        "agent_secret": agent_secret,
        "interval_seconds": interval,
    }

    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)
    os.chmod(CONFIG_FILE, 0o600)

    print()
    print("✔ Configuração salva!")
    print()
    print("Para testar:")
    print(f"  {sys.argv[0]}")
    print()
    print("Para instalar como serviço (auto-start na inicialização):")
    print(f"  sudo {sys.argv[0]} --install")


def install_systemd():
    """Cria o serviço systemd para auto-start na inicialização."""
    import getpass

    if os.geteuid() != 0:
        print("❌ --install precisa ser executado como root (sudo)")
        print(f"  sudo {sys.argv[0]} --install")
        sys.exit(1)

    if not os.path.exists(CONFIG_FILE):
        print(f"❌ Config não encontrada em {CONFIG_FILE}")
        print(f"   Rode '{sys.argv[0]} --setup' primeiro")
        sys.exit(1)

    script_path = os.path.abspath(sys.argv[0])

    # Verifica se python3 está acessível
    python_path = shutil.which("python3") or "/usr/bin/python3"

    user = getpass.getuser()

    content = f"""[Unit]
Description=Limits Agent — métricas do PC para o Painel de Limites
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={python_path} {script_path}
Restart=always
RestartSec=10
User={user}
Group={user}

[Install]
WantedBy=multi-user.target
"""

    try:
        with open(SERVICE_PATH, "w") as f:
            f.write(content)
        print(f"✔ Serviço criado em {SERVICE_PATH}")

        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "enable", SERVICE_NAME], check=True)
        subprocess.run(["systemctl", "start", SERVICE_NAME], check=True)

        print()
        print("✔ Serviço instalado e iniciado!")
        print()
        subprocess.run(["systemctl", "status", SERVICE_NAME, "--no-pager"])
    except subprocess.CalledProcessError as e:
        print(f"❌ Erro ao instalar serviço: {e}")
        sys.exit(1)
    except PermissionError:
        print("❌ Permissão negada. Execute com sudo.")
        sys.exit(1)


def uninstall_systemd():
    """Remove o serviço systemd."""
    if os.geteuid() != 0:
        print("❌ --uninstall precisa ser executado como root (sudo)")
        print(f"  sudo {sys.argv[0]} --uninstall")
        sys.exit(1)

    if not os.path.exists(SERVICE_PATH):
        print("Serviço não está instalado.")
        return

    try:
        subprocess.run(["systemctl", "stop", SERVICE_NAME], check=False)
        subprocess.run(["systemctl", "disable", SERVICE_NAME], check=False)
        os.remove(SERVICE_PATH)
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        print(f"✔ Serviço removido de {SERVICE_PATH}")
    except Exception as e:
        print(f"❌ Erro ao remover serviço: {e}")
        sys.exit(1)


def show_status():
    """Mostra status do serviço systemd."""
    if os.path.exists(SERVICE_PATH):
        print("📋 Serviço systemd:")
        subprocess.run(["systemctl", "status", SERVICE_NAME, "--no-pager"])
    else:
        print("ℹ Serviço systemd não instalado.")
        print(f"   Instale com: sudo {sys.argv[0]} --install")

    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            cfg = json.load(f)
        print()
        print("📋 Config atual:")
        safe = {k: v for k, v in cfg.items() if k != "agent_secret"}
        safe["agent_secret"] = cfg.get("agent_secret", "")[:8] + "..." if cfg.get("agent_secret") else None
        print(json.dumps(safe, indent=2))
    else:
        print("📋 Config: não encontrada")
        print(f"   Crie com: {sys.argv[0]} --setup")


def load_config(flags):
    """Carrega config.json OU usa flags diretas."""
    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)

    # Se veio tudo por flags, cria config automaticamente
    if flags["server_url"] and flags["machine_id"] and flags["secret"]:
        config = {
            "server_url": flags["server_url"].rstrip("/"),
            "machine_id": flags["machine_id"],
            "agent_secret": flags["secret"],
            "interval_seconds": flags["interval"] or DEFAULT_INTERVAL,
        }
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2)
        os.chmod(CONFIG_FILE, 0o600)
        print(f"✔ Config salva em {CONFIG_FILE}")
        return config

    # Se não tem config, mostra erro + sugestão
    if not os.path.exists(CONFIG_FILE):
        print(f"❌ Config não encontrada em {CONFIG_FILE}")
        print()
        print("Opção 1 — assistente interativo:")
        print(f"  {sys.argv[0]} --setup")
        print()
        print("Opção 2 — flags diretas (cria config automaticamente):")
        print(f"  {sys.argv[0]} --server-url https://limites.cursar.space \\")
        print(f"                 --machine-id pc-trabalho \\")
        print(f"                 --secret SEU_TOKEN")
        print()
        print("Opção 3 — criar manualmente:")
        print(f"  mkdir -p {CONFIG_DIR}")
        print(f"  nano {CONFIG_FILE}")
        print()
        print("Formato do config.json:")
        print(json.dumps({
            "server_url": "https://limites.cursar.space",
            "machine_id": "pc-trabalho",
            "agent_secret": "TOKEN_DO_SERVIDOR",
            "interval_seconds": DEFAULT_INTERVAL,
        }, indent=2))
        sys.exit(1)

    with open(CONFIG_FILE, "r") as f:
        cfg = json.load(f)

    # Override com flags
    if flags["server_url"]:
        cfg["server_url"] = flags["server_url"].rstrip("/")
    if flags["machine_id"]:
        cfg["machine_id"] = flags["machine_id"]
    if flags["secret"]:
        cfg["agent_secret"] = flags["secret"]
    if flags["interval"]:
        cfg["interval_seconds"] = flags["interval"]

    # Validações
    errors = []
    if not cfg.get("server_url"):
        errors.append("server_url é obrigatório")
    if not cfg.get("machine_id"):
        errors.append("machine_id é obrigatório")
    if not cfg.get("agent_secret"):
        errors.append("agent_secret é obrigatório")

    if errors:
        print(f"❌ Config inválida em {CONFIG_FILE}:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    return cfg


# ─── Coleta de métricas ────────────────────────────────────────────

def safe_shell(cmd, timeout=5):
    """Executa comando shell, retorna stdout ou None."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip() or None
    except Exception:
        return None


def collect_cpu():
    """CPU usage via /proc/stat."""
    try:
        with open("/proc/stat") as f:
            for line in f:
                if line.startswith("cpu "):
                    parts = line.strip().split()
                    values = [int(v) for v in parts[1:]]
                    total = sum(values)
                    idle = values[3] if len(values) > 3 else 0
                    return {"total": total, "idle": idle}
    except Exception:
        return None
    return None


def calc_cpu_percent():
    """Amostra CPU duas vezes com 200ms de intervalo."""
    a = collect_cpu()
    if not a:
        return None
    time.sleep(0.2)
    b = collect_cpu()
    if not b:
        return None
    total_delta = b["total"] - a["total"]
    idle_delta = b["idle"] - a["idle"]
    if total_delta <= 0:
        return 0.0
    return round(((total_delta - idle_delta) / total_delta) * 100, 1)


def collect_memory():
    """RAM via /proc/meminfo."""
    try:
        with open("/proc/meminfo") as f:
            data = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    key = parts[0].strip()
                    val_str = parts[1].strip().split()[0]
                    try:
                        data[key] = int(val_str) * 1024  # kB → bytes
                    except ValueError:
                        pass
        total = data.get("MemTotal", 0)
        free = data.get("MemFree", 0) + data.get("Buffers", 0) + data.get("Cached", 0)
        used = total - free
        if total == 0:
            return None
        return {
            "totalBytes": total,
            "usedBytes": used,
            "freeBytes": free,
            "usedPercent": round((used / total) * 100),
            "totalGb": round(total / 1073741824, 1),
            "usedGb": round(used / 1073741824, 1),
            "freeGb": round(free / 1073741824, 1),
        }
    except Exception:
        return None


def collect_disks():
    """Discos via df."""
    try:
        output = safe_shell(
            "df -B1 --output=source,fstype,size,used,avail,pcent,target 2>/dev/null | tail -n +2"
        )
        if not output:
            return []

        disks = []
        for line in output.split("\n"):
            if not line.strip():
                continue
            pcent_match = __import__("re").search(r"(\S+)\s+(/.*)$", line)
            if not pcent_match:
                continue
            before = line[: pcent_match.start()].strip()
            pcent = pcent_match.group(1)
            mount = pcent_match.group(2).strip()
            cols = before.split()
            if len(cols) < 5:
                continue
            device, fs_type, size_str, used_str, avail_str = cols[:5]

            # Only physical filesystems
            if not __import__("re").match(
                r"^(ext[234]|ntfs|fuseblk|btrfs|xfs|zfs|f2fs|vfat|exfat)$", fs_type
            ):
                continue
            if __import__("re").match(r"^/(proc|sys|dev|run|tmp)\b", mount):
                continue
            if __import__("re").match(r"^/(boot|boot/efi)\b", mount):
                continue

            size_gb = round(int(size_str) / 1073741824, 1)
            used_gb = round(int(used_str) / 1073741824, 1)
            free_gb = round(int(avail_str) / 1073741824, 1)

            # Friendly label
            if mount == "/":
                label = "SSD (sistema)"
            elif "HD Backup" in mount or "hd backup" in mount.lower():
                label = "HDD (Backup)"
            else:
                label = mount.rsplit("/", 1)[-1] or mount

            disks.append({
                "device": device,
                "fsType": fs_type,
                "mount": mount,
                "sizeGb": size_gb,
                "usedGb": used_gb,
                "freeGb": free_gb,
                "percent": f"{pcent}",
                "label": label,
            })

        return disks
    except Exception:
        return []


def collect_temperatures():
    """Temperatura via /sys/class/thermal e sensors."""
    zones = []
    try:
        thermal_dir = "/sys/class/thermal"
        if os.path.isdir(thermal_dir):
            for name in sorted(os.listdir(thermal_dir)):
                if name.startswith("thermal_zone"):
                    type_path = os.path.join(thermal_dir, name, "type")
                    temp_path = os.path.join(thermal_dir, name, "temp")
                    if os.path.exists(type_path) and os.path.exists(temp_path):
                        with open(type_path) as f:
                            ttype = f.read().strip()
                        with open(temp_path) as f:
                            raw = float(f.read().strip())
                        zones.append({
                            "name": ttype or name,
                            "temp": round(raw / 100) / 10,
                        })
    except Exception:
        pass

    sensors_out = safe_shell("sensors -u 2>/dev/null | grep -E '^temp[0-9]+_input' | head -5")
    if sensors_out:
        for line in sensors_out.split("\n"):
            val = line.split(":")[1].strip() if ":" in line else ""
            try:
                t = float(val)
                if t > 0:
                    zones.append({"name": "sensor", "temp": round(t * 10) / 10})
            except ValueError:
                pass

    if not zones:
        return None

    return {
        "max": round(max(z["temp"] for z in zones), 1),
        "sensors": zones,
    }


def collect_cpu_info():
    """Informações da CPU via /proc/cpuinfo."""
    try:
        with open("/proc/cpuinfo") as f:
            content = f.read()
        cores = 0
        model = "desconhecido"
        for line in content.split("\n"):
            if line.startswith("processor"):
                cores += 1
            if line.startswith("model name") and model == "desconhecido":
                model = line.split(":")[1].strip()
        return {
            "model": model,
            "cores": cores or 1,
            "usagePercent": calc_cpu_percent(),
            "loadAvg": [round(x, 2) for x in os.getloadavg()],
        }
    except Exception:
        return None


def collect_uptime():
    """Uptime em segundos."""
    try:
        with open("/proc/uptime") as f:
            return round(float(f.read().split()[0]))
    except Exception:
        return None


def collect_all_metrics():
    """Coleta todas as métricas do PC."""
    return {
        "cpu": collect_cpu_info(),
        "memory": collect_memory(),
        "disks": collect_disks(),
        "temperature": collect_temperatures(),
        "uptime": collect_uptime(),
        "hostname": platform.node(),
    }


# ─── Envio HTTP ────────────────────────────────────────────────────

def send_heartbeat(server_url, machine_id, secret, metrics):
    """Envia POST /api/agent/heartbeat para o servidor."""
    url = f"{server_url.rstrip('/')}/api/agent/heartbeat"
    payload = json.dumps({
        "machineId": machine_id,
        "hostname": platform.node(),
        "metrics": metrics,
        "agentVersion": "limits-agent/1.0",
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
            "User-Agent": "limits-agent/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
            if data.get("ok"):
                return True, data["lastSeenAt"]
            return False, data.get("error", "resposta inesperada")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        return False, f"HTTP {e.code}: {body}"
    except urllib.error.URLError as e:
        return False, f"Falha de conexão: {e.reason}"
    except Exception as e:
        return False, str(e)


# ─── Main loop ─────────────────────────────────────────────────────

def main_loop(cfg):
    """Loop principal de heartbeats."""
    server_url = cfg["server_url"]
    machine_id = cfg["machine_id"]
    secret = cfg["agent_secret"]
    interval = int(cfg.get("interval_seconds", DEFAULT_INTERVAL))
    interval = max(10, min(3600, interval))

    print(f"[limits-agent] Iniciando agent para {machine_id}")
    print(f"[limits-agent] Servidor: {server_url}")
    print(f"[limits-agent] Intervalo: {interval}s")
    print(f"[limits-agent] Heartbeat TTL no servidor: 120s")
    print(f"[limits-agent] Pressione Ctrl+C para parar")
    print()

    sent_count = 0
    fail_count = 0
    consecutive_fails = 0

    while True:
        try:
            metrics = collect_all_metrics()
            ok, result = send_heartbeat(server_url, machine_id, secret, metrics)

            if ok:
                sent_count += 1
                consecutive_fails = 0
                mem = metrics.get("memory", {})
                cpu_usage = metrics.get("cpu", {}).get("usagePercent", "?")
                print(
                    f"[{result}] ✓ Heartbeat #{sent_count} — "
                    f"CPU: {cpu_usage}% | "
                    f"RAM: {mem.get('usedPercent', '?')}% | "
                    f"Uptime: {metrics.get('uptime', 0):,}s"
                )
            else:
                fail_count += 1
                consecutive_fails += 1
                print(f"[limits-agent] ✗ Falha #{fail_count}: {result}")

                if consecutive_fails >= 5 and consecutive_fails % 5 == 0:
                    print(f"[limits-agent] ⚠ {consecutive_fails} falhas consecutivas — servidor pode estar offline?")

        except KeyboardInterrupt:
            print()
            print(f"[limits-agent] Parando. Enviados: {sent_count}, Falhas: {fail_count}")
            sys.exit(0)
        except Exception as e:
            fail_count += 1
            consecutive_fails += 1
            print(f"[limits-agent] Erro inesperado: {e}")

        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            print()
            print(f"[limits-agent] Parando. Enviados: {sent_count}, Falhas: {fail_count}")
            sys.exit(0)


def main():
    flags = parse_args()

    # Ações únicas
    if flags["setup"]:
        run_setup_wizard()
        return

    if flags["install"]:
        install_systemd()
        return

    if flags["uninstall"]:
        uninstall_systemd()
        return

    if flags["status"]:
        show_status()
        return

    # Modo normal: carrega config e roda loop
    cfg = load_config(flags)
    main_loop(cfg)


if __name__ == "__main__":
    main()
