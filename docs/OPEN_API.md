# 开放 API 与 Webhook

所有开放 API 使用工作区级 API Key，与登录态 JWT 完全隔离；Key 仅以 SHA-256 哈希落库，明文只在创建响应中出现一次。

## API Key

| 接口 | 说明 |
| --- | --- |
| `POST /workspaces/:id/api-keys` | `{name, scopes?: ["read","write"]}`，需 workspace admin；响应含一次性 `token` |
| `GET /workspaces/:id/api-keys` | 列出未撤销 Key（不含明文/哈希） |
| `DELETE /api-keys/:id` | 立即撤销 |
| `PATCH` 无 | Key 不支持修改，轮换即新建 + 撤销 |

调用方式二选一：

```http
X-API-Key: st_1a2b3c4d_<secret>
Authorization: Bearer st_1a2b3c4d_<secret>
```

`read` 只允许 GET，`write` 允许写；越权返回 403。Key 绑定创建时的工作区，跨工作区访问返回 403。

## 开放接口（前缀 `/open/v1`）

| 方法 | 路径 | 对应产品行为 |
| --- | --- | --- |
| GET/POST | `/workspaces/:id/bases` | Base 列表/创建 |
| GET | `/bases/:id` | Base 详情 |
| GET/POST | `/bases/:id/sheets` | Sheet 列表/创建 |
| GET/POST | `/sheets/:id/fields` | 字段列表/创建 |
| GET/POST | `/sheets/:id/records` | 记录分页/创建（触发自动化与 Webhook） |
| PATCH/DELETE | `/records/:id` | 更新（支持 `expectedVersion` 乐观锁）/删除 |
| GET | `/bases/:id/forms` | 表单列表 |

记录写入复用 `SheetsService`，因此 ACL、原子领号、自动化、行版本冲突和 Webhook 与 UI 行为一致；服务身份优先使用 Key 创建者，创建者离开工作区时回退 owner。

## Webhook

| 接口 | 说明 |
| --- | --- |
| `POST /workspaces/:id/webhooks` | `{url, events?}`，需 admin；`secret` 用于 HMAC |
| `GET /workspaces/:id/webhooks` | 订阅列表 |
| `DELETE /webhooks/:id` | 删除并级联投递记录 |
| `GET /webhooks/:id/deliveries` | 最近 100 次投递，可 `?status=failed` 查看死信 |
| `POST /webhook-deliveries/:id/retry` | 重置并重新投递 |

事件：`record.created`、`record.updated`、`record.deleted`；记录写入后异步投递，不阻塞主请求。

请求体是原始 JSON：

```json
{
  "id": "<delivery-id>",
  "event": "record.created",
  "createdAt": "2026-10-21T12:00:00.000Z",
  "data": { "recordId": "…", "cells": {}, "sheetId": "…", "baseId": "…" }
}
```

签名：

```text
X-SmartTable-Signature: sha256=<hex hmac-sha256(secret, rawBody)>
X-SmartTable-Event: record.created
X-SmartTable-Delivery: <delivery-id>
```

投递失败按 200ms、400ms 退避，最多 3 次；耗尽后 `status=failed` 进入死信，可在开发者面板或 `retry` 接口重投。生产建议接收端按 `id` 幂等。

## 前端入口

Base 顶栏「开发者」打开 `DeveloperPanel`：创建/撤销 API Key（一次性明文 + 复制）、创建/删除 Webhook、查看投递状态并重试失败投递。所有接口仍做服务端 admin 校验，面板不是权限边界。
