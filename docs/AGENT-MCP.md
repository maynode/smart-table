# 全局 AI + MCP

产品内全局 Agent 与外部 MCP 客户端共用同一套 Tool Registry（`packages/agent-tools` + `apps/api/src/agent`）。

## 前置

1. 配置 `ANALYSIS_LLM_BASE_URL` / `ANALYSIS_LLM_API_KEY` / `ANALYSIS_LLM_MODEL`（未配置时全局对话返回 503）。
2. 应用 Prisma migration：`agent_sessions` / `agent_messages` / `agent_api_tokens`。

## 产品内对话

- `POST /agent/sessions` — 创建会话（可带 `workspaceId` / `baseId`）
- `POST /agent/sessions/:id/messages` — `{ content, clientMessageId? }`，服务端跑 tool-calling loop
- `GET /agent/tools` — 当前用户可见工具清单
- Base 顶栏「AI」打开全局助手面板

写表路径：`commit_sheet_changes` → `CommitChangesService`（与 HTTP `commitchanges` / 协同一致）。

## 签发 MCP PAT

登录后：

```http
POST /agent/tokens
Authorization: Bearer <jwt>
Content-Type: application/json

{ "name": "Cursor" }
```

响应中的 `token`（`st_agt_…`）**仅返回一次**。吊销：`DELETE /agent/tokens/:id`。

亦可在「我的」页「连接外部助手」创建。

## Cursor / Claude Desktop（stdio）

```json
{
  "mcpServers": {
    "smart-table": {
      "command": "node",
      "args": ["apps/mcp/src/index.mjs"],
      "env": {
        "SMART_TABLE_URL": "http://127.0.0.1:3000",
        "SMART_TABLE_TOKEN": "st_agt_…"
      }
    }
  }
}
```

`apps/mcp` 将 stdin JSON-RPC 转发到 `POST /mcp`（Bearer PAT）。

## HTTP MCP

`POST /mcp`（Bearer JWT 或 PAT），JSON-RPC：`initialize` / `tools/list` / `tools/call`。

## 权限

- Tool 执行走现有 workspace role + content ACL。
- `admin_*` 工具仅 `installAdmin` 可见。
- 吊销 PAT 后立即 401。

## 相关代码

- `packages/agent-tools` — schema / registry
- `apps/api/src/agent/` — sessions、loop、tools、MCP
- `apps/mcp` — stdio 桥
- `apps/web/src/components/GlobalAiPanel.vue` — 全局入口
