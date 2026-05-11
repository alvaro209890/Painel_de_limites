# Painel de limites do Codex

Dashboard local para acompanhar limite do Codex nas proximas 5 horas, janela secundaria, creditos e metricas locais por modelo.

## Como rodar

Em um terminal:

```bash
npm run api
```

Em outro terminal:

```bash
npm run dev -- --host 127.0.0.1
```

Abra:

```text
http://127.0.0.1:5173
```

## De onde vem os dados

- Limites reais: `~/.codex/auth.json` + endpoint interno `https://chatgpt.com/backend-api/wham/usage`.
- Metricas locais: `~/.codex/state_5.sqlite`, tabela `threads`.

## Observacoes

- O painel nao mostra tokens/credenciais no frontend.
- O e-mail e mascarado antes de sair da API local.
- Se voce trocar a conta do Codex, rode `codex logout` e `codex login` para atualizar `~/.codex/auth.json`.
- O dashboard atualiza automaticamente a cada 60 segundos.
