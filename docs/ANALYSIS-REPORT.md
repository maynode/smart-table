# AI 分析报告（对话 + Markdown）

与 [仪表盘](./DASHBOARD.md) 分离：侧栏「分析报告」打开对话式引导，确认要分析的工作表后，根据表数据摘要生成 Markdown 报告画布。不走 ECharts / `dashboards` 表。

## 1. 对象与状态

表：`analysis_reports`（Prisma `AnalysisReport`）。

| 字段 | 说明 |
| --- | --- |
| `messages` | 对话回合（user/assistant；可选 choice 选项；user 可带 `attachments` 附图） |
| `steps` | 进度步骤：ask → explore → generate → done |
| `sheetIds` | 参与分析的工作表 id 列表 |
| `reportMarkdown` | 生成完成后的报告正文 |
| `status` | `draft` / `asking` / `exploring` / `generating` / `ready` / `failed` |

权限：

- Base 成员角色：列表/查看需 viewer；创建、作答、重命名、删除需 editor。
- **内容权限**：抽样 digest 时对每张表 `PermissionsService.assertCan(sheet, read)`，并对抽样行 `applyReadScope`（行可见性 + 字段脱敏）；不可见表跳过。选表列表也只展示可读表。

## 2. API

均需 JWT。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/bases/:baseId/analysis-reports` | 列表（不含正文） |
| `POST` | `/bases/:baseId/analysis-reports` | 新建；自动发首轮选表/确认话术 |
| `GET` | `/analysis-reports/:id` | 详情（含 messages / steps / markdown）；生成中轮询此接口 |
| `PATCH` | `/analysis-reports/:id` | 重命名：`{ name }` |
| `DELETE` | `/analysis-reports/:id` | 删除 |
| `POST` | `/analysis-reports/:id/chat` | 自由对话：`{ text?, attachments? }`（文本与附件至少一个）；附件为已上传的 `{ url, name, mimetype, size }` |
| `POST` | `/analysis-reports/:id/attachments` | multipart 上传任意文件（单个小于 100MB，数量不限）；计入工作区存储配额 |
| `POST` | `/analysis-reports/:id/answer` | 作答：`{ optionId?, text?, skip? }`；选表后入队生成并立即返回 `exploring`（旧引导路径） |
| `POST` | `/analysis-reports/:id/generate` | 在已有 `sheetIds` 上重新生成（异步，返回 `exploring`） |

主路径为右侧自由对话（可粘贴/上传多个任意文件）；需要完整报告时用户直接说「生成分析报告」。`answer` / 选表引导仍保留兼容。

## 3. 生成链路（异步）

1. `answer` / `generate` 将状态置为 `exploring` 后立刻返回；后台 `setImmediate` 执行生成（无需 BullMQ）。
2. 后台：`exploring` → `generating` → 按 `sheetIds` 抽样（上限约 200 行/表，已做内容权限过滤）→ digest → `generateAnalysisMarkdown` → `ready`；异常则 `failed` + `error`。
3. LLM：若配置了 `ANALYSIS_LLM_BASE_URL` + `ANALYSIS_LLM_API_KEY`，请求 OpenAI 兼容 `/chat/completions`（模型默认 `gpt-4o-mini`，可用 `ANALYSIS_LLM_MODEL` 覆盖）；未配置或远程失败则本地 digest 拼装 Markdown（不编造数字）。
4. 客户端对 `exploring` / `generating` 轮询 `GET /analysis-reports/:id` 直至 `ready` 或 `failed`。

## 4. 前端

- `AnalysisReportPanel`：嵌入 Base 主区；左报告画布（简易 Markdown）、右自由对话；支持选文件/粘贴上传（不限个数、单个小于 100MB；图片缩略图、其它文件名卡片）；生成中轮询；失败展示 `error`；支持删除。
- Base 侧栏「分析报告」→ 打开本面板；「仪表盘」仍打开 `DashboardPanel`。

## 5. 环境变量

见仓库根目录 `.env.example` 中 `ANALYSIS_LLM_*`。未配置时本地 digest 报告即可用，无需外网。
