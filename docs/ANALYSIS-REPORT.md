# AI 分析报告（对话 + Markdown）

与 [仪表盘](./DASHBOARD.md) 分离：侧栏「分析报告」打开对话式引导，确认要分析的工作表后，根据表数据摘要生成 Markdown 报告画布。不走 ECharts / `dashboards` 表。

## 1. 对象与状态

表：`analysis_reports`（Prisma `AnalysisReport`）。

| 字段 | 说明 |
| --- | --- |
| `messages` | 对话回合（user/assistant；可选 choice 选项） |
| `steps` | 进度步骤：ask → explore → generate → done |
| `sheetIds` | 参与分析的工作表 id 列表 |
| `reportMarkdown` | 生成完成后的报告正文 |
| `status` | `draft` / `asking` / `exploring` / `generating` / `ready` / `failed` |

权限：按 Base 成员角色（列表/查看需 viewer；创建与作答需 editor），与内容权限 `dashboard` 对象无关。

## 2. API

均需 JWT。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/bases/:baseId/analysis-reports` | 列表（不含正文） |
| `POST` | `/bases/:baseId/analysis-reports` | 新建；自动发首轮选表/确认话术 |
| `GET` | `/analysis-reports/:id` | 详情（含 messages / steps / markdown） |
| `POST` | `/analysis-reports/:id/answer` | 作答：`{ optionId?, text?, skip? }`；选表后触发摘要与生成 |
| `POST` | `/analysis-reports/:id/generate` | 在已有 `sheetIds` 上重新生成 |

单表文档创建后可直接确认；多表时助手给出表选项、`综合/全景`、`请输入其他…`。

## 3. 生成链路

1. 按 `sheetIds` 抽样记录（上限约 200 行/表），统计字段非空率与 top 值，得到 digest。
2. 调用 `generateAnalysisMarkdown`：
   - 若配置了 `ANALYSIS_LLM_BASE_URL` + `ANALYSIS_LLM_API_KEY`：请求 OpenAI 兼容 `/chat/completions`，模型默认 `gpt-4o-mini`（可用 `ANALYSIS_LLM_MODEL` 覆盖）。
   - 未配置或远程失败：本地 digest 拼装 Markdown（不编造数字）。
3. 写入 `reportMarkdown`，`status = ready`；失败则 `failed` + `error`。

## 4. 前端

- `AnalysisReportPanel`：左历史（多份时）、中报告画布（简易 Markdown）、右对话与步骤。
- Base 侧栏「分析报告」→ 打开本面板；「仪表盘」仍打开 `DashboardPanel`。

## 5. 环境变量

见仓库根目录 `.env.example` 中 `ANALYSIS_LLM_*`。未配置时本地 digest 报告即可用，无需外网。
