# Operação e Deploy

Runbook para operar o Painel de Limites / Central DevOps Pessoal no servidor.

## Requisitos

- Node.js compatível com o projeto.
- npm.
- PM2.
- Opcional: `cloudflared` para exposição pública.
- Opcional: `sensors` para temperatura.
- Opcional: Codex CLI instalado para login/rotação.

## Instalação

```bash
npm install
cp .env.example .env.local # opcional; não commitar .env.local
cp config/machines.example.json config/machines.json
cp config/projects.example.json config/projects.json
```

Ajuste `config/machines.json` e `config/projects.json` para o ambiente local.

## Segurança admin

Configure uma senha admin por variável de ambiente ou pelo arquivo seguro local.

### Opção por ambiente

```bash
export LIMITS_PANEL_ADMIN_PASSWORD='uma-senha-forte'
export LIMITS_PANEL_SESSION_SECRET='um-segredo-longo-aleatorio'
```

### Opção por arquivo local

Arquivo padrão:

```text
~/.config/codex-profiles/admin-secret.json
```

Formato:

```json
{
  "adminPassword": "uma-senha-forte",
  "sessionSecret": "um-segredo-longo-aleatorio"
}
```

Esse arquivo nunca deve ser commitado.

## Desenvolvimento

```bash
npm run api
npm run dev -- --host 127.0.0.1
```

- API: `http://127.0.0.1:8787`
- Vite: `http://127.0.0.1:5173`

## Build

```bash
npm run build
npm run lint
```

## Produção com PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Se o processo já existir:

```bash
npm run build
pm2 restart painel-limites --update-env
pm2 save
```

## Health checks

```bash
curl -i http://127.0.0.1:4173/api/health
curl -i http://127.0.0.1:4173/api/dashboard
```

Resultado esperado:

- `/api/health`: HTTP 200.
- `/api/dashboard` sem login: HTTP 401.

## Validação autenticada local

Use apenas localmente, sem imprimir senha/tokens:

```bash
python3 - <<'PY'
import json, http.cookiejar, urllib.request
from pathlib import Path

base = 'http://127.0.0.1:4173'
secret = Path.home()/'.config/codex-profiles/admin-secret.json'
password = json.loads(secret.read_text())['adminPassword']

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
headers = {
  'Content-Type': 'application/json',
  'x-admin-action': '1',
  'Origin': base,
}

opener.open(urllib.request.Request(
  f'{base}/api/codex-profiles/login',
  data=json.dumps({'password': password}).encode(),
  method='POST',
  headers=headers,
), timeout=15).read()

payload = json.loads(opener.open(f'{base}/api/dashboard', timeout=30).read().decode())
print({
  'ok': payload.get('ok'),
  'machines': len(payload.get('machines') or []),
  'projects': len(payload.get('projects') or []),
  'alerts': len(payload.get('alerts') or []),
  'hermes': bool(((payload.get('ai') or {}).get('limits') or {}).get('hermesCodex')),
})
PY
```

## Agentes remotos (limits-agent)

Instale o script `agent/limits-agent.py` em PCs remotos para coletar
métricas e enviar ao Painel. Veja [`docs/agent-setup.md`](agent-setup.md).

**No servidor**, configure o token de autenticação:

```bash
export LIMITS_PANEL_AGENT_SECRET='token-compartilhado-com-os-agents'
pm2 restart painel-limites --update-env
```

**No PC remoto**, após instalar o agent, verifique se o heartbeat chega:

```bash
curl -sS http://127.0.0.1:4173/api/machines -H 'Cookie: limits_admin=...' \
  | jq '.machines[] | select(.agent == true) | {id, status, lastSeenAt}'
```

## Logs

```bash
pm2 logs painel-limites --lines 100 --nostream
pm2 describe painel-limites
```

## Cloudflare Tunnel

O tunnel público deve apontar para:

```text
http://127.0.0.1:4173
```

Domínio atual de referência:

```text
https://limites.cursar.space/
```

## Arquivos locais sensíveis

Não versionar:

- `.env`, `.env.local`, qualquer arquivo real de ambiente;
- `config/machines.json`;
- `config/projects.json`;
- `~/.codex/auth.json`;
- `~/.hermes/auth.json`;
- `~/.config/codex-profiles/admin-secret.json`;
- `~/.config/codex-profiles/profiles/**/auth.json`;
- logs e builds (`logs/`, `dist/`).

## Checklist antes de publicar

```bash
npm run build
npm run lint
git status --short
```

Confirme que só exemplos e código seguro estão staged. Em repo público, nunca faça commit de tokens, e-mails completos, paths sensíveis de produção ou arquivos reais de configuração.
