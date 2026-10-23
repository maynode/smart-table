# 自动化

自动化 = 触发器 + 有序步骤 + 运行日志。定义类型由 `packages/shared/src/automation-types.ts` 与 API 共同约束。

## 1. 触发器

| 类型 | 配置 | 语义 |
| --- | --- | --- |
| `recordCreated` | `sheetId`，可选 `filters` | 新增记录且满足条件时运行（公开表单提交走这里） |
| `recordUpdated` | `sheetId`，可选 `filters` | 更新记录且满足条件时运行 |
| `schedule` | `cron`、`timezone` | 定时运行（仪表盘定时推送复用） |

条件使用 `FilterGroup`（`conjunction: and|or`，可嵌套；操作符与视图筛选一致）。编辑器触发器与「查找记录」均可选「全部 / 任意」并添加多条条件。触发器条件里可以写字段 id 或字段名，运行前会归一化为 id。

## 2. 六种动作

| 步骤 | 关键配置 | 输出 |
| --- | --- | --- |
| `findRecords` | `sheetId`、`filters`、`sorts`、`limit`、`onEmpty` | `records`、`recordIds`、`values` |
| `createRecord` | `sheetId`、`cells` | 新记录 id、字段值 |
| `modifyRecords` | `target`（fromStep/ids/filters）、`cells` | 修改后的记录 id 与字段值 |
| `sendMessage` | `channel`、`recipients`、`content` | 文档通知（`notifications`）或群消息 |
| `startGroupChat` | `name`、`memberUserIds` | `groupChatId` |
| `addGroupMembers` | `fromStepId` 或 `groupChatId`、`memberUserIds` | `groupChatId` |

### 查找默认 1 条

`resolveFindLimit()`：`limit` 缺省、非数字或 <1 时一律返回 `1`。这是与企微智能表格对齐并修正的核心行为——领取场景不应一次命中整批码。

### 找不到时

`resolveOnEmpty(step, automation)`：步骤级 `onEmpty` 优先，其次自动化级 `onFindEmpty`，默认 `continue`。`stop` 时本次运行标记 `skipped`，不执行后续步骤。

公开表单领取模板将 `onFindEmpty` 设为 `stop`，因此码尽时提交返回 `409` 并整体回滚。

## 3. 变量与字段映射

`cells` 的值可以是：

```json
{ "kind": "literal", "value": "claimed" }
```

```json
{
  "kind": "variable",
  "variable": { "source": "trigger", "field": "手机号" }
}
```

```json
{
  "kind": "variable",
  "variable": { "source": "step", "stepId": "find-code", "field": "序列号" }
}
```

```json
{
  "kind": "variable",
  "variable": { "source": "naturalTime", "naturalTime": "today" }
}
```

映射键可使用字段 id 或字段名；运行时会解析为字段 id。`naturalTime` 输出 `YYYY-MM-DD`（today/tomorrow/yesterday）。

## 4. 并发与原子性

- 若某个 `findRecords` 被后续 `modifyRecords` 以 `fromStep` 引用，查找 SQL 自动追加 `FOR UPDATE SKIP LOCKED`。
- 修改前对目标记录 `SELECT ... FOR UPDATE`；同一事务内完成「查找 → 修改 → 写日志」。
- 公开表单提交把「表单记录 + submission + 自动化运行」放在同一 Prisma 交互事务；任何一步失败全部回滚。
- 幂等键：
  - 表单提交：`submission:<submissionId>`
  - 记录触发：`recordCreated:<recordId>` / `recordUpdated:<recordId>`
  唯一索引兜底，重试不会重复领码。

## 5. 执行入口

- `inline`（默认）：API 进程内直接执行，适合单机与测试。
- `bullmq`：`AUTOMATION_QUEUE=bullmq`，任务进入 Redis 队列，由 `claim-worker` 消费；失败重试 3 次、指数退避。两者调用同一 Runner，行为一致。

## 6. 运行日志

`GET /automations/:id/runs` 返回：

- `status`：`running | success | failed | skipped`
- `startedAt` / `finishedAt` / `durationMs`
- `steps[]`：每步 `stepIndex`、`type`、`status`、`durationMs`、`output`、`error`
- `outputs`：成功页可用的扁平字段值

管理端「自动化」面板展示最近 10 次运行。失败运行保留错误信息，便于定位是权限、码尽还是配置错误。

## 7. 权限

- 创建/修改/手动运行：Base 所属工作区的 `editor` 及以上。
- 查看定义与运行日志：`viewer` 及以上。
- 跨工作区访问返回 403。
