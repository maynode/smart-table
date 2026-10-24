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

## 6. 待定（故意不做 / 暂缓 — 成熟后再议，未排期）

> 2026-10-24：当前主线是打磨现有功能；断网/离线/实时协作/同步不排期。

| 项 | 状态 | 说明 |
|----|------|------|
| 断网重连 / 离线编辑 / 跨端同步 | **待定** | 与协同同类后置；见 `REMAINING-GAPS` |
| AI BI Agent | **待定** | 仪表盘智能分析不做 |
| `USER_C` | **待定** | 材料语义不清；主类用 `person` |
| 大表 chunk 本地库 | **待定** | 性价比低 |
| 多人实时协同 OT/WS | **待定** | 产品暂缓；材料备忘见 `REMAINING-GAPS`「企微实时协作」 |
| 企微登录 / 通讯录 / 真企微群 | **待定** | 非本系统账号生态强绑定 |

完整清单与「下一步 P0/P1」分界：[`docs/REMAINING-GAPS.md`](../../../REMAINING-GAPS.md) §2「待定」。
