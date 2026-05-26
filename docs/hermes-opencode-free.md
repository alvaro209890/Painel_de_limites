# Hermes + OpenCode Zen Free: diagnóstico e correção

Este documento registra o incidente dos modelos free da OpenCode no Hermes dos dois PCs do Álvaro, a causa raiz encontrada e o procedimento de verificação para manter os modelos funcionando.

Contexto do ambiente:

- **Acer/local:** Hermes Gateway do perfil `default`, rodando como `systemd --user`.
- **Servidor:** `server-desktop`, SSH/Tailscale `server@100.65.138.58`, Hermes em `/home/server/.hermes/hermes-agent`, serviço `hermes-gateway.service`.
- **Provider Hermes:** `opencode-zen-free`.
- **Endpoint:** `https://opencode.ai/zen/v1`.
- **Modelos free esperados:**
  - `deepseek-v4-flash-free`
  - `nemotron-3-super-free`
  - `big-pickle`

## Sintomas observados

O provider `opencode-zen-free` já aparecia no catálogo/model picker, mas o uso pelo gateway falhava em tempo de execução. Houve dois tipos de problemas durante o diagnóstico:

1. **Registro/runtime do provider**
   - Erro do tipo `Unknown provider 'opencode-zen-free'` em caminhos que ainda não conheciam o slug como provider built-in.
   - Correção: manter `opencode-zen-free` como provider próprio do Hermes, sem criar provider custom paralelo.

2. **Streaming instável no endpoint free**
   - No servidor, após o provider ser reconhecido, as logs passaram a mostrar falha de streaming:

```text
provider=opencode-zen-free
base_url=https://opencode.ai/zen/v1/
error_type=RemoteProtocolError
peer closed connection without sending complete message body
incomplete chunked read
```

A falha acontecia porque o endpoint free da OpenCode fechava respostas chunked/streaming antes do frame final. As chamadas non-streaming para os mesmos modelos retornavam corretamente.

## Causa raiz

A causa final no `server-desktop` foi o caminho de streaming do Hermes para modelos OpenAI-compatible. O endpoint `opencode.ai/zen/v1` aceitava a chamada, retornava HTTP 200, mas encerrava o corpo chunked antes de completar a resposta, gerando `httpx.RemoteProtocolError`.

Portanto, para os modelos free da OpenCode, o caminho estável é **chat completions non-streaming**.

## Correções aplicadas no Hermes

No checkout do Hermes do servidor:

```text
/home/server/.hermes/hermes-agent
```

Foi ajustado:

```text
agent/conversation_loop.py
```

Regra aplicada:

- Se `agent.provider == "opencode-zen-free"`, não usar streaming.
- Também desabilitar streaming quando `base_url` contiver `opencode.ai/zen` e o modelo for um dos três free:
  - `deepseek-v4-flash-free`
  - `nemotron-3-super-free`
  - `big-pickle`

Motivo documentado no próprio código:

```text
The OpenCode Zen free endpoint intermittently closes chunked streaming responses
before the final frame (httpx.RemoteProtocolError: incomplete chunked read).
Non-streaming chat completions are stable for the three free models.
```

Também foi criada documentação local no checkout do Hermes:

```text
/home/server/.hermes/hermes-agent/docs/opencode-zen-free.md
```

## Procedimento de teste

Executar a partir do checkout do Hermes em cada máquina:

```bash
cd ~/.hermes/hermes-agent
for m in deepseek-v4-flash-free nemotron-3-super-free big-pickle; do
  ./venv/bin/python -m hermes_cli.main chat \
    -Q \
    --provider opencode-zen-free \
    --model "$m" \
    -q "Responda exatamente: OK"
done
```

Resultado esperado:

```text
deepseek-v4-flash-free -> OK
nemotron-3-super-free  -> OK
big-pickle             -> OK
```

No servidor, em 2026-05-26, os três testes passaram com exit code `0`:

```text
### deepseek-v4-flash-free OK exit=0
### nemotron-3-super-free OK exit=0
### big-pickle OK exit=0
```

Também foi executado teste de regressão do Hermes:

```bash
./venv/bin/python -m pytest tests/run_agent/test_streaming.py -q -o addopts=
```

Resultado:

```text
40 passed
```

## Reinício e verificação do gateway no servidor

Reiniciar o gateway do Hermes no servidor:

```bash
systemctl --user restart hermes-gateway.service
```

Verificar estado:

```bash
systemctl --user show hermes-gateway.service \
  -p ActiveState \
  -p SubState \
  -p MainPID \
  -p ExecMainStartTimestamp \
  --no-pager
```

Resultado observado após a correção:

```text
ActiveState=active
SubState=running
```

Checar se as falhas novas sumiram:

```bash
journalctl --user -u hermes-gateway.service \
  --since "YYYY-MM-DD HH:MM:SS" \
  --no-pager \
  | grep -Ei "unknown provider|opencode.*(error|drop|RemoteProtocolError|incomplete)|traceback|exception" \
  || true
```

Após o restart do servidor em 2026-05-26 09:06:21, a busca desde `09:06:22` não retornou novas falhas relacionadas a OpenCode.

## Checklist para futuras regressões

1. Confirmar que o gateway em execução usa o checkout esperado:

```bash
PID=$(systemctl --user show hermes-gateway.service -p MainPID --value)
readlink -f /proc/$PID/exe
tr "\0" " " < /proc/$PID/cmdline; echo
```

2. Confirmar provider/model registry:

```bash
cd ~/.hermes/hermes-agent
python3 - <<'PY'
from hermes_cli.providers import get_provider_runtime
for provider in ["opencode-zen-free"]:
    print(provider, get_provider_runtime(provider))
PY
```

3. Testar os três modelos free com `hermes chat -Q`.
4. Reiniciar `hermes-gateway.service`.
5. Checar logs novas desde o restart.
6. Não mascarar a correção criando provider custom paralelo. O slug correto é `opencode-zen-free`.
7. Não usar bearer fake como `no-key-required`; o provider free deve manter `api_key=""` para omitir o header `Authorization`.

## Relação com o Painel de Limites

O Painel de Limites continua sendo a vitrine/centro operacional para modelos e contas do Álvaro. Esta documentação fica neste repo porque ele concentra a operação de LLMs/Codex/Hermes do ambiente, mesmo quando a correção de código foi aplicada no checkout do Hermes.

Quando uma correção equivalente for promovida para upstream do Hermes, manter este arquivo como runbook operacional e atualizar a seção de "Correções aplicadas" com o commit/versão do Hermes que incorporou a mudança.
