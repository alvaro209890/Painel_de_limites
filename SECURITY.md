# Segurança

Este painel lida com informações operacionais sensíveis: contas de IA, limites, métricas de máquina, serviços locais e rotas administrativas.

## Modelo de segurança

- O projeto é pensado para uso pessoal/interno.
- O domínio público deve ser tratado como superfície sensível.
- Apenas `/api/health` deve responder sem login.
- Todos os endpoints com dados operacionais exigem sessão admin.
- Ações que alteram estado exigem sessão admin e header `x-admin-action: 1`.

## O que nunca deve ser publicado

Nunca commitar:

- `auth.json` do Codex ou do Hermes;
- access tokens, refresh tokens, API keys ou cookies;
- `.env` real;
- `admin-secret.json`;
- perfis salvos com `auth.json`;
- logs reais contendo paths locais ou eventos de erro;
- `config/machines.json` e `config/projects.json` reais do servidor.

Apenas exemplos devem ser versionados:

- `.env.example`;
- `config/machines.example.json`;
- `config/projects.example.json`.

## Proteções implementadas

- Sessão admin via cookie `limits_admin` assinado com HMAC.
- Cookie `HttpOnly` e `SameSite=Lax`.
- Cookie `Secure` quando acessado por HTTPS/domínio público.
- Proteção básica de origem para ações admin.
- `x-admin-action: 1` obrigatório para POST/DELETE sensíveis.
- E-mails mascarados na API.
- Tokens sanitizados em logs de login do Codex.
- `noindex,nofollow` no HTML.
- `.gitignore` bloqueia builds, logs e configs reais.

## Recomendações para produção

- Usar senha admin forte via variável `LIMITS_PANEL_ADMIN_PASSWORD`.
- Definir `LIMITS_PANEL_SESSION_SECRET` fixo e longo em produção.
- Proteger o domínio com Cloudflare Access sempre que possível.
- Manter o repositório sem arquivos reais de configuração.
- Rodar `npm run build` e `npm run lint` antes de publicar.
- Validar que `/api/dashboard` retorna `401` sem login.

## Resposta a incidente

Se algum segredo for commitado:

1. Revogue o token/chave imediatamente na origem.
2. Gere uma nova credencial.
3. Remova o segredo do histórico se o repo for público.
4. Force push apenas se entender o impacto para clones existentes.
5. Audite logs e acessos recentes.

## Contato

Projeto mantido para uso pessoal do Álvaro. Não abra issues públicas contendo tokens, e-mails completos, paths sensíveis ou dumps de API.
