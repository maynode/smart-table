# 断网 / 离线提交协议（企微 MessageCenter 对齐）

> 对照：`docs/design-refs/wecom/smart-table/HAR-TECH-ANALYSIS.md` §8.3 / §12  
> 在线实时单元格：见 [COLLAB.md](./COLLAB.md)；Base 对象自动更新：见 [LIVE.md](./LIVE.md)。  
> 离线 / WS 不可用时 MessageCenter 降级 **HTTP `commitchanges`**。

## 1. 客户端流水线

```
prepareUserChange → pendingChanges → persistChanges（IndexedDB）
  → flush → POST /sheets/:sheetId/commitchanges
  → acceptCommit | 网络失败留队重试 | 版本冲突表面化
```

- 多标签：`BroadcastChannel` + `navigator.locks` 单 flusher。
- 恢复：`online` 事件与启动时自动 `flush`（指数退避，上限对齐企微 commitchanges 重试量级）。
- 撤销/重做：也是 mutation，入同一队列。

## 2. HTTP 协议

`POST /sheets/:sheetId/commitchanges`（需登录）

```json
{
  "clientBatchId": "uuid",
  "mutations": [
    {
      "clientOpId": "uuid",
      "type": "setRecord",
      "recordId": "…",
      "cells": { "fieldId": "value" },
      "baseVersion": 3
    }
  ]
}
```

公开表单离线提交：mutation `publicFormSubmit`（`shareToken` + `idempotencyKey`），或 `POST /public/forms/:token/submit` 带 `Idempotency-Key` 头（二者均落同一幂等表）。

## 3. Mutation 类型

| type | 说明 |
|------|------|
| `setRecord` | 单元格 patch + 行 `baseVersion` |
| `createRecord` / `insertRecords` | `clientRecordId` → 服务端 id 映射 |
| `deleteRecord` | 删行 |
| `createField` / `updateField` / `deleteField` | 含列宽等 options |
| `createAttachment` | 已上传 `url` 写入单元格 |
| `publicFormSubmit` | 公开提交 + 幂等键（防领码双花） |

类型定义：`packages/shared/src/offline-mutations.ts`。

## 4. 错误码（语义对齐企微）

| code | 含义 |
|------|------|
| `COMMIT_VERSION_CONFLICT` | 行 version 不匹配 |
| `COMMIT_DUPLICATED` | 同 `clientOpId` 已成功（结果回显为 `duplicate`/`ok`） |
| `COMMIT_OVERSIZE` | batch / 单条过大 |
| `COMMIT_INVALID` | 载荷非法 |
| `COMMIT_FORBIDDEN` | ACL |
| `COMMIT_NOT_FOUND` | 行/字段不存在 |
| `COMMIT_FAILED` | 其它 |

成功重复提交：`status: "duplicate"`，带回上次结果，**不双写**。

## 5. 验收清单

- [x] 断网改格入队 → IndexedDB → 联网 `flush`（Playwright `e2e/offline-sync.spec.ts`）
- [x] 同 `clientOpId` 重放不双写（`commitchanges.e2e-spec.ts`）
- [x] 版本冲突返回 `COMMIT_VERSION_CONFLICT`（同上）
- [x] 多标签 `BroadcastChannel` + `navigator.locks` 单 flusher
- [x] 公开表单 `Idempotency-Key` + 离线 outbox（`public-form-outbox.ts`）
- [x] 附件 `pending-blob:` → flush 前 upload 再 commit
- [x] 自动化仅在服务端 accept 后触发（mutation 走既有 SheetsService 写路径）
- [x] API e2e + Playwright `setOffline`
