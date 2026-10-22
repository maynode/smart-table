# VERIFY-M3：视图筛选 / 排序 / 分组 / 填色

加深 [VERIFY-02-grid-query-lock.md](./VERIFY-02-grid-query-lock.md)。

## 1. 企微证据

sdk_0：`IS…IS_NOT_EMPTY`、`AND=1 OR=2`；`CONDITION/GROUP`；`fetch_view_filter_spec`。Mutation 3018–3023 隐藏/统计/分组/筛选/排序/行高；3024 列宽。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| 过滤算子全集（主集） | `shared/view-query` + `filter-eval` + `buildFilterSql` | **对齐** |
| 服务端视图生效 | `POST /sheets/:id/query` LIMIT 1000 | **对齐** |
| 命名视图 | `SavedView.query` JSON | **对齐** |
| 分组/填色/行高/冻结 | `ViewQuery` 字段 + GridPanel UI | **对齐** |
| option/natural 排序 | `buildSortSql`：option→choices 下标；natural→digit pad；UI 三档 | **对齐** |

## 3. 偏差

- `listRecords` 无 filter：带筛选必须走 `/query`（Grid 已如此）→ 无产品偏差。  
- 超 1000 行分页+筛选组合：材料未证明企微同构 → **未知**，记性能债。

## 4. 性能

JSONB `cells->>` 服务端过滤；中小表够用。大表需索引/旁路列或 CH（非本模块）。

## 5. 结论

主路径对齐。→ M4。
