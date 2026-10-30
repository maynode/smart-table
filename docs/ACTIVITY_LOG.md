# 前台操作日志（日志管理）

面向系统管理员的「用户究竟干了啥」追溯，**不记录** `/admin/*` 后台管理操作。

## 架构

| 层 | 职责 |
| --- | --- |
| `ActivityLogService` | 写库 / 管理端查询（失败只打 warn，不阻断业务） |
| `ActivityInterceptor` | 全局拦截前台 HTTP；成功响应后按路由生成中文摘要 |
| `POST /activity/track` | 前端埋点（页面打开等；有简易限流） |
| 协同 `user_changes` | 同一用户同一表 8s 内合并为一条 `sheet.collab.commit` |
| `ActivityCleanupService` | 定时/手动清理过期日志 |

表：`activity_logs`（与工作区合规审计 `audit_logs` 分开）。

## 记录策略

- 写操作（POST/PUT/PATCH/DELETE）默认记
- GET 默认不记；白名单：表格导出
- 「打开页面」靠前端 `page.view`
- 查询类写接口跳过（widget query、通知已读等）
- `/admin/*` 永不记

## 定时清理（保留窗口）

按 **Asia/Shanghai** 自然月：

| 配置 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | true | 是否启用 |
| `dayOfMonth` | 1 | 每月几号跑 |
| `hour`/`minute`/`second` | 02:00:00 | 当天开始时间（上海时区） |
| `retentionMonths` | 2 | 保留月数（**含当月**） |

**`retentionMonths=2`：** 保留「本月 + 上月」；每月 1 日 02:00 删除 **上上个月及更早**  
（例：10 月 1 日 → cutoff = 9 月 1 日 00:00 上海 → 删 8 月及更早）。

同一自然月只执行一次；管理员可在「日志管理」页改配置或「立即清理」。  
页面会展示：**下一次清理时间**、**将清理「某时刻及之前」的日志**。  
环境变量：`ACTIVITY_LOG_CLEANUP_TIME=02:00:00` 等；调度可用 `ACTIVITY_LOG_CLEANUP_SCHEDULER=false` 关闭。

## API

```http
GET  /admin/activity-logs?q=&op=&source=&from=&to=&limit=&cursor=
```

`from` / `to`：ISO 时间或 `YYYY-MM-DD`（按日起止）。

```http
GET  /admin/activity-logs/cleanup-settings
PATCH /admin/activity-logs/cleanup-settings
POST /admin/activity-logs/cleanup-run
POST /activity/track
```

列表游标：`{createdAtISO}|{id}`。仅安装管理员。UI：`/admin/activity`。
