# Rotação automática de contas Codex (via Hermes credential pool)

Este documento descreve a rotação automática de contas Codex implementada no Painel de Limites.

## Objetivo

Quando a conta Codex ativa no **Hermes credential pool** (`credential_pool.openai-codex`)
atinge o limite de uso, o backend tenta encontrar outro perfil salvo com limite disponível
e ativa esse perfil no credential pool do Hermes.

A rotação roda dentro do processo Node/PM2 `painel-limites` e altera apenas
`~/.hermes/auth.json` → `credential_pool.openai-codex[0]`.

Ela **não altera** `~/.codex/auth.json` (Codex CLI standalone), que permanece com
a conta que foi logada manualmente via `codex login`.

## Mudança de comportamento (15/05/2026)

**Antes:** a rotação copiava perfis para `~/.codex/auth.json` (Codex CLI standalone).
Isso era errado porque quem usa Codex como subagente é o **Hermes Agent**, que lê
do `credential_pool.openai-codex` em `~/.hermes/auth.json`.

**Agora:** a rotação atualiza o credential pool do Hermes diretamente. O Hermes
é quem delega tarefas ao Codex CLI como subagente, então a conta que precisa
rodar é a do Hermes pool, não a do Codex standalone.

## Arquivos usados

- `~/.hermes/auth.json`: credential pool do Hermes → `credential_pool.openai-codex` é a conta ativa.
- `~/.config/codex-profiles/profiles/<slug>/auth.json`: perfis salvos (formato Codex CLI).
- `~/.config/codex-profiles/rotation-config.json`: configuração da rotação.
- `~/.config/codex-profiles/rotation-events.jsonl`: log de eventos da rotação.
- `~/.config/codex-profiles/backups/hermes-auth-*.json`: backups do `~/.hermes/auth.json` feitos antes de ativar outro perfil.

## Como funciona

1. O backend consulta o uso da credencial ativa no **Hermes credential pool** via `https://chatgpt.com/backend-api/wham/usage`.
2. Se a conta ativa estiver bloqueada, não permitida ou com alguma janela acima do limite configurado, a rotação é acionada.
3. O backend percorre os perfis salvos em `~/.config/codex-profiles/profiles/`.
4. Para cada perfil, consulta o uso daquele `auth.json` sem ativá-lo.
5. O primeiro perfil disponível é ativado: seus `tokens.access_token` e `tokens.refresh_token` são copiados para o Hermes credential pool.
6. A credencial anterior do Hermes é salva em backup (`hermes-auth-<slug>-<timestamp>.json`).
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

Na seção **Contas Codex / Hermes**, após login admin, existem cards separados:

- **Hermes OpenAI Codex:** mostra a credencial ativa no credential pool do Hermes (`~/.hermes/auth.json`).
- **Codex CLI (standalone):** mostra a conta ativa da CLI em `~/.codex/auth.json` (apenas para comparação).
- **Perfis salvos do Codex CLI:** cada card consulta o `auth.json` salvo sem ativar a conta e mostra:
  - percentual restante da janela principal de 5 horas;
  - percentual restante da janela semanal;
  - erro individual da conta, quando o token estiver inválido ou sem permissão.
- **Rotação automática Codex CLI:**
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
- O perfil ativo do Hermes é excluído da lista de candidatos, mesmo quando o match precisa ser feito por `chatgpt_account_id`.
- Toda ativação faz backup do `~/.hermes/auth.json` anterior.
- O modo `dryRun` testa a lógica sem alterar a conta.
- O modo `notifyOnly` permite simular continuamente sem trocar.
- Botões de ativar/excluir/salvar ficam bloqueados durante login Codex.
- O perfil ativo não pode ser excluído pela UI.

## Limitação importante

Trocar a credencial no Hermes pool afeta novas delegações do Hermes para o Codex
subagente. Um processo Codex já aberto continua usando a autenticação carregada
antes da troca.

O `~/.codex/auth.json` (Codex CLI standalone) **não é alterado** pela rotação
automática nem pela ativação manual de perfis via UI. Ele só muda durante login
ou operações diretas do Codex CLI standalone.

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
