# 校验②：表格查询 / 筛选排序 / 乐观锁 — 企微源码对照

> 日期：2026-10-22  
> 证据：`materials/wecom-js/initial_smartsheet_sdk_0.*.js` 过滤枚举；`HAR-TECH-ANALYSIS.md` §8.5 / §协同；`fetch_view_filter_spec`  
> 我方：`views.service.ts#query`、`automation-filter.sql.ts`、`packages/shared` filter-eval、`sheets.service.ts#updateRecord`、`BaseShellView` 传 `expectedVersion`

## 1. 企微侧

### 1.1 过滤算子（sdk_0）

```
IS=1 IS_NOT=2 CONTAINS=3 DOES_NOT_CONTAIN=4
IS_GREATER=5 IS_GREATER_OR_EQUAL=6 IS_LESS=7 IS_LESS_OR_EQUAL=8
IS_EMPTY=9 IS_NOT_EMPTY=10 …
conjunction: AND=1 OR=2
```

视图筛选：`POST …/reader/fetch_view_filter_spec`（打开时拉规格；本样本 `view_items: []`）。  
表数据主路径：opendoc / chunk / 本地 DB 渲染；HTTP `query_sheet_data` 为 SDK 保留路径。

### 1.2 写入版本

在线编辑主路径 = WS `USER_CHANGES` → `ACCEPT_COMMIT`（`base_rev`→`new_rev`）。  
HTTP `commitchanges` = 离线/回退。产品边界：**不做协同 OT/WS**，用 REST + 行级 `version` 乐观锁表达冲突语义。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| IS / IS_NOT | `equals` / `notEquals` | **对齐** |
| CONTAINS / DOES_NOT_CONTAIN | `contains` / `notContains`（SQL `ILIKE`） | **对齐** |
| IS_GREATER…IS_LESS_OR_EQUAL | `gt/gte/lt/lte` | **对齐** |
| IS_EMPTY / IS_NOT_EMPTY | `isEmpty` / `isNotEmpty` | **对齐** |
| AND / OR | `conjunction: and\|or`（嵌套 FilterGroup） | **对齐** |
| 视图筛选服务端生效 | `POST /sheets/:id/query` → `buildFilterSql` + `buildSortSql` LIMIT 1000 | **对齐**（命名视图持久化 query） |
| 排序 | `sorts[]` direction；mode value/option/natural | **对齐**：`option`=choices 下标（选项正序）；`natural`=数字段补零自然语言序；`value`=文本/数值 |
| rev / ACCEPT_COMMIT | `records.version` + `expectedVersion`；冲突 409「记录已被他人修改」 | **语义对齐**（非孪生协议） |
| 客户端始终带 base_rev | `BaseShellView` 更新单元格传 `payload.record.version` | **对齐** |

## 3. 性能

| 项 | 企微 | 我方 | 备注 |
|----|------|------|------|
| 大表筛选 | 本地 chunk DB + 服务端视图 spec | SQL JSONB `cells->>` + LIMIT 1000 | 中小表 OK；超大表缺索引/分页 cursor 与企微 chunk 不同 |
| 公式列 | 脏区批量拉取 | `evaluateFormulaRows` 查询后计算 | 功能可用；非脏区增量 |
| 写冲突 | Socket rev | `updateMany` where version | 单写者场景足够 |

## 4. 客观差

- 协同 `NEW_CHANGES` / OT：**产品暂缓**，不对照实现。
- 筛选 SQL 对 JSON 文本比较；单选存 choice id 时需与 UI 值一致（与企微 cell_value base64 同理）。
- `listRecords` 游标分页无 filter；**带筛选一律走 `/query`**（Grid 已如此）。

## 5. 结论

筛选算子集合与服务端 query、行级乐观锁相对企微**语义对齐**；大表 chunk/脏区公式为已知性能差距，不阻塞主路径。→ 校验③。
