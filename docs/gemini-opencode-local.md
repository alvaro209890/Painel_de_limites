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

Depois converte `response` da saída JSON da Gemini CLI para resposta OpenAI-compatible:

- streaming: envia um chunk `role`, um chunk com `content` completo e `[DONE]`;
- não-streaming: retorna `choices[0].message.content`.

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
