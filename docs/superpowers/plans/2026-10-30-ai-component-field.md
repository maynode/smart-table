# AI 智能组件字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship table field type `aiComponent`：多轮对话生成沙箱 HTML/JS，经 bridge 读写单元格/本行/自动化，并按 AI 预定的 `gridContract` 参与筛选、排序、导出。

**Architecture:** Shared 定义类型与 `gridContract` 取值；API 提供 chat/generate/publish + bundle 存储；Web 字段菜单 + 配置对话坞 + iframe 沙箱宿主；网格点击挂载，值经现有 MessageCenter/HTTP 提交。

**Tech Stack:** NestJS、Prisma（字段 options JSON，无新列亦可）、Vue 3、iframe sandbox、`ANALYSIS_LLM_*`、现有对象存储。

**Spec:** `docs/superpowers/specs/2026-10-30-ai-field-interactive-component-design.md`

## Global Constraints

- 独立类型 `aiComponent` / 文案「智能组件」；保留现有 `ai` 填值。
- 运行态：通用 HTML/JS + iframe；bridge 经 ACL；外网默认关。
- 发布必须含完整 `gridContract`；草稿仅配置者可见。
- 回滚不自动清 cell；不兼容则占位提示。
- setRow/自动化在用户 ACL 内尽量放开 + 频控。

## Review Focus

- 无 LLM Key 时不得假 publish。
- viewer 不能 publish bundle。
- 未声明的 bridge 能力必须拒绝。
- 万行表不得每行常驻 iframe。
- 缺 `gridContract` 的字段不能进入 published。

---

### Task 1: Shared — `aiComponent` 类型 + `gridContract` 工具

**Files:**
- Modify: `packages/shared/src/field-types.ts`
- Create: `packages/shared/src/ai-component-contract.ts`
- Create: `packages/shared/src/ai-component-contract.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `AiComponentGridContract`, `AiComponentOptions`, `parseGridContract`, `isPublishableGridContract`, `readSortKey`, `formatExportDisplay`

- [ ] **Step 1:** 单测：合法 contract 可 parse；缺 sortKey/filter/exportDisplay 则 `isPublishableGridContract` 为 false；`readSortKey` 从 `{ rating: 4 }` + path `rating` 得到 4；`formatExportDisplay` 按模板输出。
- [ ] **Step 2:** 实现类型与函数；`FIELD_TYPES` 增加 `aiComponent`；标签「智能组件」；**不要**放进 `COMPUTED_FIELD_TYPES`（值由用户经 bridge 写入）；加入 `FORM_NON_FILLABLE_FIELD_TYPES`。
- [ ] **Step 3:** `pnpm --filter shared test` 相关用例通过。

### Task 2: Web — 字段菜单 + 空配置壳

**Files:**
- Modify: `apps/web/src/components/FieldTypePicker.vue`
- Create: `apps/web/src/components/AiComponentFieldPanel.vue`（对话坞占位：说明 + 预览区）
- Modify: `apps/web/src/components/FieldOptionsEditor.vue`（`aiComponent` 分支挂载 panel）

- [ ] **Step 1:** 新建字段可选「智能组件」；默认 options 含空 `aiComponent: { status: 'draft' }`。
- [ ] **Step 2:** 配置侧打开 panel（暂无 LLM 也可保存字段）。

### Task 3: Web — iframe 宿主 + bridge（固定 bundle 可测）

**Files:**
- Create: `apps/web/src/ai-component/bridge.ts`
- Create: `apps/web/src/ai-component/AiComponentHost.vue`
- Modify: `apps/web/src/components/CanvasGrid.vue` / `GridPanel.vue`：点击 `aiComponent` 打开 Host
- Test: `apps/web/src/ai-component/bridge.spec.ts`（若 vitest 可测 postMessage 协议）

**Interfaces:**
- Produces: Host props `{ bundleHtml, fieldId, recordId, getCell, setCell, getRow, setRow }`；协议 `smartTable:*` postMessage

- [ ] **Step 1:** 用内联五星 HTML 固定 bundle：点星调用 `setCell`。
- [ ] **Step 2:** Host 挂载 iframe sandbox，注入 bridge 脚本。
- [ ] **Step 3:** 手工或 vitest 验证 setCell 回调被调用。

### Task 4: API — session / generate / publish 骨架

**Files:**
- Create: `apps/api/src/ai-component/*`（module/service/controller）
- Wire module into sheets or app module
- Endpoints per spec: chat / generate / publish；无 LLM 时 chat 返回明确错误码

- [ ] **Step 1:** e2e 或 service 单测：publish 缺 gridContract → 400。
- [ ] **Step 2:** 实现存储 draft/published 写入 field.options；bundle 可先存 options 内小 HTML（后续再迁对象存储）。
- [ ] **Step 3:** 接上 Web panel 真实调用。

### Task 5: gridContract 接入筛选/排序/导出

**Files:**
- Modify: view-query / filter-eval / excel export paths to use `readSortKey` / `formatExportDisplay` for `aiComponent`

- [ ] **Step 1:** 单测：按 rating 排序两条记录。
- [ ] **Step 2:** 导出列使用 exportDisplay。

### Task 6: e2e 冒烟（跳过 LLM）

**Files:**
- Create: `apps/web/e2e/ai-component.spec.ts`

- [ ] **Step 1:** API 直接 PATCH 字段为已发布固定 bundle + gridContract → UI 点星 → 刷新仍在。

---

执行顺序：1 → 2 → 3 → 4 → 5 → 6。每完成一 Task 保持可合并的增量。
