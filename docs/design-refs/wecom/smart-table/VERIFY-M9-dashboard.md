# VERIFY-M9：仪表盘与聚合

加深 [VERIFY-05-dashboard-analytics.md](./VERIFY-05-dashboard-analytics.md)。

## 1. 企微证据

`o-smartsheet-request-map`：`WB.WORD_CLOUD|CHART|TABLE|NUMBER|TEXT` 默认 4×3；HAR `/api/ai/smartsheet-bi/...`。截图目录 `12-dashboard/`（壳）。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| CHART | bar/line/pie/horizontalBar/combo | **对齐** |
| NUMBER/TABLE/WORD_CLOUD/TEXT | metric/table/wordcloud/text 白名单 | **类型齐；NUMBER 已加深（对比/趋势/条件色）** |
| AI BI | 仪表盘 Agent 完整共编 | **已落地**（非 `smartsheet-bi` 孪生；`DASHBOARD.md` §5） |
| 栅格拖拽 | 12 列 bento | **对齐** |
| 聚合 | PG GROUP BY；可选 CH + ETL | **中小表对齐；大表走 CH profile** |

## 3. 偏差

大表性能仍依赖是否启用 ClickHouse；企微 `smartsheet-bi` 路径不做字节兼容。

## 4. 性能

PG JSONB 聚合 LIMIT≤100：中小表持平可用；不可伪称持平企微云 BI。

## 5. 结论

主图表路径合格。→ M10。
