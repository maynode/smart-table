# 企微分模块源码校验总表

> 更新：2026-10-22  
> 方法：HAR-TECH / 截图 → wecom-js → HAR 实帧 → 我方代码 → VERIFY-M*  
> 边界：协同 WS / OT **整模块暂缓**；不编造未见证据。

| 模块 | 文档 | 证据完整度 | 偏差数 | 性能结论 | 代码已修 |
|------|------|------------|--------|----------|----------|
| M1 字段类型 | [VERIFY-M1-field-types.md](./VERIFY-M1-field-types.md) | 高（sdk_0 全表 + HAR 17=单选） | 2 弱差 + AI 增强 | 值模型自洽即可 | naturalTime `now` 类型 |
| M2 Canvas 网格 | [VERIFY-M2-grid-canvas.md](./VERIFY-M2-grid-canvas.md) | 高（§14 BreakLine） | 多行折行弱 | 行虚拟化+省略+测宽缓存 | ellipsis + measureCache |
| M3 视图筛选 | [VERIFY-M3-views.md](./VERIFY-M3-views.md) / [VERIFY-02](./VERIFY-02-grid-query-lock.md) | 高 | 0 主路径 | 服务端 `/query` 对齐 | — |
| M4 乐观锁 | [VERIFY-M4-record-lock.md](./VERIFY-M4-record-lock.md) | 中（协议不同、语义齐） | 0 | REST version 足够 | — |
| M5 公开表单 | [VERIFY-M5-forms.md](./VERIFY-M5-forms.md) / [VERIFY-03](./VERIFY-03-public-form.md) | 中高（i18n+截图） | 0 主路径 | 限流+锁 OK | 禁公式/查找作条件 |
| M6 自动化动作 | [VERIFY-M6-automation-actions.md](./VERIFY-M6-automation-actions.md) / [VERIFY-01](./VERIFY-01-automation-claim.md) | 高（X2+HAR） | 0 主路径（HTTP 已有） | SKIP LOCKED 更强 | sendHttp 骨架 |
| M7 schedule/timer | [VERIFY-M7-schedule-timer.md](./VERIFY-M7-schedule-timer.md) / [VERIFY-04](./VERIFY-04-automation-schedule.md) | 中 | 1（record_timer 缺口） | cron 原子抢占 OK | — |
| M8 内容权限 | [VERIFY-M8-permissions.md](./VERIFY-M8-permissions.md) | 中（截图为主） | 0 主路径 | ACL 内存过滤；大表可再优化 | — |
| M9 仪表盘 | [VERIFY-M9-dashboard.md](./VERIFY-M9-dashboard.md) / [VERIFY-05](./VERIFY-05-dashboard-analytics.md) | 中 | AI BI 不做；CH ETL 缺 | 中小表 PG 够用 | — |
| M10 分享/配额 | [VERIFY-M10-share-quotas.md](./VERIFY-M10-share-quotas.md) | 中 | 0 壳层 | — | — |
| M11 模板/首页 | [VERIFY-M11-templates-home.md](./VERIFY-M11-templates-home.md) | 低（截图壳） | 0 壳层 | — | — |
| 协同 WS | （暂缓） | HAR-TECH §8.3 | — | 不实现 | 跳过 |
| M12 缺口补齐 | [VERIFY-M12-followups.md](./VERIFY-M12-followups.md) | 实现对照 | 0 主项 | timer/ETL/breakLine/TITLE/双向/公式脏行 | 已落地 |

首轮抽样 VERIFY-01…05 仍有效；M* 为加深/补齐。
