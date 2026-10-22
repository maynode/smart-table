# VERIFY-M9：仪表盘与聚合

加深 [VERIFY-05-dashboard-analytics.md](./VERIFY-05-dashboard-analytics.md)。

## 1. 企微证据

`o-smartsheet-request-map`：`WB.WORD_CLOUD|CHART|TABLE|NUMBER|TEXT` 默认 4×3；HAR `/api/ai/smartsheet-bi/...`。截图目录 `12-dashboard/`（壳）。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| CHART | bar/line/pie/horizontalBar/combo | **对齐** |
| NUMBER/TABLE/WORD_CLOUD/TEXT | metric/table/wordcloud/text 白名单 | **类型齐；渲染深度弱** |
| AI BI | 不做 | **刻意** |
| 栅格拖拽 | 12 列 bento | **对齐** |
| 聚合 | PG GROUP BY；CH adapter 无 ETL | **中小表对齐；大表债** |

## 3. 偏差

CH ETL 缺失（REMAINING-GAPS P0）；AI BI 不做。

## 4. 性能

PG JSONB 聚合 LIMIT≤100：中小表持平可用；不可伪称持平企微云 BI。

## 5. 结论

主图表路径合格。→ M10。
