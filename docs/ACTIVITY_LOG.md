# 前台操作日志（日志管理）

面向系统管理员的「用户究竟干了啥」追溯，**不记录** `/admin/*` 后台管理操作。

## 架构

| 层 | 职责 |
| --- | --- |
| `ActivityLogService` | 写库 / 管理端查询（失败只打 warn，不阻断业务） |
| `ActivityInterceptor` | 全局拦截前台 HTTP；成功响应后按路由生成中文摘要 |
| `POST /activity/track` | 前端埋点（页面打开、面板等；有简易限流） |
| 协同 `user_changes` | 同一用户同一表 8s 内合并为一条 `sheet.collab.commit` |

表：`activity_logs`（与工作区合规审计 `audit_logs` 分开）。

**记录策略**

- 写操作（POST/PUT/PATCH/DELETE）默认记
- GET 默认不记（避免 live/列表轮询刷屏）；白名单：表格导出
- 「打开页面」靠前端 `page.view`
- 名义写、实为查询的接口跳过：视图 query、仪表盘 widget query、通知已读、密保问询、公开视图校验、表单成功页预览
- `/admin/*` 永不记
- `workspaceId` / `baseId` / `sheetId` 仅在合法 UUID 时落库，避免整行写失败

## 摘要示例

- `alice 新建了数据表「销售明细」`
- `bob 提交了表格变更`
- `carol 在协同编辑中提交了 12 处变更`
- `dave 打开了页面「智能表」`

机器字段：`action` / `op(create|update|delete|read|other)` / `source(api|client|collab)`。

## API

```http
POST /activity/track
Authorization: Bearer …
{ "event": "page.view", "path": "/", "title": "首页" }

GET /admin/activity-logs?q=&op=create&source=api&limit=50&cursor=
```

列表游标格式：`{createdAtISO}|{id}`。仅安装管理员可查。UI：`/admin/activity`。
