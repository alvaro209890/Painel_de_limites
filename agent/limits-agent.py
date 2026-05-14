#!/usr/bin/env python3
"""
limits-agent — Coleta métricas do PC e envia para o Painel de Limites central.

Funciona em Linux e Windows. Dependências: Python 3 padrão (stdlib apenas).

USO RÁPIDO (Linux):
  sudo curl -sSLo /usr/local/bin/limits-agent \
    https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
  sudo chmod +x /usr/local/bin/limits-agent
  limits-agent --setup   &&   sudo limits-agent --install

USO RÁPIDO (Windows — PowerShell como Admin):
  curl.exe -sSLo $env:USERPROFILE\\limits-agent.py ^
    https://raw.githubusercontent.com/alvaro209890/Painel_de_limites/main/agent/limits-agent.py
  python $env:USERPROFILE\\limits-agent.py --setup
  python $env:USERPROFILE\\limits-agent.py --install

FLAGS:
  --setup        Assistente interativo para criar config.json
  --install      Instala como serviço (systemd no Linux, Scheduled Task no Windows)
  --uninstall    Remove o serviço
  --server-url   URL do Painel de Limites (ex: https://limites.cursar.space)
  --machine-id   ID da máquina em config/machines.json
  --secret       Token de autenticação
  --interval     Segundos entre heartbeats (10-3600, padrão 60)
  --status       Mostra status do serviço e config atual
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

# ─── Platform detection ───────────────────────────────────────────

IS_WINDOWS = sys.platform.startswith("win")
IS_LINUX = sys.platform.startswith("linux")

# ─── Constantes ───────────────────────────────────────────────────

if IS_WINDOWS:
    _home = os.path.expanduser("~")
    CONFIG_DIR = os.path.join(_home, ".config", "limits-agent")
    SERVICE_NAME = "LimitsAgent"  # Nome da Scheduled Task
else:
    CONFIG_DIR = os.path.expanduser("~/.config/limits-agent")
    SERVICE_NAME = "limits-agent"
    SERVICE_PATH = f"/etc/systemd/system/{SERVICE_NAME}.service"

CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
DEFAULT_INTERVAL = 60
REQUEST_TIMEOUT = 15


def get_python_cmd():
    """Retorna comando Python portável (python no Windows, python3 no Linux)."""
    if IS_WINDOWS:
        return sys.executable  # Caminho completo no Windows
    return shutil.which("python3") or sys.executable


def get_script_path():
    """Retorna o caminho absoluto deste script."""
    return os.path.abspath(sys.argv[0])


# ─── Parse de argumentos ──────────────────────────────────────────

def parse_args():
    args = sys.argv[1:]
    flags = {
        "setup": False, "install": False, "uninstall": False, "status": False,
        "server_url": None, "machine_id": None, "secret": None, "interval": None,
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
                print("--server-url requer um argumento"); sys.exit(1)
        elif args[i] in ("--machine-id", "--id"):
            i += 1
            if i < len(args):
                flags["machine_id"] = args[i]
            else:
                print("--machine-id requer um argumento"); sys.exit(1)
        elif args[i] in ("--secret", "--token"):
            i += 1
            if i < len(args):
                flags["secret"] = args[i]
            else:
                print("--secret requer um argumento"); sys.exit(1)
        elif args[i] in ("--interval", "--int"):
            i += 1
            if i < len(args):
                try:
                    flags["interval"] = max(10, min(3600, int(args[i])))
                except ValueError:
                    print("--interval deve ser um número entre 10 e 3600"); sys.exit(1)
            else:
                print("--interval requer um argumento"); sys.exit(1)
        elif args[i] in ("--help", "-h"):
            print(__doc__); sys.exit(0)
        else:
            print(f"Argumento desconhecido: {args[i]}\nUse --help"); sys.exit(1)
        i += 1
    return flags


# ─── Setup wizard ─────────────────────────────────────────────────

def run_setup_wizard():
    print("╔══════════════════════════════════════════════╗")
    print("║     limits-agent — Assistente de setup      ║")
    print("╚══════════════════════════════════════════════╝")
    print()
    print(f"Config sera salva em: {CONFIG_FILE}")
    print()

    server_url = input("URL do Painel de Limites (ex: https://limites.cursar.space): ").strip()
    while not server_url:
        server_url = input("  >> URL e obrigatoria: ").strip()

    print()
    print("ID da maquina — deve bater com o id em config/machines.json no servidor.")
    print("Sugestoes: pc-trabalho, pc-reserva, pc-casa, notebook-1, windows-work")
    machine_id = input("ID da maquina: ").strip()
    while not machine_id:
        machine_id = input("  >> ID e obrigatorio: ").strip()

    print()
    agent_secret = input("Token secreto (mesmo do LIMITS_PANEL_AGENT_SECRET no servidor): ").strip()
    while not agent_secret:
        agent_secret = input("  >> Token e obrigatorio: ").strip()

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
    if not IS_WINDOWS:
        os.chmod(CONFIG_FILE, 0o600)

    print()
    print("Configuracao salva!")
    print()
    if IS_WINDOWS:
        print("Para testar:")
        print(f'  python "{get_script_path()}"')
        print()
        print("Para instalar como servico (auto-start ao ligar o PC):")
        print(f'  python "{get_script_path()}" --install')
        print("(execute como Administrador)")
    else:
        print("Para testar:")
        print(f"  {get_script_path()}")
        print()
        print("Para instalar como servico (auto-start ao ligar o PC):")
        print(f"  sudo {get_script_path()} --install")


# ─── Windows: Scheduled Task ──────────────────────────────────────

def _is_admin_windows():
    """Verifica se o script está rodando como Administrador no Windows."""
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False


def install_windows_task():
    """Cria Scheduled Task no Windows (roda ao logon, reinicia se falhar)."""
    if not _is_admin_windows():
        print("--install precisa ser executado como Administrador!")
        print("Clique direito no PowerShell/Terminal e escolha 'Executar como administrador'")
        sys.exit(1)

    if not os.path.exists(CONFIG_FILE):
        print(f"Config nao encontrada em {CONFIG_FILE}")
        print(f"  Rode 'python \"{get_script_path()}\" --setup' primeiro")
        sys.exit(1)

    python_exe = get_python_cmd()
    script = get_script_path()

    # schtasks /Create:
    # - /SC ONLOGON → roda quando o usuário loga
    # - /DELAY 0000:30 → espera 30s após logon
    # - /RL HIGHEST → executa com prioridade máxima
    # - /F → sobrescreve se já existir
    # - /IT → roda mesmo se usuário não estiver logado (interactive)
    cmd = (
        f'schtasks /Create /SC ONLOGON /DELAY 0000:30 '
        f'/TN "{SERVICE_NAME}" '
        f'/TR "{python_exe} \\\"{script}\\\"" '
        f'/RL HIGHEST /F /IT '
        f'/RU %USERNAME%'
    )

    try:
        subprocess.run(cmd, shell=True, check=True, timeout=30)
        print(f"Servico criado: '{SERVICE_NAME}'")
        print("Iniciando pela primeira vez...")

        # Inicia imediatamente (não espera o próximo logon)
        subprocess.run(
            f'schtasks /Run /TN "{SERVICE_NAME}"',
            shell=True, check=False, timeout=10,
        )
        print()
        print("Servico instalado e iniciado!")
        print("O agent vai rodar automaticamente sempre que voce ligar o PC e logar.")
        print()
        _show_windows_task_status()
    except subprocess.CalledProcessError as e:
        print(f"Erro ao instalar servico: {e}")
        sys.exit(1)


def uninstall_windows_task():
    """Remove a Scheduled Task."""
    if not _is_admin_windows():
        print("--uninstall precisa ser executado como Administrador!")
        sys.exit(1)

    try:
        subprocess.run(
            f'schtasks /End /TN "{SERVICE_NAME}"',
            shell=True, check=False, timeout=10,
        )
        subprocess.run(
            f'schtasks /Delete /TN "{SERVICE_NAME}" /F',
            shell=True, check=True, timeout=10,
        )
        print(f"Servico removido: '{SERVICE_NAME}'")
    except subprocess.CalledProcessError as e:
        if "does not exist" in str(e).lower() or "nao existe" in str(e).lower():
            print("Servico nao esta instalado.")
        else:
            print(f"Erro ao remover servico: {e}")
            sys.exit(1)


def _show_windows_task_status():
    """Exibe o status da Scheduled Task."""
    try:
        result = subprocess.run(
            f'schtasks /Query /TN "{SERVICE_NAME}" /FO LIST /V',
            shell=True, capture_output=True, text=True, timeout=15,
        )
        lines = result.stdout.strip().split("\n")
        info = {}
        for line in lines:
            if ":" in line:
                key, val = line.split(":", 1)
                info[key.strip()] = val.strip()

        status = info.get("Status", info.get("Status (s)", "Desconhecido"))
        last_run = info.get("Last Run Time", info.get("Ultima Execucao", "N/A"))
        next_run = info.get("Next Run Time", info.get("Proxima Execucao", "Ao logon"))
        print(f"  Status: {status}")
        print(f"  Ultima execucao: {last_run}")
        print(f"  Proxima execucao: {next_run}")

        # Verificar se o processo está rodando
        proc_check = subprocess.run(
            f'tasklist /FI "IMAGENAME eq python*" /FO CSV /NH',
            shell=True, capture_output=True, text=True, timeout=10,
        )
        if "limits-agent" in proc_check.stdout.lower() or get_script_path() in proc_check.stdout:
            print("  Processo: rodando ativo")
        else:
            print("  Processo: pode estar entre heartbeats (sleep)")
    except Exception:
        pass


# ─── Linux: systemd ───────────────────────────────────────────────

def install_systemd():
    if os.geteuid() != 0:
        print("--install precisa ser executado como root (sudo)")
        print(f"  sudo {sys.argv[0]} --install")
        sys.exit(1)

    if not os.path.exists(CONFIG_FILE):
        print(f"Config nao encontrada em {CONFIG_FILE}")
        print(f"  Rode '{sys.argv[0]} --setup' primeiro")
        sys.exit(1)

    import getpass
    python_path = get_python_cmd()
    script_path = get_script_path()
    user = getpass.getuser()

    content = f"""\
[Unit]
Description=Limits Agent — metricas do PC para o Painel de Limites
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
        print(f"Servico criado em {SERVICE_PATH}")

        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "enable", SERVICE_NAME], check=True)
        subprocess.run(["systemctl", "start", SERVICE_NAME], check=True)

        print()
        print("Servico instalado e iniciado!")
        print()
        subprocess.run(["systemctl", "status", SERVICE_NAME, "--no-pager"])
    except subprocess.CalledProcessError as e:
        print(f"Erro ao instalar servico: {e}")
        sys.exit(1)
    except PermissionError:
        print("Permissao negada. Execute com sudo.")
        sys.exit(1)


def uninstall_systemd():
    if os.geteuid() != 0:
        print("--uninstall precisa ser executado como root (sudo)")
        sys.exit(1)

    if not os.path.exists(SERVICE_PATH):
        print("Servico nao esta instalado.")
        return

    try:
        subprocess.run(["systemctl", "stop", SERVICE_NAME], check=False)
        subprocess.run(["systemctl", "disable", SERVICE_NAME], check=False)
        os.remove(SERVICE_PATH)
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        print(f"Servico removido de {SERVICE_PATH}")
    except Exception as e:
        print(f"Erro ao remover servico: {e}")
        sys.exit(1)


def show_linux_status():
    if os.path.exists(SERVICE_PATH):
        print("Servico systemd:")
        subprocess.run(["systemctl", "status", SERVICE_NAME, "--no-pager"])
    else:
        print("Servico systemd nao instalado.")
        print(f"  Instale com: sudo {sys.argv[0]} --install")


# ─── Service management dispatch ──────────────────────────────────

def do_install():
    if IS_WINDOWS:
        install_windows_task()
    else:
        install_systemd()


def do_uninstall():
    if IS_WINDOWS:
        uninstall_windows_task()
    else:
        uninstall_systemd()


def do_status():
    if IS_WINDOWS:
        print(f"Sistema: Windows {platform.release()}")
        print(f"Hostname: {platform.node()}")
        print()
        try:
            result = subprocess.run(
                f'schtasks /Query /TN "{SERVICE_NAME}" /FO LIST /V',
                shell=True, capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0:
                print(f"Servico '{SERVICE_NAME}':")
                for line in result.stdout.strip().split("\n"):
                    if line.strip():
                        print(f"  {line.strip()}")
            else:
                print(f"Servico '{SERVICE_NAME}' nao instalado.")
                print(f"  Instale com: python \"{get_script_path()}\" --install")
        except Exception:
            print(f"Servico '{SERVICE_NAME}' nao instalado.")
            print(f"  Instale com: python \"{get_script_path()}\" --install")
    else:
        show_linux_status()

    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            cfg = json.load(f)
        print()
        print("Config atual:")
        safe = {k: v for k, v in cfg.items() if k != "agent_secret"}
        safe["agent_secret"] = (cfg.get("agent_secret", "")[:8] + "...") if cfg.get("agent_secret") else None
        print(json.dumps(safe, indent=2))
    else:
        print()
        print("Config: nao encontrada")
        print(f"  Crie com: {sys.argv[0]} --setup")


# ─── Config loading ───────────────────────────────────────────────

def load_config(flags):
    os.makedirs(CONFIG_DIR, mode=0o700, exist_ok=True)

    if flags["server_url"] and flags["machine_id"] and flags["secret"]:
        config = {
            "server_url": flags["server_url"].rstrip("/"),
            "machine_id": flags["machine_id"],
            "agent_secret": flags["secret"],
            "interval_seconds": flags["interval"] or DEFAULT_INTERVAL,
        }
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2)
        if not IS_WINDOWS:
            os.chmod(CONFIG_FILE, 0o600)
        print(f"Config salva em {CONFIG_FILE}")
        return config

    if not os.path.exists(CONFIG_FILE):
        print(f"Config nao encontrada em {CONFIG_FILE}")
        print()
        print("Opcao 1 — assistente interativo:")
        print(f"  {sys.argv[0]} --setup")
        print()
        print("Opcao 2 — flags diretas:")
        suffix = " \"^\"" if IS_WINDOWS else " \\"
        print(f'  {sys.argv[0]} --server-url https://limites.cursar.space{suffix}')
        print(f"                 --machine-id pc-trabalho{suffix}")
        print(f"                 --secret SEU_TOKEN")
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

    if flags["server_url"]:
        cfg["server_url"] = flags["server_url"].rstrip("/")
    if flags["machine_id"]:
        cfg["machine_id"] = flags["machine_id"]
    if flags["secret"]:
        cfg["agent_secret"] = flags["secret"]
    if flags["interval"]:
        cfg["interval_seconds"] = flags["interval"]

    errors = []
    if not cfg.get("server_url"):
        errors.append("server_url e obrigatorio")
    if not cfg.get("machine_id"):
        errors.append("machine_id e obrigatorio")
    if not cfg.get("agent_secret"):
        errors.append("agent_secret e obrigatorio")

    if errors:
        print(f"Config invalida em {CONFIG_FILE}:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    return cfg


# ═══════════════════════════════════════════════════════════════════
#  COLETA DE MÉTRICAS — implementação por SO
# ═══════════════════════════════════════════════════════════════════

def safe_shell(cmd, timeout=5):
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip() or None
    except Exception:
        return None


# ─── CPU ──────────────────────────────────────────────────────────

def _cpu_linux():
    try:
        with open("/proc/stat") as f:
            for line in f:
                if line.startswith("cpu "):
                    vals = [int(v) for v in line.strip().split()[1:]]
                    return {"total": sum(vals), "idle": vals[3]}
    except Exception:
        return None


def _cpu_windows():
    """Uso de CPU no Windows via wmic."""
    out = safe_shell("wmic cpu get loadpercentage /VALUE", timeout=5)
    if out:
        for line in out.split("\n"):
            if "LoadPercentage" in line:
                try:
                    pct = float(line.split("=")[1].strip())
                    return {"instant": pct}
                except (ValueError, IndexError):
                    pass
    return None


def calc_cpu_percent():
    if IS_LINUX:
        a = _cpu_linux()
        if not a:
            return None
        time.sleep(0.2)
        b = _cpu_linux()
        if not b:
            return None
        td = b["total"] - a["total"]
        id_ = b["idle"] - a["idle"]
        return round(((td - id_) / td) * 100, 1) if td > 0 else 0.0
    elif IS_WINDOWS:
        c = _cpu_windows()
        if c and "instant" in c:
            return c["instant"]
        # fallback via PowerShell
        out = safe_shell(
            'powershell -Command "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"',
            timeout=5,
        )
        if out:
            try:
                return round(float(out.strip()), 1)
            except ValueError:
                pass
        return None
    return None


# ─── CPU info ─────────────────────────────────────────────────────

def collect_cpu_info():
    if IS_LINUX:
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
    elif IS_WINDOWS:
        # Modelo e núcleos
        model = safe_shell(
            'wmic cpu get name /VALUE', timeout=5
        )
        cores = safe_shell(
            'wmic cpu get NumberOfCores /VALUE', timeout=5
        )
        logical = safe_shell(
            'wmic cpu get NumberOfLogicalProcessors /VALUE', timeout=5
        )
        cpu_model = "desconhecido"
        cpu_cores = 1
        cpu_logical = 1
        if model:
            for line in model.split("\n"):
                if "=" in line:
                    cpu_model = line.split("=", 1)[1].strip()
        if cores:
            for line in cores.split("\n"):
                if "=" in line:
                    try:
                        cpu_cores = int(line.split("=", 1)[1].strip())
                    except ValueError:
                        pass
        if logical:
            for line in logical.split("\n"):
                if "=" in line:
                    try:
                        cpu_logical = int(line.split("=", 1)[1].strip())
                    except ValueError:
                        pass
        return {
            "model": cpu_model,
            "cores": cpu_logical,
            "usagePercent": calc_cpu_percent(),
            "loadAvg": [],  # loadavg não existe no Windows
        }
    return None


# ─── Memory ───────────────────────────────────────────────────────

def _mem_linux():
    try:
        with open("/proc/meminfo") as f:
            data = {}
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    try:
                        data[parts[0].strip()] = int(parts[1].strip().split()[0]) * 1024
                    except (ValueError, IndexError):
                        pass
        total = data.get("MemTotal", 0)
        free = data.get("MemFree", 0) + data.get("Buffers", 0) + data.get("Cached", 0)
        used = total - free
        if total == 0:
            return None
        return {
            "totalBytes": total, "usedBytes": used, "freeBytes": free,
            "usedPercent": round((used / total) * 100),
            "totalGb": round(total / 1073741824, 1),
            "usedGb": round(used / 1073741824, 1),
            "freeGb": round(free / 1073741824, 1),
        }
    except Exception:
        return None


def _mem_windows():
    try:
        out = safe_shell(
            'wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /VALUE', timeout=5
        )
        total_kb = None
        free_kb = None
        if out:
            for line in out.split("\n"):
                if "TotalVisibleMemorySize" in line:
                    try:
                        total_kb = int(line.split("=")[1].strip())
                    except (ValueError, IndexError):
                        pass
                if "FreePhysicalMemory" in line:
                    try:
                        free_kb = int(line.split("=")[1].strip())
                    except (ValueError, IndexError):
                        pass
        if total_kb and total_kb > 0:
            if free_kb is None:
                free_kb = 0
            total_b = total_kb * 1024
            free_b = free_kb * 1024
            used_b = total_b - free_b
            return {
                "totalBytes": total_b, "usedBytes": used_b, "freeBytes": free_b,
                "usedPercent": round((used_b / total_b) * 100),
                "totalGb": round(total_b / 1073741824, 1),
                "usedGb": round(used_b / 1073741824, 1),
                "freeGb": round(free_b / 1073741824, 1),
            }
    except Exception:
        pass
    return None


def collect_memory():
    if IS_LINUX:
        return _mem_linux()
    return _mem_windows()


# ─── Disks ────────────────────────────────────────────────────────

def _disks_linux():
    out = safe_shell(
        "df -B1 --output=source,fstype,size,used,avail,pcent,target 2>/dev/null | tail -n +2"
    )
    if not out:
        return []

    disks = []
    import re as _re
    for line in out.split("\n"):
        if not line.strip():
            continue
        m = _re.search(r"(\S+)\s+(/.*)$", line)
        if not m:
            continue
        before = line[: m.start()].strip()
        pcent = m.group(1)
        mount = m.group(2).strip()
        cols = before.split()
        if len(cols) < 5:
            continue
        device, fs_type, size_s, used_s, avail_s = cols[:5]
        if not _re.match(r"^(ext[234]|ntfs|fuseblk|btrfs|xfs|zfs|f2fs|vfat|exfat)$", fs_type):
            continue
        if _re.match(r"^/(proc|sys|dev|run|tmp)\b", mount):
            continue
        if _re.match(r"^/(boot|boot/efi)\b", mount):
            continue
        size_gb = round(int(size_s) / 1073741824, 1)
        used_gb = round(int(used_s) / 1073741824, 1)
        free_gb = round(int(avail_s) / 1073741824, 1)
        label = "SSD (sistema)" if mount == "/" else \
                "HDD (Backup)" if "hd backup" in mount.lower() else \
                mount.rsplit("/", 1)[-1] or mount
        disks.append({
            "device": device, "fsType": fs_type, "mount": mount,
            "sizeGb": size_gb, "usedGb": used_gb, "freeGb": free_gb,
            "percent": str(pcent), "label": label,
        })
    return disks


def _disks_windows():
    """Discos via wmic no Windows."""
    out = safe_shell(
        'wmic LogicalDisk where "DriveType=3" get DeviceID,Size,FreeSpace /VALUE',
        timeout=5,
    )
    if not out:
        return []

    disks = []
    current = {}
    for line in out.split("\n"):
        line = line.strip()
        if not line:
            if current.get("DeviceID"):
                device = current.get("DeviceID", "?")
                size_b = current.get("Size")
                free_b = current.get("FreeSpace")
                try:
                    size_gb = round(int(size_b) / 1073741824, 1) if size_b else 0
                    free_gb = round(int(free_b) / 1073741824, 1) if free_b else 0
                    used_gb = round(size_gb - free_gb, 1)
                    pcent = round((used_gb / size_gb) * 100) if size_gb > 0 else 0
                    label = "SSD (sistema)" if device.endswith("C:") else \
                            device.rstrip(":").strip()
                    disks.append({
                        "device": device, "fsType": "ntfs", "mount": f"{device}\\",
                        "sizeGb": size_gb, "usedGb": used_gb, "freeGb": free_gb,
                        "percent": f"{pcent}%", "label": label,
                    })
                except (ValueError, TypeError):
                    pass
                current = {}
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            current[k.strip()] = v.strip()

    return disks


def collect_disks():
    if IS_LINUX:
        return _disks_linux()
    return _disks_windows()


# ─── Temperature ──────────────────────────────────────────────────

def collect_temperatures():
    """Temperatura — Linux via sysfs/sensors, Windows via WMI (limitado)."""
    if IS_LINUX:
        zones = []
        try:
            td = "/sys/class/thermal"
            if os.path.isdir(td):
                for name in sorted(os.listdir(td)):
                    if name.startswith("thermal_zone"):
                        tp = os.path.join(td, name, "type")
                        mp = os.path.join(td, name, "temp")
                        if os.path.exists(tp) and os.path.exists(mp):
                            with open(tp) as f:
                                ttype = f.read().strip()
                            with open(mp) as f:
                                raw = float(f.read().strip())
                            zones.append({"name": ttype or name, "temp": round(raw / 100) / 10})
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
        return {"max": round(max(z["temp"] for z in zones), 1), "sensors": zones}

    elif IS_WINDOWS:
        # WMI temperature (muitos PCs não implementam)
        out = safe_shell(
            'wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature /VALUE',
            timeout=5,
        )
        zones = []
        if out:
            for line in out.split("\n"):
                if "CurrentTemperature" in line:
                    try:
                        raw = float(line.split("=")[1].strip())
                        # WMI retorna em décimos de Kelvin
                        celsius = round((raw / 10) - 273.15, 1)
                        if celsius > 0:
                            zones.append({"name": "wmi", "temp": celsius})
                    except (ValueError, IndexError):
                        pass
        if not zones:
            return None
        return {"max": round(max(z["temp"] for z in zones), 1), "sensors": zones}

    return None


# ─── Uptime ───────────────────────────────────────────────────────

def collect_uptime():
    if IS_LINUX:
        try:
            with open("/proc/uptime") as f:
                return round(float(f.read().split()[0]))
        except Exception:
            return None
    elif IS_WINDOWS:
        # Usar wmic para obter o boot time e calcular uptime
        out = safe_shell(
            'wmic OS get LastBootUpTime /VALUE', timeout=5
        )
        if out:
            import datetime as _dt
            for line in out.split("\n"):
                if "LastBootUpTime" in line:
                    try:
                        raw = line.split("=")[1].strip()
                        # Formato: YYYYMMDDHHMMSS.mmmmmm+UUU
                        boot = _dt.datetime.strptime(raw[:14], "%Y%m%d%H%M%S")
                        now = _dt.datetime.now()
                        delta = now - boot
                        return round(delta.total_seconds())
                    except (ValueError, IndexError):
                        pass
        return None
    return None


# ─── Metrics aggregator ───────────────────────────────────────────

def collect_all_metrics():
    return {
        "cpu": collect_cpu_info(),
        "memory": collect_memory(),
        "disks": collect_disks(),
        "temperature": collect_temperatures(),
        "uptime": collect_uptime(),
        "hostname": platform.node(),
    }


# ─── HTTP ─────────────────────────────────────────────────────────

def send_heartbeat(server_url, machine_id, secret, metrics):
    url = f"{server_url.rstrip('/')}/api/agent/heartbeat"
    payload = json.dumps({
        "machineId": machine_id,
        "hostname": platform.node(),
        "metrics": metrics,
        "agentVersion": "limits-agent/2.0",
    }).encode("utf-8")

    req = urllib.request.Request(
        url, data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
            "User-Agent": "limits-agent/2.0",
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
        return False, f"Falha de conexao: {e.reason}"
    except Exception as e:
        return False, str(e)


# ─── Main loop ────────────────────────────────────────────────────

def main_loop(cfg):
    server_url = cfg["server_url"]
    machine_id = cfg["machine_id"]
    secret = cfg["agent_secret"]
    interval = max(10, min(3600, int(cfg.get("interval_seconds", DEFAULT_INTERVAL))))

    print(f"[limits-agent] Iniciando agent para {machine_id}")
    print(f"[limits-agent] Servidor: {server_url}")
    print(f"[limits-agent] SO: {platform.system()} {platform.release()}")
    print(f"[limits-agent] Intervalo: {interval}s")
    print(f"[limits-agent] Pressione Ctrl+C para parar")
    print()

    sent = 0
    fails = 0
    consec = 0

    while True:
        try:
            metrics = collect_all_metrics()
            ok, result = send_heartbeat(server_url, machine_id, secret, metrics)

            if ok:
                sent += 1
                consec = 0
                mem = metrics.get("memory", {})
                cpu = metrics.get("cpu", {})
                cpu_u = cpu.get("usagePercent", "?")
                print(
                    f"[{result}] Heartbeat #{sent} — "
                    f"CPU: {cpu_u}% | "
                    f"RAM: {mem.get('usedPercent', '?')}% | "
                    f"Uptime: {metrics.get('uptime', 0):,}s"
                )
            else:
                fails += 1
                consec += 1
                print(f"[limits-agent]  Falha #{fails}: {result}")
                if consec >= 5 and consec % 5 == 0:
                    print(f"[limits-agent]  {consec} falhas consecutivas — servidor pode estar offline?")

        except KeyboardInterrupt:
            print(f"\n[limits-agent] Parando. Enviados: {sent}, Falhas: {fails}")
            sys.exit(0)
        except Exception as e:
            fails += 1
            consec += 1
            print(f"[limits-agent] Erro inesperado: {e}")

        try:
            time.sleep(interval)
        except KeyboardInterrupt:
            print(f"\n[limits-agent] Parando. Enviados: {sent}, Falhas: {fails}")
            sys.exit(0)


# ═══════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════════════

def main():
    flags = parse_args()

    if flags["setup"]:
        run_setup_wizard()
        return
    if flags["install"]:
        do_install()
        return
    if flags["uninstall"]:
        do_uninstall()
        return
    if flags["status"]:
        do_status()
        return

    cfg = load_config(flags)
    main_loop(cfg)


if __name__ == "__main__":
    main()
