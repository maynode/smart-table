# 数据模型

Prisma schema 是结构唯一事实源：`apps/api/prisma/schema.prisma`。热路径（占码、自动化查找）走原生 SQL，不经过 Prisma 查询构建器。

## 1. 关系总览

```
User ──< WorkspaceMember >── Workspace ──< Base ──< Sheet ──< Field
                                             │        └──< RecordRow
                                             ├──< Form ──< FormSubmission
                                             └──< Automation ──< AutomationRun ──< AutomationRunStep
User ──< Comment            User ──< Notification            GroupChat
```

## 2. 核心表

### users
| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| email | text unique | 登录名 |
| password_hash | text | argon2id |
| name | text | 显示名 |

### workspaces / workspace_members
`workspace_members(workspace_id, user_id)` 唯一；角色枚举 `owner/admin/editor/viewer`，权限按等级比较。

### bases / sheets / fields
- `bases.workspace_id` 索引；`sheets.base_id` 索引。
- `fields`：`type` 存 27 种契约类型之一；`options` 为 JSONB（单选 choices、公式、关联等）；`order` 控制列顺序；`hidden` 只影响展示，不删数据。

### 公式（formula）与查找引用（lookup）

- 公式字段的表达式存于 `fields.options.formula`，以 `=` 开头；引用本表字段可写 `=[数量]*[单价]` 或 `=数量*单价`，也支持纯常量 `=1+1`。
- 服务端 `POST /sheets/:sheetId/query` 与前端网格使用同一份 `packages/shared/src/formula.ts`（HyperFormula）求值，结果不落库，避免脏写。
- 已接入并测试的常用函数：`SUM`、`AVERAGE`、`COUNT`、`COUNTA`、`MIN`、`MAX`、`IF`、`IFERROR`、`ROUND`、`ROUNDUP`、`ROUNDDOWN`、`CONCATENATE`、`TEXT`、`AND`、`OR`、`NOT`、`ABS`、`CEILING`、`FLOOR`、`POWER`、`SQRT`、`VLOOKUP`、`INDEX`、`MATCH`。
- 查找引用字段的 `options.lookup = { relationFieldId, targetFieldId, aggregate }`；`relationFieldId` 指向本表关联字段，`targetFieldId` 指向目标表字段，`aggregate` 支持 `first|count|sum|min|max|array`。服务端按关联记录批量解析，同样只读不落库。


### records
| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK（v7 时间有序） | 游标分页与领取顺序 |
| sheet_id | uuid FK | |
| cells | jsonb | `{fieldId: value}`，缺失即空值 |
| version | int | 乐观锁；PATCH 传 `expectedVersion` |
| claim_status | text nullable | 热路径领取状态；`claimed/unclaimed`，索引 `(sheet_id, claim_status)` |
| created_at/updated_at | timestamptz | |

> 为什么同时有 `cells->>'状态'` 和 `claim_status`：业务字段可改名/改选项，`claim_status` 提供稳定、可索引的领取状态，压测时直接命中索引。

### forms
| 列 | 说明 |
| --- | --- |
| id | 客户端生成 UUID（`POST /forms/:id` 幂等 upsert） |
| base_id / sheet_id | 表单归属；不允许跨 Base 移动 |
| fields | JSONB `[{fieldId, required?, displayConditions?}]` |
| share | JSONB `{enabled, audience, expiresAt}` |
| share_token | 唯一、不可枚举（12 字节 base64url） |
| success_template | 成功页 HTML 模板 |
| reject_duplicate_phone | 默认 true |

### form_submissions
一次公开提交一行；`record_id` 指向 `records`。领取失败时整个事务回滚，因此不存在「失败但留了 submission」的脏数据。

### automations / automation_runs / automation_run_steps
- `automations.trigger`：`recordCreated | recordUpdated | schedule`。
- `automations.steps`：步骤数组（见 AUTOMATION.md）。
- `automation_runs (automation_id, idempotency_key)` 唯一：同一提交/记录重试不会重复占码。
- `automation_runs.outputs`：扁平 `字段名 -> 展示值`，供成功页合并。
- `automation_run_steps.output`：每步结构化输出（命中的 recordIds、修改后的记录、群聊 id 等），用于排障。

### notifications / group_chats
`notifications(user_id, created_at)` 索引；`group_chats.member_ids` 为 JSONB（本地 NotifyAdapter）。

## 3. 索引与并发

- 领取查询：

```sql
SELECT id FROM records
WHERE sheet_id = $1
  AND cells->>'<状态字段>' = 'unclaimed'
ORDER BY id ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

- `SKIP LOCKED` 让并发提交各自跳过已锁定行；修改与查询在同一事务，提交成功才写领取流水。
- 唯一索引 `automation_runs(automation_id, idempotency_key)` 兜底重试。
- 手机号防重：事务内 `pg_advisory_xact_lock(hashtext(sheetId:phone))` + 查询，避免并发绕过。

## 4. 迁移

迁移目录按时间递增，禁止修改已应用文件：`20261021000100_init_users` … `20261021000700_form_duplicate_phone`。新增字段一律给默认值或允许 NULL，保证滚动升级兼容。

## 5. 备份/恢复

数据库 `pg_dump -Fc`；对象存储（MinIO/本地卷）单独备份。恢复顺序：数据库 → 对象存储 → 启动 API/worker。详见 DEPLOYMENT.md。
