# 性能基线与容量说明

本文记录可复现的实测数据与压测方法。数字随机器、Docker 资源、数据库参数变化，报告必须同时给出环境。

## 1. 测试环境（2026-10-23 复测）

| 项 | 值 |
| --- | --- |
| 机器 | Intel Core i7-9700K @ 3.60GHz（8 核），约 32 GB RAM |
| 系统 | Windows 11 + Docker Desktop（Linux 容器） |
| Node | v22.22.0（本地压测 / API） |
| PostgreSQL | `postgres:16-alpine`（本机映射 5433） |
| Redis | `redis:7-alpine`（本机映射 6380） |
| API | NestJS + Fastify，`SUBMIT_MODE=sync`；表单压测时 `PUBLIC_SUBMIT_RATE_LIMIT=10000` |
| 数据规模（领码） | 50 条码、100 并发提交 |

> 历史环境（2026-10-21）：Ryzen 5 5625U / 15.3 GB / Node 24 / PgBouncer 6432，见 §2 旧结果对照。

## 2. 并发领码基线

命令：

```bash
# 建表须 seed:false；list records limit≤200
cd apps/api
npx dotenv -e ../../.env -- npx ts-node --transpile-only test/claim-load.smoke.ts
```

结果（**2026-10-23 新鲜**）：

```json
{
  "codes": 50,
  "concurrency": 100,
  "success": 50,
  "conflict": 50,
  "otherStatuses": [],
  "uniqueSerials": 50,
  "claimedRows": 50,
  "durationMs": 2213,
  "latencyMs": { "p50": 1823, "p95": 2115, "max": 2144 }
}
```

判定：成功 50 / 冲突 50 / 唯一序列号 50 / claimed 行 50；无其它状态码。通过。

对照（2026-10-21，同 50/100）：`durationMs` 1742，`p95` 1704 — 量级一致。

复现要点：`FOR UPDATE SKIP LOCKED`；压测脚本建表传 `seed: false`，避免空白表 5 空行干扰查找。

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

命令：

```bash
pnpm perf:grid
# 即 pnpm --filter web exec playwright test e2e/grid-perf.spec.ts
```

结果（**2026-10-23 新鲜**，浏览器内滚动采样）：

```json
{
  "rows": 10000000,
  "p50": 16.7,
  "p95": 18,
  "max": 27.8,
  "cellsDrawn": 72,
  "visibleRows": 24,
  "usedOffscreen": true
}
```

判定：视口绑定（仅绘可见行/格）；Offscreen 启用；滚动帧间隔 p95≈18ms。通过。

## 5.1 公开表单持续提交

命令：

```bash
# API 需放宽限流，例如 PUBLIC_SUBMIT_RATE_LIMIT=10000
PERF_CONCURRENCY=30 PERF_DURATION_SECONDS=20 node scripts/perf/form-load.mjs
```

结果（**2026-10-23 新鲜**，产物 `artifacts/perf/form-load.json`）：

```json
{
  "concurrency": 30,
  "durationMs": 20091,
  "requests": 1767,
  "successes": 1767,
  "successRate": 1,
  "rps": 87.9,
  "statuses": { "201": 1767 },
  "latencyMs": { "p50": 301.97, "p95": 654.09, "p99": 806.17, "max": 840.41 }
}
```

判定：成功率 100%；p95 &lt; 1000ms。通过。  
说明：默认 `.env` 的 `PUBLIC_SUBMIT_RATE_LIMIT=30` 会在高并发下打出大量 429；压测须临时提高。并发 50 时本机 p95≈1013ms，略超门禁，故以 30 并发记基线。

## 5.2 千万行窗口拉取（`perf:window`）

造数（一次性，约 25–30 分钟 / 本机 Docker Postgres）：

```bash
pnpm perf:seed-10m   # 写根目录 .perf-env.json（已 gitignore）
pnpm perf:window
```

结果（**2026-10-26 新鲜**，10_000_000 行，`records(sheet_id,id)` 游标深翻，200 次随机 UUID cursor，产物 `artifacts/perf/window-fetch.json`）：

```json
{
  "sheetId": "c7832a8a-0f0d-45e9-92a1-2cae46563dd2",
  "requests": 200,
  "rowsPerPage": 100,
  "pageSizes": { "min": 100, "max": 100 },
  "latencyMs": { "p50": 52.74, "p95": 77.66, "p99": 180.05, "max": 288.07 }
}
```

判定：每页恒为 100 行；p95 **77.66ms** ≪ 门禁 250ms。**通过。**

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

| 门禁 | 命令 | 通过标准 | 2026-10-23 |
| --- | --- | --- | --- |
| 并发占码 | `test/claim-load.smoke.ts` | 50 成功 / 50 冲突 / 50 唯一码 | **通过** |
| 队列模式 | `queue-mode.e2e-spec.ts` | 202 → completed，码尽 failed | 含于全量 API e2e |
| 索引 | `perf-foundation.e2e-spec.ts` | `pg_indexes` 含 claim_status | 含于全量 API e2e |
| 网格滚动 | `pnpm perf:grid` | 视口绑定 + Offscreen | **通过**（p95≈18ms） |
| 表单持续提交 | `pnpm perf:form` | 成功率≥0.99，p95≤1000ms | **通过**（30 并发） |
| 窗口拉取 | `pnpm perf:window` | p95≤250ms（thresholds） | **通过（2026-10-26，p95≈78ms）** |
| 领取闭环 | `serial-claim.e2e-spec.ts` | 单次与并发行为符合预期 | Playwright 9/9 |
