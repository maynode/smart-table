# 公开只读视图

公开只读链接用于把 Base 内选定内容以 **GET-only** 方式展示给外部人员；与「可编辑公网外链」严格区分，任何写操作都返回 403。

## 能力

- 链接由随机 token 生成，形如 `/view/:token`。
- 可选访问密码（argon2id 哈希存储，至少 4 位）。
- 可选有效期；过期返回 410，撤销/关闭返回 404。
- **公开内容范围**（仅可勾选「有数据」项，默认全选有数据项）：
  - 工作表（有记录）
  - 表单收集结果（关联 Form 的 sheet，有记录）
  - 仪表盘（有组件）
  - 分析报告（`ready` 且已有 Markdown）
- 表格类最多每表 500 行；隐藏字段不下发。
- 与表单公开提交（`/fill/:token`）是两套 token/权限链路，互不复用。

## 接口

| 接口 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /sheets/:sheetId/public-views/scope-options` | 登录 + editor | 四类可选项及 `hasData` |
| `POST /sheets/:sheetId/public-views` | 登录 + editor | `{name?, password?, expiresAt?, sheetIds?, formSheetIds?, dashboardIds?, analysisReportIds?}`；省略全部范围字段时仅公开宿主表 |
| `GET /sheets/:sheetId/public-views` | 登录 + editor | 列出该 Sheet 为宿主创建的链接 |
| `DELETE /public-views/:id` | 登录 + editor | 立即失效 |
| `GET /public-views/:token?password=` | 公开 | 无密码直接返回；有密码缺参 401、错误 403 |
| `POST /public-views/:token/verify` | 公开 | `{password}` 校验并返回数据 |
| `POST/PATCH/DELETE /public-views/:token/records...` | 公开 | 固定 403 |

## 数据形态

```json
{
  "readonly": true,
  "name": "对外数据",
  "sheet": { "id": "...", "name": "公开数据" },
  "sheets": [{ "id": "...", "name": "...", "kind": "sheet", "fields": [], "records": [] }],
  "formSheets": [{ "id": "...", "name": "...", "kind": "form", "fields": [], "records": [] }],
  "dashboards": [{ "id": "...", "name": "...", "kind": "dashboard", "widgets": [] }],
  "analysisReports": [{ "id": "...", "name": "...", "reportMarkdown": "..." }],
  "fields": [],
  "records": []
}
```

`sheet` / `fields` / `records` 与首张表格类内容对齐，兼容旧前端。

前端 `/view/:token`：按类型 Tab 切换；仪表盘复用只读图表；分析报告渲染 Markdown；密码视图先校验再展示。
