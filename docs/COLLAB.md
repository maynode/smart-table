# 实时协同协议（企微 MessageCenter / WS 对齐）

> 对照：`docs/design-refs/wecom/smart-table/HAR-TECH-ANALYSIS.md` §8 / §12  
> 离线通道：`docs/OFFLINE.md`（HTTP `commitchanges`）  
> OT 符号提取：`materials/wecom-ot-transforms.extracted.json`（sdk_0，59 个 `transformWith*`）

## 1. 证据状态

| 项 | 状态 |
|----|------|
| 单人 `USER_CHANGES` → `ACCEPT_COMMIT` | 有实帧 `materials/live-ws-user-changes.redacted.json` |
| `NEW_CHANGES` 处理路径 | SDK：`SERVER_MESSAGE_TYPE.NEW_CHANGES` → `body.data.changeset`（string） |
| 双人 `NEW_CHANGES` 完整实帧 | **仍缺实抓**；本仓事件体按 SDK + ACCEPT_COMMIT 回显结构自洽建模，标为推断 |
| OT transform 方法名 | 已从 `initial_smartsheet_sdk_0` 抽出 59 个符号（见 materials JSON） |

补抓步骤（HAR §12.6）：同账号双会话同表，观察端 WS 搜 `NEW_CHANGES`，脱敏入库后替换「推断」节。

## 2. 本仓事件（语义对齐，非 Engine.IO 孪生）

WebSocket：`/collab?token=<JWT>&sheetId=<uuid>`（JSON 文本帧）

| type | 方向 | 作用 |
|------|------|------|
| `client_ready` | C→S | 进房 |
| `last_reversion` | S→C | `{ sheetRev }` |
| `user_newinfos` | S→C | 在线成员列表 |
| `heart_beat` | 双向 | 约 15s |
| `user_changes` | C→S | `{ baseRev, clientBatchId, mutations }` |
| `accept_commit` | S→C | `{ baseRev, newRev, results, commitId }` |
| `new_changes` | S→C | `{ baseRev, newRev, mutations, authorId, commitId }`（对端） |
| `cursor_message` | C→S→peers | 选区/光标 |
| `user_leave` | S→C | 成员离开 |
| `comm_notice` | S→C | dirty / 提示（公式重算可后续加深） |
| `error` | S→C | `COMMIT_BASE_VER_TOO_LOW` 等 |

在线：MessageCenter → WS `user_changes`。  
离线 / WS 不可用：HTTP `commitchanges`（已有）。

## 3. 修订模型

- `sheets.sheet_rev`：pad `base_rev` 语义，权威序。
- `sheet_changesets`：每接受一提交一行（rev、author、mutations JSON、commit_id）。
- 行 `version` 仍更新，作缓存；冲突以 `sheet_rev` 为准。

## 4. OT（本仓 Mutation）

对本仓 `SheetMutation` 实现 transform（命名对齐企微符号）：

| 本仓 type | 对齐符号 |
|-----------|----------|
| `setRecord` | `transformWithSetRecordMutation` |
| `createRecord` / `insertRecords` | `transformWithInsertRecordMutation` |
| `deleteRecord` | `transformWithDeleteRecordMutation` |
| `createField` | `transformWithInsertFieldMutation` |
| `updateField` | `transformWithSetFieldAttributesMutation` |
| `deleteField` | `transformWithDeleteFieldMutation` |

规则摘要（可自动合）：

- 不同 `recordId` 的 `setRecord`：交换恒等。
- 同格后写：保留 server 已接受序，客户端拉 `new_changes` 覆盖乐观值。
- 字段删除 vs 对该字段的 setRecord：删除胜，丢弃 set。
- 未知交叉：**标 conflict**，要求客户端 `get_changes` 拉齐后重试（禁止静默丢）。

## 5. 与 OFFLINE 关系

| 场景 | 通道 |
|------|------|
| 在线且已进房 | MessageCenter → WS `user_changes` |
| 离线 / WS 超时 / WS 拒收 | HTTP `POST /sheets/:id/commitchanges` |
| 对端 | WS `new_changes` → 本地 apply（含 OT 重试） |

二者共用 `sheet_rev` / `sheet_changesets` / `CommitOp` 幂等。

## 6. 实现索引

- API：`apps/api/src/collab/*`、`CommitChangesService`（可选 `expectedSheetRev`）
- 客户端：`apps/web/src/sync/collab-socket.ts`、`message-center.ts`
- OT：`packages/shared/src/collab-ot.ts`（单测 `collab-ot.test.ts`）
- e2e：`apps/web/e2e/collab-realtime.spec.ts`

## 7. 验收

双浏览器无刷新互见；OT/冲突可理解；离线联调；光标/在线人数；副作用仅 accept 后。
