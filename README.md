# Painel de Limites

Dashboard local para monitoramento DevOps e de máquinas, com foco em:

- **Métricas Neon em Tempo Real (Sparklines em SVG):** Histórico visual dinâmico de 15 pontos em tempo real para monitorar flutuações de CPU e RAM nas suas máquinas conectadas.
- **Heartbeats:** Sinais vitais de agentes locais e remotos através do `limits-agent`.
- **Hardware e Telemetria:** CPU, RAM, discos, temperatura e uptime.
- **Projetos e Processos:** Status de projetos e microsserviços via PM2 e health checks HTTP.
- **Alertas Inteligentes:** Notificações automáticas para máquinas offline, discos cheios e saldo DeepSeek baixo.
- **Módulo de Performance:** Monitoramento e consulta ao saldo do **DeepSeek V4**.

---

## 🛠️ Comandos

```bash
npm run dev      # Inicia o servidor Vite de desenvolvimento
npm run build    # Gera a build estática otimizada de produção
npm run preview  # Faz o preview local da build
node server.js   # Inicia a API Express e serve o frontend de produção
```

---

## 🔌 API e Backend (`server.js`)

O backend foi simplificado para focar puramente em monitoramento soberano de infraestrutura. Todas as chamadas obsoletas da Gemini foram eliminadas.

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/health` | Health check básico |
| `GET` | `/api/admin/status` | Status da sessão do administrador |
| `POST` | `/api/admin/login` | Login administrativo seguro |
| `POST` | `/api/admin/logout` | Logout administrativo |
| `GET` | `/api/dashboard` | Payload unificado do dashboard (PCs, Projetos, DeepSeek e Alertas) |
| `GET` | `/api/machines` | Lista de máquinas ativas e suas métricas |
| `POST` | `/api/machines/:id/rename` | Renomeia uma máquina monitorada |
| `POST` | `/api/agent/heartbeat` | Recebe heartbeat ativo de computadores via `limits-agent` |
| `GET` | `/api/projects` | Status de projetos e serviços |
| `GET` | `/api/alerts` | Alertas gerados a partir da análise de estado atual |
| `GET` | `/api/pc-metrics` | Métricas locais do servidor principal |
| `GET` | `/api/deepseek` | Saldo e limites de uso do DeepSeek |

---

## ⚙️ Configurações e Variáveis de Ambiente

As configurações são injetadas em ambiente pelo PM2 ou através do arquivo `.env` local.

- `LIMITS_PANEL_PORT`: Porta interna para a API Express (Padrão: `8787`).
- `LIMITS_PANEL_SITE_PORT`: Porta em que o site estático é servido (Padrão: `4173`).
- `LIMITS_PANEL_ADMIN_PASSWORD`: Senha de login do administrador.
- `LIMITS_PANEL_SESSION_SECRET`: Assinatura criptográfica segura para tokens de sessão.
- `LIMITS_PANEL_AGENT_SECRET`: Token de autenticação Bearer para os heartbeats dos agents locais.
- `DEEPSEEK_API_KEY`: Chave usada para a consulta automatizada do saldo da API DeepSeek.

### Arquivos de Configuração Local:

- `config/machines.json`: Cadastro estático de máquinas monitoradas.
- `config/projects.json`: Cadastro de projetos e rotas de Health Check HTTP.
- `config/admin-secret.json`: Fallback local para credenciais de administrador.
- `data/agent-heartbeats.json`: Últimos payloads e estado de hardware enviados pelos PCs atômicos.

---

## ⚡ Geração do Frontend e Deploy

O frontend é construído com **React, Vite e Tailwind CSS** gerando arquivos leves otimizados.

```bash
npm run build
```

Esta operação compila os assets em `dist/`. O servidor Express do painel consome automaticamente esta pasta para servir o painel estático completo de forma ultra-rápida.
