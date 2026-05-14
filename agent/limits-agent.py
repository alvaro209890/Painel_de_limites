#!/usr/bin/env python3
"""
limits-agent — Coleta métricas do PC e envia para o Painel de Limites central.

Instalação (no PC remoto):
  1. Copie este script para o PC (ex: /usr/local/bin/limits-agent)
  2. Crie ~/.config/limits-agent/config.json com:
     {
       "server_url": "https://limites.cursar.space",
       "machine_id": "pc-trabalho",
       "agent_secret": "token_definido_no_servidor"
     }
  3. (Opcional) Ajuste interval_seconds (padrão 60)
  4. Execute: python3 /usr/local/bin/limits-agent
  5. Ou instale como serviço systemd

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


def load_config():
    """Carrega config.json do agent. Cria diretório se não existir."""
    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)

    if not os.path.exists(CONFIG_FILE):
        print(f"[limits-agent] Config não encontrada em {CONFIG_FILE}")
        print(f"[limits-agent] Crie o arquivo com o formato:")
        print(json.dumps({
            "server_url": "https://limites.cursar.space",
            "machine_id": "pc-trabalho",
            "agent_secret": "TOKEN_DO_SERVIDOR",
            "interval_seconds": DEFAULT_INTERVAL,
        }, indent=2))
        sys.exit(1)

    with open(CONFIG_FILE, "r") as f:
        cfg = json.load(f)

    # Validações
    errors = []
    if not cfg.get("server_url"):
        errors.append("server_url é obrigatório")
    if not cfg.get("machine_id"):
        errors.append("machine_id é obrigatório")
    if not cfg.get("agent_secret"):
        errors.append("agent_secret é obrigatório")

    if errors:
        print(f"[limits-agent] Config inválida em {CONFIG_FILE}:")
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

def main():
    cfg = load_config()
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

                # Se 5 falhas consecutivas, log mais visível
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


if __name__ == "__main__":
    main()
