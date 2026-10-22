# 校验⑤：仪表盘聚合查询性能 — 企微源码对照

> 日期：2026-10-22  
> 证据：`o-smartsheet-request-map` 看板部件尺寸 `WB.WORD_CLOUD|CHART|TABLE|NUMBER|TEXT`；HAR 大量 `/api/ai/smartsheet-bi/...`；`HAR-TECH-ANALYSIS` BI Agent 备注  
> 我方：`dashboards.service.ts`、`pg-analytics.adapter.ts`、`clickhouse-analytics.adapter.ts`、`DashboardPanel.vue`

## 1. 企微侧

| 部件 | 默认栅格（request-map） |
|------|-------------------------|
| WORD_CLOUD / CHART / TABLE / NUMBER | 4×3（min 2×2）；TEXT minH=1 |
| AI BI | `smartsheet-bi` session / insights / publish（本 HAR 有路径） |

聚合与大数据路径偏 **服务端 BI / 预计算**；本仓库 HAR 未展开具体 SQL。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| CHART | bar / line / pie / horizontalBar / combo | **对齐主类** |
| NUMBER | API `metric` | **类型对齐**（UI 深度弱于企微） |
| TABLE / WORD_CLOUD / TEXT | API `table` / `wordcloud` / `text` | **白名单有**；渲染完整度弱于企微 |
| AI BI Agent | 不做（产品边界） | **刻意不做** |
| 拖拽布局 | 12 列 bento，w/h 持久化 | **对齐交互** |
| 聚合查询 | PG：`GROUP BY cells->>dim` + count/sum/avg/min/max；可选 CH 同构 SQL | **语义对齐** |
| 定时推送 | dashboard schedule + 立即执行 | **有**（本地通知通道） |

## 3. 性能

| 项 | 企微观察 | 我方 | 结论 |
|----|----------|------|------|
| 小中表 | 云端 BI | PG JSONB 聚合 LIMIT≤100 | **足够** |
| 大表 | BI / 预聚合 | CH adapter 已写，**缺 PG→CH ETL** | **已知 P0 交付项**（见 REMAINING-GAPS） |
| SQL 注入 | — | 字段 id 参数化 / CH `escape` | OK |

## 4. 结论

图表主路径与栅格编辑相对企微 CHART 语义对齐；WORD_CLOUD/TABLE/NUMBER 卡与 AI BI 不在当前范围。聚合性能在 PG 上对中小表达标，大规模依赖尚未落地的 CH ETL。本轮源码校验五连完成。
