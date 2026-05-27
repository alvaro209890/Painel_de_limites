# Agent Setup

O limits-agent envia metricas de maquinas remotas para o painel.

## Endpoint

`POST /api/agent/heartbeat` com header `Authorization: Bearer <LIMITS_PANEL_AGENT_SECRET>`.

## Payload minimo

```json
{
  "machineId": "pc-trabalho",
  "hostname": "desktop",
  "agentVersion": "limits-agent",
  "metrics": {
    "cpu": { "usagePercent": 10 },
    "memory": { "usedPercent": 50 },
    "disks": []
  }
}
```

Os heartbeats recentes ficam em `data/agent-heartbeats.json`.
