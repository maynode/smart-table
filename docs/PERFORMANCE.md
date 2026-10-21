# 性能基线与容量说明

本文记录可复现的实测数据与压测方法。数字随机器、Docker 资源、数据库参数变化，报告必须同时给出环境。

## 1. 测试环境

| 项 | 值 |
| --- | --- |
| 机器 | AMD Ryzen 5 5625U（6 核 12 线程），15.3 GB RAM |
| 系统 | Windows 11 + Docker Desktop（Linux 容器） |
| Node | 容器 `node:22-alpine`；本地压测进程 Node 24 |
| PostgreSQL | `postgres:16-alpine` |
| 连接池 | PgBouncer v1.23.1，transaction 模式，API 走 6432 |
| Redis | `redis:7-alpine`（本机映射 6380） |
| API | NestJS 11 + Fastify 5，同步提交模式（`SUBMIT_MODE=sync`） |
| 数据规模 | 50 条码、1 个表单、1 个自动化（查找 1 条 + 修改） |

## 2. 并发领码基线（Task 14 验收）

命令：

```bash
pnpm --filter api exec ts-node --transpile-only test/claim-load.smoke.ts
```

结果（2026-10-21）：

```json
{
  "codes": 50,
  "concurrency": 100,
  "success": 50,
  "conflict": 50,
  "otherStatuses": [],
  "uniqueSerials": 50,
  "claimedRows": 50,
  "durationMs": 1742,
  "latencyMs": { "p50": 1644, "p95": 1704, "max": 1710 }
}
```

判定：

- 成功数 = 码数 50；冲突数 = 100 − 50；无 5xx/429。
- 50 个成功响应的序列号互不重复；数据库中 `claim_status='claimed'` 恰好 50 行。
- 失败响应均为 `409` 且文案包含「领取完毕」，事务回滚，无脏写。
- 延迟包含 100 个请求同时排队穿过 Prisma 连接池（`connection_limit=10`）的时间；单请求处理本身在毫秒级。

复现要点：`FOR UPDATE SKIP LOCKED` + 同一事务内完成查找/修改/流水；`automation_runs(automation_id, idempotency_key)` 唯一索引防重。

## 3. 队列模式

```bash
pnpm --filter api exec jest --config ./test/jest-e2e.json --runInBand test/queue-mode.e2e-spec.ts
```

- 提交返回 `202`，响应含 `submissionId` 与 `pollUrl`。
- worker 在 Redis 队列中执行同一 Runner；轮询接口返回 `completed` 时带渲染好的成功页 HTML。
- 码尽时任务标记 `failed`，轮询返回错误文案，不会返回成功页。
- 队列模式下 API 与 `claim-worker` 可独立扩容；任务幂等，重复消费不会重复占码。

## 4. 索引与查询路径

- `records(sheet_id, claim_status)` 索引存在（e2e 断言 `pg_indexes`）。
- 自动化查找若条件是对「状态/领取状态」的等值过滤，会额外生成 `claim_status = 'unclaimed'` 谓词，使领取查询命中该索引，而不是回退到 JSONB 顺序扫描。
- 记录列表使用 UUIDv7 游标分页（`id > cursor ORDER BY id LIMIT n+1`），翻页成本与页大小成正比，不随总行数增长。
- 表单提交的幂等键与领取流水在同一事务写入，重试不会重复扣码。

## 5. 千万行表格渲染

设计约束：

- 三层 Canvas（背景网格 / 数据 / 交互覆盖），`OffscreenCanvas` 预渲染，滚动只重绘视口。
- 均匀轴 `UniformAxis`：`index = floor(offset / rowHeight)`，O(1) 定位，不为 1000 万行建立 DOM 或对象数组。
- 行数据按视口窗口请求，内存中只保留窗口 + 少量缓存页。

已验证（Playwright `grid-canvas.spec.ts`）：

- 网格容器实际高度 676px，Canvas 尺寸与 DPR 匹配；
- `OffscreenCanvas` 可用且启用；
- 滚动、选中、编辑交互通过。

说明：当前自动化环境没有针对 1000 万行的逐帧 FPS 采样，因此不宣称具体 FPS；架构上避免了 O(rows) 的初始化和渲染，压测报告（Task 26）会补充浏览器 Performance 面板数据与机器规格。

## 6. 扩展到百万级表单提交的路径

1. **无状态 API**：JWT，无粘滞会话；HPA 按 CPU 扩容（`deploy/k8s/api-hpa.yaml`）。
2. **写路径可异步**：`SUBMIT_MODE=queue` 将提交放入 BullMQ，worker 水平扩容；HTTP 层只做校验与入队。
3. **连接池**：PgBouncer 事务模式 + Prisma `connection_limit`，避免百万连接打到 PostgreSQL。
4. **行锁粒度**：`SKIP LOCKED` 让并发 worker 各自领取不同码，不串行化整表。
5. **冷热分离**：1000 万行读取走游标分页与视口窗口；领取只访问索引命中的 1 行。
6. **限流**：公开提交按 token+IP 限流，防止单链接打爆；生产可在网关再加一层。

当前实测覆盖 100 并发/50 码；更高并发需要独立压测环境（多 API 副本 + 独立数据库），Task 26 会给出该环境下的最终数据。

## 7. 监控指标

`GET /metrics`（Prometheus 文本）：

- `form_submit_total{mode="sync|queue",status="success|failed|queued"}`
- `automation_run_total{status=...}`（后续接入 runner 计数）
- 延迟以 `_count/_sum` 形式输出，便于计算均值。

K8s API Deployment 已带抓取注解；无 Prometheus 时可用 `curl`.

## 8. 性能门禁

| 门禁 | 命令 | 通过标准 |
| --- | --- | --- |
| 并发占码 | `test/claim-load.smoke.ts` | 50 成功 / 50 冲突 / 50 唯一码 |
| 队列模式 | `queue-mode.e2e-spec.ts` | 202 → completed，码尽 failed |
| 索引 | `perf-foundation.e2e-spec.ts` | `pg_indexes` 含 claim_status |
| 网格交互 | `apps/web/e2e/grid-canvas.spec.ts` | Canvas 尺寸/离屏/滚动通过 |
| 领取闭环 | `serial-claim.e2e-spec.ts` | 单次与并发行为符合预期 |
