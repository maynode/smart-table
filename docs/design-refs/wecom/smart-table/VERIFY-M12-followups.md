# VERIFY-M12：缺口补齐（record_timer / CH ETL / breakLine / TITLE / 双向关联 / 公式脏行）

> 日期：2026-10-22  
> 对照此前 INDEX 中「能做」清单。

## 1. record_timer（到达记录时间）

| 项 | 实现 |
|----|------|
| 触发类型 | `recordTimer`：`sheetId` + `fieldId`(date) + 可选 filters |
| 调度 | `RecordTimerService` 随 15s 轮询；SQL 选到期行 |
| 幂等 | `recordTimer:{autoId}:{recordId}:{stamp}` |
| UI | 自动化编辑器「到达记录时间」+ 日期字段选择 |

## 2. ClickHouse ETL

| 项 | 实现 |
|----|------|
| 开关 | `ANALYTICS_ADAPTER=clickhouse` 且 `CLICKHOUSE_ETL_ENABLED!=false` |
| 同步 | `ClickHouseEtlService` 30s 增量（`updatedAt` 水位）JSONEachRow |
| 表 | `ReplacingMergeTree(version)` `(sheet_id, id)` |

## 3. Canvas breakLine + TITLE

| 项 | 实现 |
|----|------|
| breakLine | `engine.breakLine` 多行装箱；行高够时多行绘制 |
| TITLE | `FieldType=title`「标题」；菜单/图标已挂 |

## 4. 双向关联

| 项 | 实现 |
|----|------|
| options | `bidirectional` + `reverseFieldId` + `multiple` |
| 写回 | `syncBidirectionalRelations`（不递归） |
| UI | 关联字段选项：双向开关 + 反向字段 |

## 5. 公式脏行

| 项 | 实现 |
|----|------|
| API | `evaluateFormulaRecord`；`updateRecord` 响应叠加本行公式值（不落库） |

## 6. 仍不做

AI BI Agent、USER_C、chunk 本地库（性价比）。
