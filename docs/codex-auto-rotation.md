# Rotação automática de contas Codex

Este documento descreve a rotação automática de perfis Codex implementada no Painel de Limites.

## Objetivo

Quando a conta Codex ativa chega no limite de uso da janela principal ou secundária, o backend tenta encontrar outro perfil salvo com limite disponível e ativa esse perfil automaticamente, sem depender do navegador aberto e sem bloquear o Hermes.

A rotação roda dentro do processo Node/PM2 `painel-limites`.

## Arquivos usados

- `~/.codex/auth.json`: conta Codex ativa usada pelo CLI.
- `~/.config/codex-profiles/profiles/<slug>/auth.json`: perfis salvos.
- `~/.config/codex-profiles/rotation-config.json`: configuração da rotação.
- `~/.config/codex-profiles/rotation-events.jsonl`: log de eventos da rotação.
- `~/.config/codex-profiles/backups/`: backups feitos antes de ativar outro perfil.

## Como funciona

1. O backend consulta o uso da conta ativa via `https://chatgpt.com/backend-api/wham/usage`.
2. Se a conta ativa estiver bloqueada, não permitida ou com alguma janela acima do limite configurado, a rotação é acionada.
3. O backend percorre os perfis salvos.
4. Para cada perfil, consulta o uso daquele `auth.json` sem ativá-lo.
5. O primeiro perfil disponível é ativado copiando seu `auth.json` para `~/.codex/auth.json`.
6. O `auth.json` anterior é salvo em backup.
7. Um evento é gravado em `rotation-events.jsonl`.

## Critério de limite esgotado

A rotação considera que precisa trocar quando ocorrer qualquer condição abaixo:

- `usage.status.limitReached === true`
- `usage.status.allowed === false`
- alguma janela retorna `usedPercent >= thresholdUsedPercent`
- alguma janela retorna `remainingPercent <= 0`
- erro ao consultar a conta ativa

O padrão de `thresholdUsedPercent` é `99.5`.

## Configuração padrão

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

Campos:

- `enabled`: ativa/desativa a rotação automática.
- `intervalSeconds`: frequência da checagem. Mínimo de 30s.
- `cooldownSeconds`: tempo mínimo entre tentativas de rotação. Mínimo de 60s.
- `thresholdUsedPercent`: percentual usado para considerar janela esgotada.
- `notifyOnly`: se `true`, registra o que faria, mas não ativa outro perfil.
- `preferredOrder`: ordem preferencial de slugs.
- `skipSlugs`: perfis que nunca devem ser usados automaticamente.

## API admin

Todas as rotas abaixo exigem login admin.

### Ver status

```bash
curl -sS https://limites.cursar.space/api/codex-rotation \
  -H 'Cookie: limits_admin=...' | jq .
```

### Atualizar configuração

```bash
curl -sS https://limites.cursar.space/api/codex-rotation/config \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'x-admin-action: 1' \
  -H 'Cookie: limits_admin=...' \
  --data '{"enabled":true,"intervalSeconds":60}' | jq .
```

### Testar sem trocar conta

```bash
curl -sS https://limites.cursar.space/api/codex-rotation/run-once \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'x-admin-action: 1' \
  -H 'Cookie: limits_admin=...' \
  --data '{"force":true,"dryRun":true,"reason":"teste_manual"}' | jq .
```

### Rodar manualmente com troca real

```bash
curl -sS https://limites.cursar.space/api/codex-rotation/run-once \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'x-admin-action: 1' \
  -H 'Cookie: limits_admin=...' \
  --data '{"force":true,"dryRun":false,"reason":"execucao_manual"}' | jq .
```

## Interface

Na seção **Contas Codex**, após login admin, existe o card **Rotação automática** com:

- status ativa/desativada;
- agendamento;
- intervalo;
- limite de troca;
- última checagem;
- botão para ativar/desativar;
- botão para testar sem trocar;
- botão para rodar agora.

## Proteções implementadas

- A rotação não roda se já houver outra rotação em andamento.
- A rotação não troca conta enquanto um login Codex está em andamento.
- Existe cooldown entre tentativas automáticas.
- Tokens não são enviados ao navegador.
- Toda ativação faz backup do `auth.json` anterior.
- O modo `dryRun` testa a lógica sem alterar a conta.
- O modo `notifyOnly` permite simular continuamente sem trocar.
- Botões de ativar/excluir/salvar ficam bloqueados durante login Codex.
- O perfil ativo não pode ser excluído pela UI.

## Limitação importante

Trocar `~/.codex/auth.json` afeta novas execuções do Codex CLI. Um processo Codex já aberto pode continuar usando a autenticação carregada antes da troca.

## Operação

Ver logs do PM2:

```bash
pm2 logs painel-limites --lines 100 --nostream
```

Ver eventos da rotação:

```bash
tail -n 50 ~/.config/codex-profiles/rotation-events.jsonl
```

Desativar manualmente por arquivo:

```bash
python - <<'PY'
import json
from pathlib import Path
p = Path.home()/'.config/codex-profiles/rotation-config.json'
data = json.loads(p.read_text()) if p.exists() else {}
data['enabled'] = False
p.write_text(json.dumps(data, indent=2) + '\n')
PY
pm2 restart painel-limites
```
