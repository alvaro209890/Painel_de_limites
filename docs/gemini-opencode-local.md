# Gemini via OAuth da Gemini CLI no OpenAI-compatible gateway

Este projeto também possui um caminho experimental para expor modelos Gemini pelo endpoint OpenAI-compatible (`/v1/*`) usando a autenticação OAuth já configurada na Gemini CLI do servidor.

## Escopo atual

- **Restrito ao OpenCode do Acer do Álvaro por enquanto.**
- Os modelos Gemini **não aparecem** para o token normal `LIMITS_PANEL_AGENT_SECRET`.
- Os modelos Gemini só aparecem/chamam se a requisição usar o token separado salvo em:
  - servidor: `~/.config/codex-profiles/gemini-agent-secret.json`
  - Acer/OpenCode: `~/.config/opencode/opencode.jsonc`, provider `limites-gemini`

Isso evita liberar Gemini para todos os consumidores do Painel enquanto o adapter ainda é experimental.

## Modelos expostos para o token Gemini

- `gemini-2.5-pro`
- `gemini-2.5-flash`
- `gemini-2.5-flash-lite`

No OpenCode local, usar com prefixo do provider:

```bash
opencode run 'Responda exatamente: GEMINI_OK' --model limites-gemini/gemini-2.5-flash
```

## Arquitetura

`POST /v1/chat/completions` detecta `model` Gemini e chama `proxyGeminiCliAsOpenAIChat()` em `server.js`.

O proxy executa a CLI:

```bash
gemini -p '<prompt convertido das mensagens chat>' \
  --model gemini-2.5-flash \
  --output-format json \
  --skip-trust
```

O processo roda com ambiente limpo para evitar troca acidental de provider:

- `HOME=~`;
- `NO_BROWSER=true`;
- `GEMINI_CLI_TRUST_WORKSPACE=true`;
- sem `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_GCA` ou `GOOGLE_CLOUD_PROJECT`.

Depois converte `response` da saída JSON da Gemini CLI para resposta OpenAI-compatible:

- streaming: envia um chunk `role`, um chunk com `content` completo e `[DONE]`;
- não-streaming: retorna `choices[0].message.content`.

## Login OAuth pelo painel

A aba de contas Codex tem um card `Gemini CLI` que lê:

- `~/.gemini/oauth_creds.json`;
- `~/.gemini/google_accounts.json`;
- `~/.gemini/settings.json`.

O status mostra conta ativa, presença de refresh token e vencimento do token OAuth. Quando o OAuth vence e a Gemini CLI não consegue renovar sozinha, o gateway retorna erro 502 até refazer o login.

O botão `Login Gemini CLI` inicia a CLI em um `script` pseudo-TTY com `NO_BROWSER=true`. A CLI imprime uma URL do Google no painel, o usuário autoriza no navegador e cola o código retornado. Ao concluir, o painel faz backup das credenciais antigas em `~/.config/codex-profiles/backups/` e copia as novas credenciais para `~/.gemini/`.

O fluxo foi corrigido em maio de 2026 porque a versão anterior executava `echo '/auth'` fora do processo da Gemini CLI. Isso fazia o painel parecer iniciar o login, mas a CLI nunca recebia o comando de autenticação corretamente.

## Limitações importantes

Este é um adapter inicial via CLI, não uma integração nativa Gemini API:

- não implementa tool calls OpenAI-compatible;
- não converte ferramentas do OpenCode para function calling do Gemini;
- streaming é simulado após a resposta completa da CLI;
- latência maior, porque cada request sobe uma execução da CLI;
- indicado primeiro para perguntas/planejamento/testes no OpenCode, não como worker principal de edição de código.

Para uso pleno como coding model no OpenCode, o próximo passo ideal é trocar o subprocesso `gemini` por um provider nativo que fale diretamente com a API usada pela Gemini CLI/Google Code Assist e implemente tool calls.

## Verificação

No servidor:

```bash
cd "/media/server/HD Backup/Servidores_NAO_MEXA/Painel_de_limites"
node --check server.js
node --test gateway-utils.test.mjs
npm run build
```

Depois de reiniciar o PM2:

```bash
# Status do painel deve mostrar activeEmail, authExists e oauthExpiresAt
curl -sS https://limites.cursar.space/api/gemini-login/status \
  -H "Cookie: limits_session=<sessao-admin>"

# Com token normal: deve listar só GPT/Codex
curl -sS https://limites.cursar.space/v1/models \
  -H "Authorization: Bearer $LIMITS_PANEL_AGENT_SECRET" | jq '.data[].id'

# Com token Gemini local: deve listar GPT/Codex + Gemini
curl -sS https://limites.cursar.space/v1/models \
  -H "Authorization: Bearer $LIMITS_PANEL_GEMINI_AGENT_SECRET" | jq '.data[].id'
```

No Acer:

```bash
opencode models | grep gemini
opencode run 'Responda exatamente: GEMINI_OK' --model limites-gemini/gemini-2.5-flash
```

## Uso no Hermes do servidor

O Hermes Gateway do PC `server-desktop` também pode mostrar os modelos Gemini no comando `/model` do Telegram quando houver um provider customizado apontando para o gateway do Painel:

```yaml
providers:
  limites-gemini:
    name: Limites Gemini
    # No próprio server-desktop, usar localhost evita bloqueio do Cloudflare/WAF
    # contra o cliente Python/OpenAI usado pelo Hermes Gateway.
    # Em máquinas externas (ex.: Acer/OpenCode), usar https://limites.cursar.space/v1.
    base_url: http://127.0.0.1:8787/v1
    api_key: <secret de ~/.config/codex-profiles/gemini-agent-secret.json>
    api_mode: openai
    model: gemini-2.5-flash
    models:
      gemini-2.5-pro: {context_length: 1000000}
      gemini-2.5-flash: {context_length: 1000000}
      gemini-2.5-flash-lite: {context_length: 1000000}
    discover_models: true
```

Observação: este Hermes tinha um filtro local no `hermes_cli/model_switch.py` que restringia o picker a `openai-codex` e `deepseek`. Para o `/model` listar Gemini, o filtro também precisa permitir `limites-gemini` e `custom:limites-gemini` com os três modelos Gemini acima. Depois de alterar config/código, reiniciar:

```bash
systemctl --user restart hermes-gateway.service
```

Verificação rápida sem expor o token:

```bash
cd ~/.hermes/hermes-agent
python - <<PYCODE
from hermes_cli.config import load_config, get_compatible_custom_providers
from hermes_cli.model_switch import list_picker_providers
cfg=load_config(); m=cfg.get("model", {})
for p in list_picker_providers(current_provider=m.get("provider",""), current_base_url=m.get("base_url",""), current_model=m.get("default",""), user_providers=cfg.get("providers",{}), custom_providers=get_compatible_custom_providers(cfg), max_models=50):
    print(p.get("slug"), p.get("models"))
PYCODE
```

