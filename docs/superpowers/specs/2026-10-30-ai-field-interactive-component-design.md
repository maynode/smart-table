# AI 字段：对话生成可交互沙箱组件（设计）

> 日期：2026-10-30  
> 状态：已定稿（2026-10-30）；进入实现  
> 范围：表格字段（非整页 App / 非仪表盘 Agent）

## 1. Intent

用户在表格字段配置里用**多轮对话**描述想要的格子能力；AI 判断是否合理、能否落地；确认后**生成可运行的通用 HTML/JS 组件**，嵌在单元格沙箱中，并**自动对接**表格数据（本格、本行其它列、可触发自动化等「最大可用权限」——仍受当前用户在该表的 ACL 约束）。

与企微智能表格「AI 字段」不同：企微主路径是**智能填列（加工数据写入单元格）**；本设计是**生成字段交互 UI 并绑定数据**。本仓现有 `type: 'ai'` 的模板填字可作为「填值技能」保留或后续合并，**不**作为本能力的实现形态。

## 2. Goals / Non-goals / Anti-goals

### Goals

- 多轮会话：澄清需求、拒不合理/不可行请求，并说明原因。
- 产出可交互组件（不仅展示）：评分、表单片段、按钮流程等不预先用窄白名单卡死「控件种类」。
- 运行时用**通用 HTML/JS**（与主站 Vue 脱钩），iframe（或等价）沙箱隔离。
- 自动对接：读写当前单元格、读写本行其它字段、触发自动化等**尽量最强**（仍受当前用户 ACL）；值变更走现有记录提交 / 协同路径。
- **筛选 / 排序 / 导出**不是事后凑合：生成阶段由 AI 一并确定并写入字段规格（比较键、筛选算子、导出展示文案），主站按规格接入网格与导出。
- 可预览、可确认后再发布；可卸载/回退，避免整表不可用。

### Non-goals（本期不做）

- 生成主站 Vue SFC 或改仓库源码。
- 企微 `ai-field-template.json` / `smartsheet-bi` 协议孪生。
- 像素级复刻企微 AI 字段模板市场（可后续做「填值类」模板，与本能力并列）。
- 离线环境下生成或执行沙箱组件（沿用现有 offline 对 AI 硬阻断策略，或明确降级为只读展示缓存值）。

### Anti-goals（做成这样算失败）

- 「万能」变成无沙箱任意代码，拖垮页面或越权读全库。
- 只生成一段说明文案 / 只填文本，无法交互。
- 声明式窄控件目录导致五星评分都做不了（产品已否决该主路径）。

## 3. Constraints

- 身份与协同：单元格值变更必须走现有 `commitchanges` / collab 路径，带 `clientOpId`、权限校验。
- 权限：沙箱 bridge 所有读写下发均以**当前登录用户**对 sheet 的 ACL 为准；「最大权限」= 用户已有权限的上限，不是绕过 ACL。
- 安全：默认禁止未授权外网；若产品后续要开放外网，须显式授权 + 管理员策略（本期默认关）。
- 私有化：LLM 走现有 `ANALYSIS_LLM_*`（或独立 `AI_FIELD_COMPONENT_LLM_*`，实现时二选一写进 env 文档）；无 Key 时会话可本地规则拒答/降级，不得静默假成功。
- 性能：虚拟滚动下沙箱不能为每一可见行都起一个重型 iframe 常驻；需「编辑/聚焦时挂载」或轻量缩略 + 展开策略（实现时选定并测网格滚动）。

## 4. Product shape

### 4.1 字段类型

新增（或升级）字段类型，建议独立名以免与填值 AI 混淆：

- 建议：`type: 'aiComponent'`（展示名：**智能组件**）  
- 若产品坚持挂在现有「AI 字段」入口：同一菜单下分子类型 `fill` | `component`；默认实现按独立类型描述。

**Builder 默认（我的决定）：** 使用独立 `aiComponent`，菜单文案「智能组件」；保留现有 `ai` 填值类型不动。

### 4.2 配置面

字段配置侧开「对话」面板（可参考分析报告 / 仪表盘 AI dock）：

1. 用户描述目标交互与数据。  
2. AI 多轮追问（缺输入列、输出值形状、是否写回本行等）。  
3. AI 输出：**可行性结论** + **组件规格摘要**（人话）+ 可选风险（要写哪些列、是否触发自动化）。  
4. 用户点「生成并预览」→ 得到沙箱包；「发布到字段」后对所有行生效。  
5. 可继续对话迭代 → 再生成新版本（保留版本号，可回滚上一版）。

### 4.3 单元格运行态

- 只读浏览：可显示组件的只读态或压缩预览（避免万行万 iframe）。  
- 点击/聚焦：挂载沙箱，注入 bridge。  
- 组件内交互写值 → bridge → 主站提交记录变更。

## 5. Technical design

### 5.1 存储

字段 `options.aiComponent`（命名可微调）建议包含：

| 字段 | 说明 |
| --- | --- |
| `sessionId` / messages | 配置会话（可外置表，大 JSON 勿堵字段元数据） |
| `version` | 已发布版本 |
| `bundle` | `{ html, css, js, entry }` 或单文件；内容可存对象存储，字段只存 URL + hash |
| `bridgeManifest` | 声明用到的能力：`cell` / `rowFields[]` / `automations[]` / `network`（默认 false）；写行与自动化按「尽可能强」声明，发布时按用户 ACL 裁剪不可用项并提示 |
| `valueSchema` | 单元格 JSON 约定（完整状态） |
| `gridContract` | **必填（发布时）**：AI 预定的 `sortKey` 路径/类型、`filter`（算子 + 比较值类型）、`exportDisplay`（如何从 cell 得到导出/打印字符串）；主站筛选排序导出只认此合同 |
| `status` | `draft` / `published` / `failed` |

**Builder 默认：** bundle 大则走 S3/MinIO；字段 options 存 `bundleUrl` + `contentHash` + manifest。

单元格 `cells[fieldId]`：按 `valueSchema` 存组件状态；无值时组件用默认值。

### 5.2 生成流水线（服务端）

1. `POST .../ai-component/chat`：多轮，带 sheet 字段目录摘要（名、类型、id）。  
2. 模型输出结构化：`{ feasible, reason, questions?, spec?, bridgeManifest?, gridContract? }`。  
3. `POST .../ai-component/generate`：在用户确认后生成 `{ html, css, js }` **与**完整 `gridContract`（缺筛选/排序/导出约定则不得发布）；服务端做静态检查（禁止明显逃逸：`parent.`、`top.`、裸 `fetch` 若未授权等——尽力而为，非形式化证明）。  
4. 存储 bundle，更新字段 draft；预览接口返回临时 token（**仅配置者**可见草稿组件）。  
5. `POST .../ai-component/publish`：需字段编辑权（editor+）；校验 `gridContract` 齐全；manifest 按当前用户 ACL 裁剪并提示；写 published（后发布覆盖前一版）。协作方只看到已发布版。

LLM：OpenAI-compatible，复用 `apps/api/src/ai/openai-compatible.ts`。

### 5.3 沙箱与 Bridge

- **容器：** `iframe` + `sandbox="allow-scripts"`（默认无 `allow-same-origin`；若需 storage 再评估）。  
- **通信：** `postMessage`，主站校验 `source` + 字段级 token。  
- **Bridge API（注入给组件的约定，版本化）：**

```text
smartTable.ready()
smartTable.getCell(): Promise<unknown>
smartTable.setCell(value): Promise<void>
smartTable.getRow(fieldIds?: string[]): Promise<Record<string, unknown>>
smartTable.setRow(patch: Record<string, unknown>): Promise<void>
smartTable.runAutomation(automationId, payload?): Promise<{ ok: boolean; ... }>
smartTable.notify(message): void
```

- 主站实现：`setCell` / `setRow` → 现有 records API / MessageCenter；**写行尽量放开**——凡当前用户对该列有写权限的数据列均可写入（公式只读列、无写权列拒绝并回传错误）；`runAutomation` → 凡用户有权触发的自动化均可（manifest 可列 id 或 `*` 表示会话中选定的集合），带频控与幂等键，防一行连点打爆队列。  
- 未在 `bridgeManifest` 声明的能力直接拒绝。  
- **外网：** 默认 CSP/`fetch` 代理拒绝；manifest.`network` 未开则拦截。

### 5.4 网格集成

- `CanvasGrid` / `GridPanel`：`aiComponent` 列为只读手写编辑；点击打开沙箱宿主（浮层，避免虚拟行抖动）。  
- 协同：他端 `new_changes` 更新 cell 后，向已挂载 iframe `postMessage({ type: 'cellChanged', value })`。  
- **筛选 / 排序：** 主站用已发布 `gridContract.sortKey` / `filter` 从 cell JSON 取值比较；无合同的字段不得发布。  
- **导出 / 打印：** 用 `gridContract.exportDisplay`（模板或 JSONPath + 格式）渲染单元格展示串；由 AI 在生成阶段定死，不在导出时再猜。

### 5.5 与现有 `type: 'ai'` 关系

| | `ai`（现有） | `aiComponent`（本设计） |
|--|-------------|------------------------|
| 产出 | 文本填入单元格 | HTML/JS 交互组件 |
| 运行 | 服务端 applyAiFields | 客户端沙箱 + bridge |
| LLM | 可选 AI_FIELD_URL | 对话 + 生成代码 |

二者并存；文档与字段菜单文案区分「AI 填值」与「智能组件」。

## 6. Security summary（限制怎么做）

产品要「能力尽量不封顶」，限制落在：

1. **隔离：** 不进主文档 DOM，不直触主站 Vue 状态。  
2. **桥接鉴权：** 一切数据面经 bridge + 用户 ACL + manifest。  
3. **默许能力集：** cell/row/automation；外网默认关。  
4. **发布门闩：** 生成 ≠ 上线，需预览确认。  
5. **可回滚：** 坏组件可卸版本或禁用字段。

**不**用「控件种类白名单」限制五星评分等交互。

## 7. Testing

- 单元：bridge 鉴权、manifest 拒绝、valueSchema 解析。  
- 组件/集成：生成假 bundle（本地评分 HTML）挂载 → setCell → 记录更新。  
- e2e：创建智能组件字段 → 注入固定 bundle（跳过 LLM）→ 点星 → 刷新仍在。  
- 负例：无 editor 权限 setRow 失败；未声明 automation 调用失败。

## 8. 已确认决策

| # | 项 | 结论 |
|---|----|------|
| P1 | 谁可发布可执行 bundle | **有字段编辑权（editor+）**；viewer 仅使用已发布组件 |
| P2 | 筛选 / 排序 / 导出 | **必须由 AI 在生成时写入 `gridContract`**；主站按合同执行，不做「复杂对象先不可筛」的缩水 |
| P3 | 草稿可见性 | **仅配置者预览**；全员只见已发布；后发布覆盖前一版 |
| P4 | setRow / 自动化 | **尽可能强**：ACL 允许写的列都可写；有权触发的自动化都可跑（+ 频控/幂等） |
| P5 | 回滚与旧值 | **不自动清空单元格**；组件读到不兼容值时占位并提示重填 |
| B1 | 字段类型名 | `aiComponent` /「智能组件」（Builder） |
| B2 | Bundle 存放 | 对象存储 + hash（Builder） |
| B3 | 虚拟行挂载 | 点击/聚焦再挂 iframe；宿主用浮层（Builder） |
| B4 | LLM env | 优先 `ANALYSIS_LLM_*`（Builder） |
| B5 | 外网 | 本期默认禁止（Builder） |

## 9. Success criteria

- 用户用对话做出可点的五星评分字段，值写入单元格并协同可见。  
- 该列可按 AI 预定合同参与**筛选、排序**；导出列显示为 AI 预定文案。  
- 用户要求写本行其它可写列 / 触发有权自动化时，在有权情况下成功；无权时有明确错误。  
- 无 LLM Key 时配置面明确提示，不假发布。  
- 万行表滚动不因该列显著卡死（聚焦挂载策略生效）。
