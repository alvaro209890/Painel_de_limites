# Arquitetura

O Painel de Limites e uma central DevOps pessoal para monitorar maquinas, projetos e integracoes DeepSeek/Gemini.

## Componentes

- Frontend React/Vite em `src/`.
- Backend Express em `server.js`.
- Configuracoes JSON em `config/`.
- Heartbeats persistidos em `data/agent-heartbeats.json`.

## Fluxo

1. O servidor coleta metricas locais de CPU, RAM, disco, temperatura e uptime.
2. Maquinas remotas enviam `POST /api/agent/heartbeat` com `LIMITS_PANEL_AGENT_SECRET`.
3. Projetos sao lidos de `config/projects.json` e verificados via PM2 e/ou health check HTTP.
4. O dashboard combina maquinas, projetos, alertas, saldo DeepSeek e estado OAuth Gemini.

## Alertas

- Maquina offline.
- Disco acima de 80% ou 90%.
- Projeto offline.
- Saldo DeepSeek baixo.
