# Smart Table Full Delivery Plan (Zero-Compromise)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从空仓库一次交付**完整**私有化智能表格（方案能力地图 + 企微截图能力 + 三项必强 + 压测达标）；禁止任何「后续包 / 简陋替代 / 骨架充数」。

**Architecture:** NestJS(**Fastify**) 无状态 API + PostgreSQL/PgBouncer（JSONB + 旁路列）+ Redis/BullMQ + 占码独立 worker（raw SQL SKIP LOCKED）；公开填表「限流提交 → 写记录 → sync/queue 自动化 → 成功页 merge stepOutputs」。前端 Vue 3 + **多层 Canvas 引擎**（双向虚拟化；DOM 仅编辑浮层）+ HyperFormula。UI 以 `docs/design-refs/wecom/` 为唯一参照。

**Tech Stack（业界顶尖档锁定 — 按「私有化智能表格 + 千万行 + 高峰填表」场景选最优，禁止降级）：**

| 层 | 锁定选型 | 为何算顶尖档 | 禁止（降级项） |
|----|----------|--------------|----------------|
| 前端框架 | Vue 3 + TS + Vite | 组合式 API / 性能成熟；Canvas 主路径下框架不拖后腿 | 用 DOM 表「先顶着」 |
| 网格 | **自研多层 Canvas 引擎**（见下节硬规格） | 与 Google Sheets / 业界百万行表同一路线：Canvas + 双向虚拟化 + DOM 仅编辑浮层 | TanStack/vue-virtual-scroller 作主网格；单层无脏区重绘 |
| 公式 | **HyperFormula**（开源引擎） | 业界最强开源公式引擎之一，勿自造玩具 parser | 正则拼公式 / 无依赖计算 |
| API | NestJS + **Fastify adapter** + TS | Nest 工程化 + Fastify 吞吐优于默认 Express | 热路径打满 ORM |
| 占码/查找热路径 | **独立 worker 入口** + **raw SQL** `FOR UPDATE SKIP LOCKED` + 预处理语句 | 与高并发领号/工单认领同一正确模式 | Prisma `findFirst` 无锁占码 |
| ORM/迁移 | Prisma（结构） | 迁移与类型安全；热路径不经 Prisma | — |
| DB | PostgreSQL 16+ + **PgBouncer**（transaction 模式） | OLTP 事实标准；连接池是百万并发必选项 | 无池直连撑高峰 |
| 旁路列 | `claim_status` 等生成/同步列 + BTREE | JSONB 存灵活 + 热过滤可索引 | 仅 JSONB 表达式全表扫 |
| 队列 | Redis 7 + **BullMQ**（端口抽象，可换 Redis Streams/Kafka） | 任务语义清晰；极端流量可换总线不改业务口 | 进程内 setTimeout 当队列 |
| 对象存储 | MinIO（S3 API） | 私有化 S3 事实标准 | 本地磁盘当唯一附件方案 |
| Excel | **ExcelJS** | 开源可私有化、流式读写 | 不做导入导出 |
| 图表 | **Apache ECharts 5** | 开源图表最强档之一 | 静态 PNG 冒充仪表盘 |
| 聚合 | `AnalyticsQueryPort`：**PG 实现 + ClickHouse 适配器均本计划交付**；compose `profile: analytics` 可启 ClickHouse | 分析与 OLTP 分离 | 仅全表扫主库冒充分析 |
| 密码 | **argon2id** | 密码哈希当代标准 | md5/sha1/明文 |
| 可观测 | OpenTelemetry + Prometheus 指标 + 结构化日志 | 云原生可观测标准 | 只 console.log |
| 部署 | Docker Compose + **K8s Deployment/Service/HPA/Ingress YAML** | 生产扩容标准 | 只写「可上 K8s」空话 |
| 包管理 | pnpm | 严格、快的 monorepo 标准之一 | — |

### Canvas 引擎硬规格（达不到即不合格）

对齐业界百万行表共识（多层 Canvas / 稀疏存储 / rAF），实现必须满足：

1. **多层 Canvas**：至少 Grid / Content / Selection 分层；DOM 仅 cell editor、菜单、a11y  
2. **双向虚拟化**：行+列；overscan；快速滚动可降级占位绘制  
3. **稀疏数据**：窗口/分页拉取，不为空单元格分配对象  
4. **布局**：行高/列宽前缀和用 `Float64Array`（或等价），滚动定位 O(log n)/O(1)  
5. **调度**：`requestAnimationFrame` 合并脏区重绘；禁止每 keypress 全表 clear  
6. **DPI**：`devicePixelRatio` 正确缩放  
7. **数据口**：只向引擎要 viewport 窗口；与 API cursor 对齐  

同档必做增强：OffscreenCanvas **或** Worker 绘制路径至少落地一种（Task 6 验收）。

**Spec:** `docs/智能表格-产品与技术方案.md`；`docs/superpowers/specs/2026-10-20-smart-table-design.md`；`docs/design-refs/wecom/SCREENSHOT-INDEX.md`

## Zero-Compromise Rules（违反即计划不合格）

1. **Task 编号 = 建造顺序，≠ 砍功能或换劣技术。** 全部能力在本文件 Task 1–26；禁止另开「二期范围」文件把能力挪走。
2. **不得**用「先 DOM 表再 Canvas」「先 no-op 发消息」「先不做导入/筛选/OAuth/压测」作为可验收交付物。
3. 相对企微三项必强必须做干净：成功页变量、`limit` 默认 1、并发占码。
4. 性能：本计划内同时交付**骨架 + 达标压测报告**（Task 14 + Task 26）；禁止把压测甩到「下一期产品」。
5. **唯一永不做**（产品边界，不是延期）：CRDT 多人实时、可编辑公网外链、多区域多活、以飞书/Airtable 为对标、**短信验证码**（非企微对标刚需）。  
   **禁止**把跨空间共享 / 公开只读 / Open API / 同步 / 审计配额 / 企微 OAuth / 压测达标 / 仪表盘定时推送 / 表单显示条件 等标成「后续」。

## Global Constraints

- 产品对标仅企业微信智能表格
- `FindRecords.limit` 默认 **1**；修改绑定「上一步查找结果」；步骤变量可插入
- 成功页：`formCells ∪ stepOutputs`（自动化覆盖）；序列号来自码库占用结果
- 占码：同事务 `SELECT … FOR UPDATE SKIP LOCKED`；旁路列 `claim_status`（或等价）可索引
- 同手机号不可重复领：可配，默认开
- 自动化六类动作均要**真实实现**（非 no-op）：发送消息、新增/修改/查找、发起群聊/添加群成员；**NotifyAdapter + WeComAdapter 本计划内落地**（Local 可测，企微凭证可配则打通）
- UI 壳：顶栏（权限/自动化/分享）+ 侧栏对象与新建 + 主区
- monorepo：`apps/web`、`apps/api`、`packages/shared`
- 账号密码与企微 OAuth **双登录均交付**（OAuth 可关，但不能缺实现）

## Review Focus

- 并发领最后一码：一成功一「码尽」，无脏写 → Task 10
- find 空 + stop：成功页无假序列号 → Task 9/10
- 重试幂等不二次占码 → Task 9
- 外链关闭/过期 403 → Task 7
- 成功页变量合并正确 → Task 8/10
- Canvas 网格 10 万行滚动不卡；压测千万行/高峰填表门槛写入报告 → Task 6/14/26
- Excel 往返不丢字段类型 → Task 15
- 内容权限「无权限」对象不可读 → Task 17
- 跨空间只读共享生效；公开只读 token 不可写 → Task 20/21
- Open API 鉴权失败 401；Webhook 至少投递一次 → Task 22
- 配额超限拒绝写 → Task 23

## Scope of THIS plan（完整产品交付，禁止再拆「后续缩水包」）

本文件 **一次交付** 方案能力地图内全部能力：

Canvas 网格+工具栏、字段全量、Excel、表单（含封面/显示条件/二维码）+成功页、自动化六动作+自然语言卡片+月额度+运行日志、对象/行列权限、仪表盘+分析报告+**定时推送**、文件夹/模板、序列号 E2E、性能底座与 K8s、跨工作区共享、公开只读、Open API/Webhook、审计与配额、同步数据（HTTP **与** 文件定时）、企微 OAuth、压测达标报告、方案 §9 全套文档。

建造顺序只体现在 Task 编号；**没有第二份产品范围。**

---

## File Structure

```
apps/api/
  src/
    main.ts
    app.module.ts
    auth/                 # 注册登录 JWT
    workspaces/
    bases/
    sheets/               # sheet / field / record
    forms/                # form config + public submit
    automations/          # definition + runner + logs
    templates/            # 序列号模板种子
    common/               # prisma/typeorm module, guards
  test/
  prisma/                 # 锁定 Prisma（热路径仍 raw SQL）
    schema.prisma
  src/claim-worker/       # 占码/自动化热路径独立入口
apps/web/
  src/
    main.ts
    router/
    grid-canvas/          # Canvas 引擎：viewport, cells, selection, editors overlay
    views/
      login/
      workspace/
      base-shell/
      grid/               # 工具栏 + 挂载 Canvas
      form-builder/
      form-fill/
      automation/
      permissions/
      dashboard/
    api/
packages/shared/
  src/
    field-types.ts        # 截图全量 FieldType 枚举
    automation-types.ts
    form-success.ts
    view-query.ts         # filter/group/sort/color 契约
    api-contracts.ts
deploy/k8s/               # api, web, hpa, ingress 示例
docker-compose.yml
pnpm-workspace.yaml
package.json
```

**ORM:** Prisma 管迁移；占码/查找热路径 **raw SQL**。表名稳定。

**Core tables:** `users`, `workspaces`, `workspace_members`, `bases`, `sheets`, `fields`, `records`（含 `claim_status` 等旁路列）, `views`, `forms`, `automations`, `automation_runs`, `automation_run_steps`, `notifications`, `object_acls`, `dashboards`, `charts`.

---

### Task 1: Monorepo + Docker skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `apps/api/package.json`, `apps/web/package.json`, `packages/shared/package.json`, `apps/api/src/main.ts`, `apps/web/src/main.ts`, `.env.example`, `README.md`（仅启动说明）
- Test: `apps/api/test/health.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `GET /health` → `{ status: "ok" }`；`docker compose up` 起 postgres:5432、**pgbouncer**、redis:6379、minio:9000

- [ ] **Step 1: Write failing health e2e**

```ts
it("GET /health returns ok", async () => {
  const res = await request(app.getHttpServer()).get("/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: "ok" });
});
```

- [ ] **Step 2: Run test — expect FAIL (app missing)**

Run: `pnpm --filter api test:e2e -- health`

- [ ] **Step 3: Scaffold Nest hello + Compose + pnpm workspaces; implement `/health`**

- [ ] **Step 4: Run test — expect PASS；`docker compose up -d postgres pgbouncer redis minio` healthy**

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml docker-compose.yml apps packages .env.example README.md
git commit -m "chore: scaffold monorepo, compose, and health endpoint"
```

---

### Task 2: Shared contracts — field & automation types

**Files:**
- Create: `packages/shared/src/field-types.ts`, `packages/shared/src/automation-types.ts`, `packages/shared/src/form-success.ts`, `packages/shared/src/view-query.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/automation-types.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `FieldType`：**截图全量枚举**（文本/单选/多选/数字/百分数/货币/进度/日期/人员/群聊/图片/文件/关联/链接/电话/邮箱/地理位置/复选框/条码/自动编号/公式/查找引用/创建人/最后编辑人/创建时间/最后编辑时间 + AI 入口位）
  - `FindRecordsStep` / `ModifyRecordsStep` / `SendMessageStep` / `CreateRecordStep` / …；`limit` 默认 1
  - `ViewQuery`：`filters` / `groups` / `sorts` / `rowHeight` / `colorRules`
  - `renderSuccessTemplate`；`buildSuccessValues`

- [ ] **Step 1: Write failing tests `defaultFindLimitIsOne` + `fieldTypeEnumCoversWecomScreenshotList`**

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement contracts（公式/查找引用类型完整；求值在 Task 16 接 HyperFormula，本任务不得省略类型）**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** `feat(shared): full field types and automation contracts`

---

### Task 3: Auth (password) + Prisma schema baseline

**Files:**
- Create: `apps/api/prisma/schema.prisma`（User）、`apps/api/src/auth/*`
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1 app module
- Produces:
  - `POST /auth/register` `{ email, password, name }` → `{ accessToken, user }`
  - `POST /auth/login` → same
  - Jwt guard `Authorization: Bearer`

- [ ] **Step 1: Failing e2e register→login→authenticated ping**

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Prisma User + Nest AuthModule（**必须 argon2id**）；`GET /auth/me`；HTTP 适配器为 Fastify

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** `feat(api): password auth and user table`

---

### Task 4: Workspace + Base

**Files:**
- Create: `apps/api/src/workspaces/*`, `apps/api/src/bases/*`；schema 增 `Workspace` `WorkspaceMember` `Base`
- Test: `apps/api/test/workspace-base.e2e-spec.ts`

**Interfaces:**
- Consumes: Jwt user
- Produces:
  - `POST /workspaces` `{ name }` → workspace（创建者=owner）
  - `POST /workspaces/:id/bases` `{ name }` → base
  - `GET /workspaces/:id/bases` → list
  - **成员**：邀请/移除/改角色（owner|admin|editor|viewer）；顶栏「加人」可用

- [ ] **Step 1: Failing e2e create workspace + base + invite member**

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** `feat(api): workspaces bases and members`

---

### Task 5: Sheet, Field, Record API

**Files:**
- Create: `apps/api/src/sheets/*`；schema `Sheet` `Field` `Record`
- Test: `apps/api/test/sheet-records.e2e-spec.ts`

**Interfaces:**
- Consumes: Base id
- Produces:
  - `POST /bases/:baseId/sheets` `{ name }`
  - `POST /sheets/:sheetId/fields` `{ name, type, options? }`
  - `POST /sheets/:sheetId/records` `{ cells: Record<fieldId, unknown> }`
  - `PATCH /records/:id` `{ cells }`
  - `GET /sheets/:sheetId/records?cursor&limit`（**仅 cursor**；`limit` 默认 50、最大 200）
  - Record shape: `{ id, sheetId, cells, version }`
  - 索引最低要求：`(sheet_id, id)`；占码常用过滤可走表达式/生成列或旁路列（Task 11 种子对「状态」建可查询路径，禁止全表 JSON 扫作为唯一实现）

- [ ] **Step 1: Failing e2e — create 码库 sheet with 序列号/状态/手机号 fields + 2 rows；第二页 cursor 不重复**

- [ ] **Step 2–4: Implement + PASS**（cells JSONB + version；列表无 OFFSET）

- [ ] **Step 5: Commit** `feat(api): sheets fields records CRUD`

---

### Task 6: Web shell + Canvas grid engine

**Files:**
- Create: `apps/web/src/grid-canvas/**`；`views/base-shell/*`；`views/grid/*`；`views/login/*`
- Test: `apps/web/src/grid-canvas/viewport.spec.ts`；Playwright `e2e/grid-canvas.spec.ts`

**Interfaces:**
- Consumes: Task 3–5 APIs（cursor 加载窗口）
- Produces:
  - Canvas 绘制表头/单元格/选区；仅编辑时挂载 DOM overlay
  - 工具栏入口齐：添加一行、表格设置、筛选、分组、排序、行高、填色（行为 Task 16 接通，**入口本任务即可见可点**）
  - 壳对齐 `10-grid-table/01-code-library-grid.png`（顶栏：成员/分享/评论/内容权限/自动化；**评论**可发表与列表）
  - 性能断言：模拟 **100_000** 行，每帧绘制 ≤ 可视区+overscan；OffscreenCanvas 或 Worker 路径必有其一

- [ ] **Step 1: Failing test — CanvasGrid mounts；100k rows does not create 100k DOM cells；worker/offscreencanvas path exists**

- [ ] **Step 2–4: 实现引擎 + 壳 + 登录拉数；单元格编辑、列宽拖拽、表格设置（字段显隐，对照 `02-table-settings.png`）**

- [ ] **Step 5: Commit** `feat(web): canvas grid engine and base shell`

---

### Task 7: Form config + public submit

**Files:**
- Create: `apps/api/src/forms/*`；schema `Form`；`apps/web/views/form-builder/*`；`apps/web/views/form-fill/*`
- Test: `apps/api/test/forms-public.e2e-spec.ts`

**Interfaces:**
- Consumes: Sheet fields
- Produces:
  - Form: `{ id, baseId, name, coverUrl?, fields: [{ fieldId, required, displayConditions? }], share: { enabled, audience, expiresAt?, qrUrl }, successPage: { templateHtml } }`
  - `displayConditions`：字段级显示条件（对照工具条「显示条件」）
  - `POST /forms/:id`（auth）upsert；支持封面上传（MinIO）
  - `GET /public/forms/:token` → 可填字段（按显示条件求值后）
  - `POST /public/forms/:token/submit` → `{ submissionId, recordId, status: "completed"|"pending", success?: { html }, pollUrl?: string }`
  - share.enabled=false / 过期 → 403；**二维码 URL** 必有
  - sync/queue 双模（Task 14）；**公开提交限流**（IP+token）→ 429

- [ ] **Step 1: Failing e2e — share/submit/403/429；displayConditions hide field；cover persisted**

- [ ] **Step 2–4: Implement + PASS**；UI 对照 `11-form-builder/*` + `06-share-public/01-share-form.png`

- [ ] **Step 5: Commit** `feat: form share qr cover display-conditions rate-limit`

---

### Task 8: Success page variable rendering

**Files:**
- Modify: `apps/api/src/forms/public-submit*`；`packages/shared/src/form-success.ts`
- Test: `apps/api/test/form-success-page.e2e-spec.ts`

**Interfaces:**
- Consumes: `renderSuccessTemplate`
- Produces:
  - `buildSuccessValues({ formCells, stepOutputs }): Record<string,string>` — **stepOutputs 覆盖同名 formCells**
  - `successPage.templateHtml` 例：`领取成功，你的序列号是 {{序列号}}`
  - 未知变量保留 `{{…}}`；不得 500

- [ ] **Step 1: Failing unit/e2e — formCells 无序列号、stepOutputs 有 `序列号=TEST-01` → html 含 `TEST-01`**

- [ ] **Step 2–4: Implement merge + render；本任务可用 mock stepOutputs，真实自动化在 Task 10 接通**

- [ ] **Step 5: Commit** `feat(forms): success page variables merge automation outputs`

---

### Task 9: Automation engine — trigger, find(limit=1), modify(bind step), logs

**Files:**
- Create: `apps/api/src/automations/*`；schema `Automation` `AutomationRun` `AutomationRunStep`；BullMQ worker
- Test: `apps/api/test/automation-runner.e2e-spec.ts`

**Interfaces:**
- Consumes: Record create events；shared step types
- Produces:
  - Automation definition：`trigger: { type: "recordCreated"; sheetId; filters }` + `steps[]` + `onFindEmpty: "continue"|"stop"`
  - Runner：`runAutomation(automationId, context) → { runId, status, stepOutputs }`
  - Find：应用 filters，**`LIMIT` = step.limit（默认 1）**，`FOR UPDATE SKIP LOCKED` 当后续 modify 占用时
  - Modify：`target.fromStep` 解析为查找输出的 record ids
  - `GET /automations/:id/runs` 列表（对照 `04-automation/14-run-details-log.png` 字段：时间、状态、耗时）
  - 幂等：`context.idempotencyKey` 唯一

- [ ] **Step 1: Failing e2e — 3 unclaimed codes；trigger on form sheet create with phone not empty → find status=未领 limit 1 → modify set 已领 + phone → run success；second run gets different code**

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Runner + Queue 双入口；六类动作均实现**
  - `findRecords` / `modifyRecords`（**指定内容**字段映射 UI+API 完整，非仅 seed）/ `createRecord` / `sendMessage`（`notifications` + **文档动态 toast 数据**）/ `startGroupChat` / `addGroupMembers`（`NotifyAdapter`）
  - 列表卡：自然语言步骤摘要 + **月额度**展示；步骤变量菜单对齐截图（自然时间 / 第 N 步字段）
  - 序列号：**成功页 + sendMessage 双通道都真做**

- [ ] **Step 4: Run — PASS**；find 空 + stop；sendMessage → notification；modify 指定内容写多字段

- [ ] **Step 5: Commit** `feat(api): full automation actions with limit-1 find`

---

### Task 10: Form submit ↔ automation ↔ success page (claim path)

**Files:**
- Modify: `apps/api/src/forms/public-submit*`；`apps/api/src/automations/*`
- Test: `apps/api/test/serial-claim.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 7–9
- Produces:
  - 提交后触发绑定到「收集表单」sheet 的 automation（短流程同步）
  - 成功：用 Task 8 的 `buildSuccessValues` 合并后渲染，`success.html` **必须含码库占用到的序列号**
  - 码尽：明确错误（HTTP 409/422 或错误页），无脏写
  - 并发：`Promise.all` 10 提交 × 5 码 → 恰好 5 成功 5 失败，序列号无重复
  - modify「指定内容」种子至少写：状态→已领、手机号←表单、领取时间←now

- [ ] **Step 1: Write failing concurrent claim test + happy path success html（断言序列号来自码库）**

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Wire submit→run；占码与 modify 同事务；幂等键=`submissionId`；成功页走 merge**

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** `feat: serial claim path with concurrent safety and success page`

---

### Task 11: Phone uniqueness (configurable) + serial template seed

**Files:**
- Create: `apps/api/src/templates/serial-claim.seed.ts`；form/automation 配置位 `rejectDuplicatePhone: boolean`（默认 true）
- Test: `apps/api/test/serial-claim-phone.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 10
- Produces:
  - Seed：Base「序列号领取」含码库 sheet（字段序列号/状态/领取时间/手机号）、收集表单、自动化「联动修改」、成功页模板
  - 同手机号第二次提交 → 4xx「不可重复领取」；关闭开关后允许

- [ ] **Step 1: Failing e2e duplicate phone**

- [ ] **Step 2–4: Implement + seed command `pnpm --filter api seed:serial-claim` + PASS**

- [ ] **Step 5: Commit** `feat: serial-claim template seed and duplicate phone guard`

---

### Task 12: Web form fill + success page + automation list (UI)

**Files:**
- Create/Modify: `apps/web/views/form-fill/*`；`apps/web/views/form-builder/*`；`apps/web/views/automation/*`
- Test: Playwright `apps/web/e2e/serial-claim.spec.ts`

**Interfaces:**
- Consumes: public submit + runs API
- Produces: 浏览器 E2E — 打开分享链接 → 填手机号 → 成功页可见序列号；管理端可见自动化运行成功日志一行

- [ ] **Step 1: Failing Playwright against compose stack + seed**

- [ ] **Step 2–4: UI 对照 SCREENSHOT-INDEX A4/A5（信息架构与交互对齐截图；允许非像素级视觉）+ PASS**

- [ ] **Step 5: Commit** `feat(web): form fill success page and automation run list`

---

### Task 13: Compose product stack + required docs pack

**Files:**
- Modify: `docker-compose.yml`（api/web/claim-worker；analytics profile）
- Create: `docs/DEPLOYMENT.md`、`docs/PRD.md`、`docs/DATA_MODEL.md`、`docs/AUTOMATION.md`、`docs/FORM_SUCCESS_PAGE.md`、`docs/TEMPLATES.md`（方案 §9 清单；可与实现同步定稿，**本 Task 结束前文件必须存在且非空壳**）
- Test: `pnpm smoke:compose`

**Interfaces:**
- Produces: `docker compose up --build` 可完成一次领取；备份/恢复与迁移升级写明；§9 文档齐套

- [ ] **Step 1: Smoke script + docs file list assertion**

- [ ] **Step 2–4: Wire services + write docs + PASS smoke**

- [ ] **Step 5: Commit** `chore: compose stack and product docs pack`

---

### Task 14: Performance foundation (mandatory)

> 可扩展架构本 Task 落地；**达标压测报告在 Task 26 完成（同属本计划）**。二者缺一不可。

**Files:**
- Create: `docs/PERFORMANCE.md`；`deploy/k8s/api-deployment.yaml`；`deploy/k8s/api-hpa.yaml`；`deploy/k8s/web-deployment.yaml`；`deploy/k8s/README.md`
- Modify: `SUBMIT_MODE=sync|queue`；占码 raw SQL + `claim_status` 索引；OTel metrics 导出
- Test: `apps/api/test/perf-foundation.e2e-spec.ts`；`apps/api/test/claim-load.smoke.ts`（**100 并发 / 50 码** 必过）

**Interfaces:**
- Consumes: Task 5/6/7/9/10
- Produces:
  - `PERFORMANCE.md`：北星（百万填表可扩展、千万行 Canvas 顺滑）+ 本阶段门槛数字（机器规格、p95、并发领码）；最终以 Task 26 报告为准
  - queue/sync 双模；JWT 无粘滞
  - **可 apply 的 K8s YAML**（非空文档）；Compose↔K8s 功能集相同

- [ ] **Step 1: Failing — queue poll + claim_status migration + load smoke harness exists**

- [ ] **Step 2–4: Implement + PASS；写入基线到 PERFORMANCE.md**

- [ ] **Step 5: Commit** `feat: performance foundation, otel, real k8s manifests`

---

### Task 15: Excel import / export

**Files:**
- Create: `apps/api/src/sheets/excel.*`；`apps/web` 导入入口（侧栏「导入表格」）
- Test: `apps/api/test/excel-roundtrip.e2e-spec.ts`

**Interfaces:**
- Consumes: Sheet/Field/Record
- Produces: `POST /sheets/:id/import`（xlsx）；`GET /sheets/:id/export`；**所有标量/选项类 FieldType 往返正确**；附件类导出为 URL/文件名列并文档说明

- [ ] **Step 1: Failing roundtrip test**

- [ ] **Step 2–4: ExcelJS 实现 + PASS**

- [ ] **Step 5: Commit** `feat: excel import export`

---

### Task 16: View query — filter / group / sort / row height / color + HyperFormula

**Files:**
- Create: `apps/api/src/views/*`；`apps/web` 工具栏完整面板；HyperFormula 集成
- Test: `apps/api/test/view-query.e2e-spec.ts`；`packages/shared` 或 api 公式单测

**Interfaces:**
- Consumes: `ViewQuery`；Canvas 网格
- Produces: 服务端 filter/sort；group/color 回传绘制；**HyperFormula** 求值（常用函数集写入 AUTOMATION/DATA_MODEL 文档清单并测覆盖）；查找引用可解析关联表字段

- [ ] **Step 1: Failing — filter 状态=未领；sort；公式 `=1+1` 与跨字段引用**

- [ ] **Step 2–4: Implement 完整工具栏面板（无截图则按企微常见交互自洽，**不得省略能力**）**

- [ ] **Step 5: Commit** `feat: view query and hyperformula`

---

### Task 17: Content permissions (object ACL)

**Files:**
- Create: `apps/api/src/permissions/*`；`apps/web/views/permissions/*`
- Test: `apps/api/test/object-acl.e2e-spec.ts`

**Interfaces:**
- Consumes: Base 对象列表
- Produces: 全员档位 `full|edit|view|none`；指定成员额外权限；`none` 不可读；**行/列细规则完整可配可生效**（可编辑范围、可添加/删除、可首次提交、按字段可编辑/可查看）对照 `05-permissions/06|07`

- [ ] **Step 1: Failing — none 不可读；行条件限制下不可编辑越权行；可首次提交语义测通**

- [ ] **Step 2–4: Implement + UI 对照 `05-permissions/*` 全套**

- [ ] **Step 5: Commit** `feat: content permissions full ACL`

---

### Task 18: Dashboard + charts (ECharts)

**Files:**
- Create: `apps/api/src/dashboards/*`；`apps/web/views/dashboard/*`
- Test: `apps/api/test/charts.e2e-spec.ts`

**Interfaces:**
- Consumes: Sheet 聚合
- Produces:
  - 仪表盘 + **分析报告**对象；图表类型对齐截图枚举；基础/更多配置；画布整页可添加多图
  - **仪表盘定时推送自动化**（对照 `dashboard/03-dashboard-automation/*`：定时触发 + 发消息附仪表盘）
  - `AnalyticsQueryPort`：PG + ClickHouse 适配器；compose `profile: analytics`

- [ ] **Step 1: Failing — bar agg；schedule automation creates run；ClickHouse adapter unit**

- [ ] **Step 2–4: ECharts + 定时推送 + UI 对照 dashboard 截图全套**

- [ ] **Step 5: Commit** `feat: dashboard charts schedule automation analytics port`

---

### Task 19: Folder / template library / side-nav create menu

**Files:**
- Create: folder 实体；模板库弹窗（对照 `shared/01-templates`）；侧栏新建全项可点
- Test: `apps/api/test/folders-templates.e2e-spec.ts`

**Interfaces:**
- Produces: 文件夹嵌套对象；「从模板新建」可一键生成序列号模板（复用 Task 11 seed）

- [ ] **Step 1–5: Implement + commit** `feat: folders and template library`

---

### Task 20: Cross-workspace share

**Files:**
- Create: `apps/api/src/sharing/cross-workspace.*`；web 授权 UI
- Test: `apps/api/test/cross-workspace-share.e2e-spec.ts`

**Interfaces:**
- Produces: Workspace A 可将 Base/Sheet **授权**给 Workspace B（角色：view/edit）；B 成员按 ACL 可见；撤销立即失效

- [ ] **Step 1: Failing — B user reads shared sheet; revoke → 403**

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** `feat: cross-workspace sharing`

---

### Task 21: Public read-only views

**Files:**
- Create: `apps/api/src/public-views/*`；`apps/web` 公开只读页
- Test: `apps/api/test/public-readonly.e2e-spec.ts`

**Interfaces:**
- Produces: 公开只读链接（可密码/有效期）；**GET 可见、任何写操作 403**；与「可编辑公网外链」严格区分

- [ ] **Step 1: Failing — read ok with token; PATCH record → 403**

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** `feat: public read-only views`

---

### Task 22: Open API + Webhook

**Files:**
- Create: `apps/api/src/openapi/*`；`apps/api/src/webhooks/*`；API Key 管理 UI
- Test: `apps/api/test/openapi-webhook.e2e-spec.ts`

**Interfaces:**
- Produces: REST（workspaces/bases/sheets/fields/records/forms 读写能力与产品一致）+ API Key；Webhook 订阅 `record.created|updated|deleted`；HMAC 签名；失败重试（至少一次）+ 死信可查

- [ ] **Step 1: Failing — API key auth; webhook delivered on create**

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** `feat: open api and webhooks`

---

### Task 23: Audit log + quotas

**Files:**
- Create: `apps/api/src/audit/*`；`apps/api/src/quotas/*`；管理员策略 UI
- Test: `apps/api/test/audit-quota.e2e-spec.ts`

**Interfaces:**
- Produces: 操作审计可查；自动化运行次数/存储/席位等配额（安装管理员策略）；超限拒绝并有明确错误码

- [ ] **Step 1: Failing — audit row on record update; quota exceed blocks submit**

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** `feat: audit log and admin quotas`

---

### Task 24: Sync data (external source)

**Files:**
- Create: `apps/api/src/sync/*`；侧栏「同步数据」向导
- Test: `apps/api/test/sync-data.e2e-spec.ts`

**Interfaces:**
- Produces：**两种同步源都做** —— (1) HTTP JSON API (2) 上传 CSV/Excel 定时覆盖；字段映射；手动触发 + Cron；失败进运行日志/审计

- [ ] **Step 1: Failing — HTTP sync + file sync 各一条 fixture 用例**

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** `feat: sync http and file into sheets`

---

### Task 25: WeCom OAuth + WeCom NotifyAdapter

**Files:**
- Create: `apps/api/src/auth/wecom.*`；`apps/api/src/notify/wecom.adapter.ts`；登录页企微入口
- Test: `apps/api/test/wecom-oauth.e2e-spec.ts`（可用 mock IdP）

**Interfaces:**
- Produces: 企微 OAuth 登录（可配置关闭）；通讯录用户映射；`WeComAdapter` 发应用消息；无凭证时集成测试走 mock，**代码路径必须存在且可切换**

- [ ] **Step 1: Failing — mock OAuth issues JWT; notify adapter invoked from sendMessage**

- [ ] **Step 2–4: Implement + PASS**

- [ ] **Step 5: Commit** `feat: wecom oauth and notify adapter`

---

### Task 26: Performance gate (达标压测，本计划内完成)

**Files:**
- Create: `docs/PERFORMANCE.md`（完整门槛与报告）；`scripts/perf/*`（k6 或 autocannon + 网格 bench）
- Modify: 不足则回头改索引/队列/Canvas，**不得删门槛**
- Test: CI 可跑的 soft gate + 人工/流水线 full gate

**Interfaces:**
- Produces: 书面达标（按给定 K8s/机器规格写入数字）：
  1. 公开填表高峰：可持续压测时长与成功占比（目标量级：向百万并发**可扩展**，报告含水平扩副本曲线）
  2. 单表 **≥1000 万行** 种子下 Canvas 滚动/窗口拉取 p95 达标（具体 ms 写入文档）
  3. 占码：≥1000 并发领码零重复
  未达标 = 本计划未完成

- [ ] **Step 1: Write failing gate scripts + empty PERFORMANCE thresholds**

- [ ] **Step 2–4: Run, tune, fill report until PASS**

- [ ] **Step 5: Commit** `chore: performance gate report passed`

---

## Acceptance Matrix（无懈可击核对表）

| # | 能力 | Task | 验收要点 |
|---|------|------|----------|
| A1 | 账号密码 + 企微 OAuth | 3、25 | 双路径；OAuth 可关不可缺 |
| A2 | 工作区/成员/Base | 4 | 邀请成员生效 |
| A3 | Sheet/Field/Record + cursor | 5 | 无 OFFSET；旁路列可索引 |
| A4 | Canvas 网格 + 表格设置 + 顶栏评论 | 6 | 多层+虚拟化+Worker/Offscreen；显隐字段；评论可发可列 |
| A5 | 筛选/分组/排序/行高/填色 | 16 | 工具栏完整；服务端生效 |
| A6 | 字段全量 + HyperFormula | 2、16 | 截图类型全有；公式可算 |
| A7 | Excel 导入导出 | 15 | 标量/选项往返 |
| A8 | 表单编辑/填写/封面/显示条件/分享/二维码/限流 | 7、12 | 对照截图 |
| A9 | 成功页动态变量 | 8、10、12 | merge stepOutputs |
| A10 | 自动化六动作+变量+日志+月额度+指定内容 | 9 | 非 no-op |
| A11 | 序列号 E2E + 并发 + 手机号 | 10、11 | 不重码；可配去重 |
| A12 | 内容权限行列表 | 17 | 对照 05-permissions 全套 |
| A13 | 仪表盘+分析报告+定时推送+分析口 | 18 | 含 dashboard 自动化截图 |
| A14 | 文件夹+模板库+侧栏新建 | 19 | 从模板可建序列号场景 |
| A15 | 跨空间共享 | 20 | 授权/撤销 |
| A16 | 公开只读 | 21 | 只读不可写 |
| A17 | Open API + Webhook | 22 | 签名+重试 |
| A18 | 审计+配额 | 23 | 超限拒绝 |
| A19 | 同步 HTTP + 文件 | 24 | 两种源 |
| A20 | 性能底座+K8s+OTel | 14 | YAML 可 apply |
| A21 | 压测达标报告 | 26 | 未达标=未完成 |
| A22 | Compose+备份+§9 文档 | 1、13 | 文档非空壳 |
| X1 | CRDT / 可编辑外链 / 多活 / 飞书对标 / 短信 | — | **明确永不做** |

任一 A* 无对应实现与测试 → 计划执行不合格。

---

## Spec coverage (self-check)

| Spec 要求 | Task |
|-----------|------|
| 账号 / 工作区 / Base / Sheet / Field / Record | 3–5 |
| **Canvas 网格** + 企微壳 | 6 |
| 筛选/分组/排序/填色/行高 | 16 |
| 字段类型全量 + HyperFormula | 2、16 |
| Excel 导入导出 | 15 |
| 表单分享/二维码/限流/填写 | 7、12 |
| 成功页动态变量 | 8、10、12 |
| 自动化六动作 + limit=1 + 日志 | 9 |
| 并发占码 / 码尽 / 手机号 | 10、11 |
| 内容权限 | 17 |
| 仪表盘 + 分析报告 + 定时推送 / ECharts / ClickHouse | 18 |
| 文件夹 / 模板库 | 19 |
| 性能底座 + K8s + OTel | 14 |
| Compose + 备份 + §9 文档包 | 1、13 |
| 跨工作区共享 | 20 |
| 公开只读视图 | 21 |
| Open API + Webhook | 22 |
| 审计 + 配额 | 23 |
| 同步 HTTP + 文件 | 24 |
| 企微 OAuth + 消息适配器 | 25 |
| 压测达标报告 | 26 |
| CRDT / 可编辑外链 / 多活 / 飞书对标 / 短信 | **永不做** |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-20-phase0-1-core-serial-claim.md`.

Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — 每个 Task 新开子代理实现 + 独立审查，最后全分支审查。更稳，费上下文。
- **Native** — 本会话我按 Task 顺序直接实现，最后再做一次分支审查。更快。

**推荐 Native**：仓库尚空、Task 接口链式强依赖，单会话推进脚手架对齐成本更低。

Does the plan capture what you want, and which approach should we use?
