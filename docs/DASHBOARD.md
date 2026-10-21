# 仪表盘与分析报告

对齐企微智能表格的仪表盘/分析报告对象：一个 Base 内可创建多个仪表盘，每个仪表盘是一块自由画布，可添加多张图表；分析报告复用同一套对象与图表引擎。

## 1. 图表类型

| 类型 | 引擎值 | 说明 |
| --- | --- | --- |
| 柱状图 | `bar` | 按维度分组聚合，默认主题色 `#2d8cf0` |
| 折线图 | `line` | 适合时间/序列趋势 |
| 饼图 | `pie` | 维度占比，环形样式 |
| 指标卡 | `metric` | 单值 KPI |
| 表格 | `table` | 维度/数值明细 |

基础配置：标题、工作表、分组字段（维度）、数值字段、聚合方式（计数/求和/平均/最小/最大）。
图表配置存 `dashboard_widgets.config`，画布布局存 `layout`（HTML 画布上的 `{w,h,x,y}`，当前前端按双列网格渲染）。

## 2. 数据与聚合

`POST /dashboards/:id/widgets/:widgetId/query` 与 `GET /dashboards/:id/data` 返回：

```json
{ "labels": ["华东", "华南"], "values": [15, 3], "driver": "postgres" }
```

聚合通过 `AnalyticsQueryPort` 完成：

- `postgres`（默认）：读取 `records.cells` JSONB，按维度 `GROUP BY`，数值用正则清洗后 `numeric` 聚合，带 `sheet_id` 索引。
- `clickhouse`：同一 SQL 形态改写为 ClickHouse 的 `JSONExtractString` + `toFloat64OrZero`，通过 HTTP `FORMAT JSON` 查询。

切换方式：

```bash
ANALYTICS_ADAPTER=clickhouse
CLICKHOUSE_URL=http://clickhouse:8123
CLICKHOUSE_DATABASE=smart_table
docker compose --profile analytics up -d clickhouse api
```

ClickHouse 适配器有独立单测（`apps/api/src/analytics/clickhouse-analytics.adapter.spec.ts`），通过注入 fetcher 验证 SQL、鉴权头与返回映射；compose 的 `analytics` profile 不参与默认启动，未启用时 Postgres 适配器照常工作。

## 3. 定时推送

`dashboard_schedules` 保存 Cron、渠道、上次/下次运行时间；`dashboard_schedule_runs` 保存每次运行状态与图表快照。

- 创建：`POST /dashboards/:id/schedules`，Cron 必须为 5 段。
- 手动执行：`POST /dashboards/:id/schedules/:scheduleId/run`，生成本次运行记录，并向创建者写入站内通知（含仪表盘 id、运行 id、图表数量），随后更新 `lastRunAt/nextRunAt`。
- 服务层 `runDueSchedules()` 供后续定时器/队列调用，按 `nextRunAt <= now` 最多取 10 条执行。
- 渠道保留 `notification`/`group-chat`/`wecom`；企微应用消息在 Task 25 的 NotifyAdapter 中接入。

## 4. 权限

仪表盘/分析报告作为内容权限对象（`object_type = dashboard`），与工作表/表单共用 `content_permissions` 档位与成员额外权限；图表查询读取工作表时还会再次校验该工作表的读权限，避免借图表绕过行/列权限。
