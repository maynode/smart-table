# 断网 / 离线提交协议（企微 MessageCenter 对齐）

> 对照：`docs/design-refs/wecom/smart-table/HAR-TECH-ANALYSIS.md` §8.3 / §12  
> 在线实时单元格：见 [COLLAB.md](./COLLAB.md)；Base 对象自动更新：见 [LIVE.md](./LIVE.md)。  
> 离线 / WS 不可用时 MessageCenter 降级 **HTTP `commitchanges`**。

## 0. PWA + Chunk 本地库（2026-10-27）

| 层 | 实现 | 说明 |
|----|------|------|
| 可安装壳 | `vite-plugin-pwa` + Workbox | precache SPA/静态资产；**禁止**缓存 `/api` `/files` `/collab` `/live` |
| 本地库 | `smart-table-sync` IDB v2 + Sync Worker | `record_chunks`（fflate + crc32）、`shell_meta`、`object_cache`；队列仍走 `pending_mutations` |
| 分块 | `chunk-math.ts` `CELL_BUDGET=15000` | 网络窗 `WINDOW_SIZE=2000`；落库按单元格预算切子块 |
| 写穿 | `localDb.persistWindowAsync` | 先上屏，idle/coalesce 再落库；主线程不 await put |
| 崩溃安全 | `enqueueAndPatch` | `setRecord` 入队与 chunk 乐观 patch **同一 IDB 事务** |
| 动作门闸 | `offline-capability.ts` | `allow` / `queue` / `block`（AI / 自动化 Run / ACL 写等离线硬阻断） |
| 对象 Outbox | `object-outbox.ts` | 仪表盘布局/删图、自动化启停/保存/删除、通知已读；联网 REST flush |

冷启动：有 token + 已访问过的 Base/表 → 断网 reload 可读缓存窗并可继续改格入队。  
对象面缓存：Hub、仪表盘 detail+聚合、分析列表/报告、自动化列表、公开视图、通知列表。

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
- [x] PWA 壳（manifest + SW 仅静态资产）
- [x] chunk 本地库冷启动（`e2e/offline-sync.spec.ts` cold reload）
- [x] `offline-capability` 单测；cell-budget / queryFp 单测
- [x] 对象 Outbox：仪表盘布局、自动化定义、通知已读（`object-outbox.ts`）
- [x] 仪表盘/分析/自动化/公开视图/通知离线读缓存
