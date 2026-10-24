# 企微智能表格：HAR 技术分析

> 来源：`materials/ww_table.har`（Chrome WebInspector）  
> 方法：REA `inspect_web_network_capture` + initiator 栈 + 上报/配置载荷解析  
> 日期：2026-10-22  
> **保密**：原文 HAR 含会话与身份信息，勿提交 git / 勿外传。分析结论已脱敏。

## 1. 捕获范围与过滤

| 项 | 值 |
| --- | --- |
| 原始条目 | 76 |
| 过滤后 | 67（去掉 9× `1px.gif`；无字体请求） |
| 页面 | `/smartsheet/{docId}?tab=…&viewId=…` |
| 时序 | `onContentLoad≈3.8s`，`onLoad≈9.0s`；HAR 主体为**加载后交互** |
| 灰度 | `DB_CHUNK_NEW_RENDER`（分块新渲染） |
| FE 版本 | `smartsheet 3.1.0`；客户端串 `daily-20261020_smartsheet-*`，`dver 3.0.0` |

**局限**：本 HAR **几乎不含** JS bundle 下载，脚本仅出现在 `_initiator`。冷启动快照 / 主同步协议（WS 等）未覆盖。

脱敏分析副本：`materials/ww_table.rea-filtered.har`（可选；同样勿入库）。

## 2. API 面（REA api-surface）

| 方法 | Origin | Path | 角色 |
| --- | --- | --- | --- |
| POST | cube.weixinbridge.com | `/cube/report/reportbizdata` | 业务埋点主通道 |
| POST | docrp.weixin.qq.com | `/report/node/` | 文档节点上报（常经 blob worker） |
| POST | doc.weixin.qq.com | `/info/report` | 压缩上报（`q`） |
| POST | doc.weixin.qq.com | `/watermark/get` | 水印策略 |
| POST | doc.weixin.qq.com | `/wedoc/editnotify` | 编辑态通知 |
| POST | doc.weixin.qq.com | `/docopen/update_time` | 打开时间心跳 |
| GET | res.wx.qq.com | `…/ai-field-template.json` | AI 字段技能模板（~552KB，Base64 包 JSON） |
| GET | res.wx.qq.com | `…/formula-template.json` | 公式模板库（~235KB） |
| POST | report.idqqimg.com | `/api/{n}/envelope/` | 错误上报（本次 503） |

文档类接口鉴权：query `sid` + `xsrf`；响应 `X-Session-Ret` / `logicret`。本 HAR 无 Cookie 头。

## 3. 前端模块分层（initiator）

```
page-smartsheet-main.*
  ├─ initial_smartsheet_sdk_{0,1}.*     # 表核心（getCore / 选区 / 公式）
  ├─ initial_vendors_{public,tencent}_*
  ├─ lib/combined-lib.*                 # React 痕迹
  ├─ main_editable_phase_scheduler.*    # 编辑阶段调度
  ├─ o-smartsheet-request-map.* / o-smartsheet-report.*
  └─ async chunks（字段编辑器等）
```

`x-fe-bad-version` 暴露同生态版本矩阵：smartsheet / doc / sheet / slide / mind / flowchart / form / wiki / pdf …

## 4. 表格核心机制

### 4.1 路由与 ID

- URL：`tab` = 表 ID，`viewId` = 视图 ID，`scode` = 打开码。
- Changeset 内 `c.1` ↔ tab，`c.2` ↔ viewId，`c.3` ↔ 字段 ID。

### 4.2 Changeset / 协同提交（观察）

埋点 `formula-loglink` → `addUserChange` / `acceptCommit`（`opername: message-center`）：

```json
{
  "changeset": [[{ "t": 3014, "v": 5, "c": { "1": "<tabId>", "3": { "…字段定义…" } }, "r": 12, "o": 0 }]],
  "baseRev": "…",
  "subId": "…"
}
```

| 字段 | 观察含义 |
| --- | --- |
| `t` | 操作类型枚举 |
| `v` | schema 版本（本会话恒 5） |
| `c` | 操作载荷 |
| `r` | revision |
| `o` | 序号 |

本会话见过的 `t`：

| t | 推断行为 |
| --- | --- |
| 3014 | 新增/更新字段定义（含类型码、各视图布局 map） |
| 3017 | 改字段属性（如单选选项列表） |
| 3024 | 视图布局（如列宽） |
| 3013 | 单元格写入（含成员类字段快照结构） |

编辑闭环：

`addUserChange` → `acceptCommit` → `FormulaDirtyMarkChangeManager` / `FormulaResultChangeManager` → `请求结束应用追算结果`；另有 `onVersionChange更新拉取时间函数列`。

### 4.3 字段类型线索

会话中类型码 **17** 对应「单选」。公式模板 `varFieldConstraints` 另见 2 / 4 / 14 / 26 / 28 等（完整枚举待 JS 深挖）。

### 4.4 公式

- CDN 模板 DSL 示例：`[当前表].FILTER([Each].[列] >= [列]).[列].UNIQUE().COUNTA()`。
- 风格近多维表链式公式，非 Excel A1。
- UI：`formulaUISchema` + `specificFormatter`。

### 4.5 AI 字段

`ai-field-template.json`：多业务类目 × skill（分类、提取、图像、合同等），配置驱动技能市场。

### 4.6 渲染 / 选区 / 离线

| module | 作用 |
| --- | --- |
| `xtable-get-core` / `getCore` | 核心表对象 |
| `selection_stat` / `selection_compute` | 选区计算耗时 |
| `smart_sheet_render_draw_update_cost` | 绘制更新 |
| `smart_sheet_field_sync_count_cost` | 字段同步成本 |
| `data_analyze` / `mutation` | 变更后分析触发 |
| `offline_edit` / `release_lock` | 离线编辑锁 |
| `field_manager` / `field_type_editor` | 字段类型编辑器 |

## 5. 文档域 API 摘要

- **水印** `POST /watermark/get` body `{"padId"}`；栈含 `forceRenderWatermark`。
- **编辑通知** `POST /wedoc/editnotify` `docId&func=2` → CGI `xmwedoclogicsvr/editnotify`。
- **心跳** `POST /docopen/update_time` multipart `docid`+`scode` → `xmdocopenservice/update_time`。
- 服务端：`Wwebsvr`。

## 6. 证据索引（REA）

| 项 | ID |
| --- | --- |
| 父捕获 Evidence | `ev_447755a2fe4aa97fdb4bcae0aceb4d61ca3997949b625485b6a6b3c42b11f1bf` |
| 过滤 HAR sha256 | `cd788a6f62124a35570074211756a4c47689814dfbe5601a9f5f363bc89f95f8` |

## 7. 后续深挖清单

- [x] 下载 CDN JS，从 `initial_smartsheet_sdk_0` 抽出 **Mutation / FieldType** 枚举
- [x] 核对 HAR changeset `t` 与枚举名（3013/3014/3017/3024）
- [x] 打开生命周期：`FIRSTSCREEN → READONLY → EDITABLE`（`main_editable_phase_scheduler`）
- [x] `editnotify` 客户端节流与 `messageCenter` 提交路径
- [x] 公式脏区管理器与相关 HTTP API（见 §8.7）
- [x] 冷启动 `GET /dop-api/opendoc` 单请求拆解（见 §10）
- [x] 全量 HAR `wx-table-all.har`：时序 / reader API / 配额 / WS 握手（见 §11）
- [x] 协同协议：Engine.IO + MessageCenter；**在线提交走 WS `USER_CHANGES`**（见 §12–13）
- [x] 实机单账号：`ACCEPT_COMMIT` + `DIRTY_AREA_CHANGE` / `PROXY_FIELD_CHANGE`（见 §13）
- [x] Canvas 文字测宽/折行/省略号算法（`sdk_1`，见 §14）
- [ ] （可选）从 `BreakLine` 追到真正 `fillText`/`fillRect` paint 调用点
- [ ] （可选）双人编辑补抓 `NEW_CHANGES.changeset`
- [ ] （可选）断网/离线触发 HTTP `commitchanges` 回退实包
- [ ] 对照本仓库 `docs/DATA_MODEL.md` 做能力映射

## 8. 深挖进展（CDN JS + REA）

本地产物目录：`materials/wecom-js/`（第三方 bundle，**勿提交**）。  
REA：`analyze_javascript_application` 父证据 `ev_87ecce8b…a2d4`（scheduler / report 切片）。

### 8.1 FieldType 枚举（`sdk_0`，与 HAR 类型码 17=单选一致）

| 值 | 名 | 值 | 名 |
| --- | --- | --- | --- |
| 1 | TEXT | 17 | **SINGLE_SELECT** |
| 2 | NUMBER | 18 | LINK_RECORDS |
| 3 | CHECKBOX | 19 | FORMULA |
| 4 | DATE_TIME | 20 | LOOKUP |
| 5 | IMAGE | 21 | TWO_WAY_LINK_RECORDS |
| 6 | ATTACHMENT | 22 | LOCATION |
| 7 | USER | 23 | USER_C |
| 8 | URL | 24 | TITLE |
| 9 | MULTIPLE_SELECT | 25 | AUTO_NUMBER |
| 10 | CREATED_USER | 26 | CURRENCY |
| 11 | MODIFIED_USER | 27 | GROUP_B |
| 12 | CREATED_TIME | 28 | PERCENT |
| 13 | MODIFIED_TIME | 29 | BARCODE |
| 14 | PROGRESS | | |
| 15 | PHONE | | |
| 16 | EMAIL | | |

### 8.2 Mutation 操作码（changeset `t`，节选）

客户端存在两套编号：**Request**（本地命令，约 6–80）与 **Mutation**（协同序列化，3001+）。HAR 里看到的是 Mutation。

| t | 枚举名 | HAR 对照 |
| --- | --- | --- |
| 3005 | INIT_TABLE_MUTATION | |
| 3006–3009 | 视图增删移/属性 | |
| 3010–3012 | 行插入/删除/移动 | |
| **3013** | **SET_RECORD_MUTATION** | 单元格写入 |
| **3014** | **INSERT_FIELD_MUTATION** | 新增字段 |
| 3015–3016 | 字段删除/移动 | |
| **3017** | **SET_FIELD_ATTRIBUTES_MUTATION** | 改字段属性（选项等） |
| 3018–3023 | 隐藏、统计、分组、筛选、排序、行高 | |
| **3024** | **SET_COL_WIDTH_MUTATION** | 列宽 |
| 3028 / 3030 / 3034–3035 | 批量追加/设置/插入/删除行 | |
| 3041 / 3044 | VISIBILITY / EDITABLITY | |
| 3201+ | Dashboard 相关 | |

`INSERT_FIELD_MUTATION.serialize` 将字段写成短键：`K1=tableId`，`K3={K1:fieldId,K2:type,K3:title,K4:indexes}`——与 HAR 中 `c.1/c.3` 数字键结构一致（`v=5` 为 schema 版本）。

对应 Request 侧示例：`INSERT_FIELD_REQUEST=12`，`SET_RECORD_REQUEST=9`，`SET_FIELD_ATTRIBUTES_REQUEST=15`。

### 8.3 协同与 MessageCenter

`sdk_1` 观察：

- `addUserChange` → `pendingChanges` → `persistChanges` → `flush`（可走离线存储）
- `acceptCommit` / `onAcceptCommitEmitter`；离线提交回调 `onOfflineDataCommitCallback`
- 服务消息：`SERVER_MESSAGE_TYPE.NEW_CHANGES` → 埋点 `message-center` / `newChanges`（处理远端 changeset）
- 错误码痕迹：`SOCKET_COMMIT_VERSION_BREAK`、`COMMIT_BASE_VER_TOO_LOW`、`COLLAB_CENTER_OVERSIZE_COMMIT` → **存在 Socket 提交通道**（本 HAR 未抓到帧）

### 8.4 打开与可编辑阶段（`main_editable_phase_scheduler`）

生命周期性能点：

`HTML_*` → `SCRIPT_TO_ENTRY` → **`opendoc`（首屏表数据）** → canvas 首屏 →  
`FIRSTSCREEN_PHASE` → `READONLY_PHASE` → **`EDITABLE_PHASE`** → workbench / pageReady。

灰度名（与 HAR `gray` 一致）：

- `DB_CHUNK_NEW_RENDER`（`isUseDBChunk && isNewRender`）
- `DB_NEW_RENDER` / `NEW_RENDER` / `UNKNOWN`

编辑通知任务 `WecomSmartsheetEditnotifyTask`：

- 监听 `ON_ACCEPT_COMMIT` / `SMART_SHEET_COMMIT_REQUEST`
- `POST /wedoc/editnotify`（`docId` + `func=2`）
- `localStorage.edit_notify_self` **约 1 小时**节流

Job 并行：`InitEditContainerFeatureTask`（`edit`）+ `InitIdleContainerFeatureTask`（`idle`）+ `PageReadyTask` + 上报初始化。

### 8.5 过滤 / 条件算子（同 sdk 枚举片段）

- 组合：`AND=1`，`OR=2`
- 比较：`IS` / `IS_NOT` / `CONTAINS` / `DOES_NOT_CONTAIN` / 大小比较 / `IS_EMPTY` / `IS_NOT_EMPTY`

### 8.6 MessageCenter 运行态（`page-smartsheet-main` 埋点字典）

可观察动作名：

| module | action | 含义（推断） |
| --- | --- | --- |
| messageCenter | `addUserChange` / `sendUserChange` / `sendOfflineUserChange` | 本地变更入队并上送 |
| messageCenter | `acceptCommit` / `acceptOfflineCommit` | 服务端确认提交 |
| messageCenter | `handleNewChanges` / `applyNewChangesError` | 应用远端增量 |
| messageCenter | `commitingQueueBlock` | 提交队列阻塞 |
| mutation | `commitMutation` / `getCollabMutations` | 变更提交 / 拉协同 mutation |
| mutationQueue | `completeTimeout` / `maxSize` | 队列超时与容量 |

计数器：`applyBehaviorAmount`、`commitMutationAmount`、`sendUserChangeAmount`、`acceptCommitAmount`。

错误码示例：`SMART_SHEET_SOCKET_COMMIT_VERSION_BREAK=40021`，`SMART_SHEET_ERROR_GET_CHANGES_ERROR=111`。

### 8.7 公式脏区与计算链路

`FormulaDirtyMarkChangeManager`（`sdk_0`）：

- 维护 `currentVersion` / `lastVersion` / `dirtyChangeList`
- `getDirtyAreaByVersion(from, to)`：按版本区间拉脏区
- 版本不连续时 `createMissChangeTask` 补洞（循环上限约 200，空脏区报错）
- `fetchByBatchForFieldWide` / `fetchByBatchForCells`：按「整列脏」或「单元格脏」批量取公式结果
- 时间函数列：`isTimeFuncFields`（对应 HAR 埋点「onVersionChange更新拉取时间函数列」）

相关 HTTP（静态字符串，**未在本 HAR 出现**——需另抓编辑/打开全量）：

| Path | 角色 |
| --- | --- |
| `/api/smartsheet/reader/fetch_dirty_formula` | 拉公式脏区 |
| `/api/smartsheet/reader/query_sheet_data` | 查表数据 |
| `/api/smartsheet/reader/get_init_table_mutation` | 初始表 mutation |
| `/api/smartsheet/reader/fetch_visibility` | 可见性 |
| `/smartsheetservice/addgetcalcfieldvaluetask` + `querygetcalcfieldvaluetask` | 计算字段异步任务 |
| `/smartsheetservice/get_ai_field_dirty_info` | AI 字段脏信息 |
| `/api/smartsheet/ai/field/fill` / `cancel` | AI 填列 |
| `/v2/mall/sheet/mutation` | mutation 通道（命名提示商城/通用 sheet） |
| `/sheet/local_edit` | 本地编辑相关 |
| `/dop-api/get/sheet` | 取 sheet |

另有大量 `/api/ai/smartsheet-bi/...`（BI Agent / 洞察）。

### 8.8 仍缺证据

- WebSocket 具体 URL 与帧 schema（仅有 Socket 错误码与 `NEW_CHANGES` 处理）
- 公式 AST 解析器 / Worker 入口（`formula_worker` 仅出现在性能埋点白名单）
- Mutation OT：`transformWithInsertFieldMutation` 等完整变换表
- 冷启动 `opendoc` 请求/响应体

## 9. 材料与保密

| 路径 | 说明 |
| --- | --- |
| `materials/ww_table.har` | 交互期埋点 HAR |
| `materials/ww_table_cold.har` | **仅 1 条** `opendoc`（含账号/表内容，敏感） |
| `materials/wx-table-all.har` | **全量冷启动**（241 条；含 HTML/JS/WS，敏感） |
| `materials/ww_table.rea-filtered.har` | 去图 + 字面量脱敏副本 |
| `materials/wecom-js/` | CDN 下载的前端 bundle |

以上均应 gitignore，勿外传。

## 10. 冷启动：`/dop-api/opendoc`（`ww_table_cold.har`）

**结论：只存这一条请求就够分析首屏数据协议；全量 HAR 非必须。**

### 10.1 请求

- `GET https://doc.weixin.qq.com/dop-api/opendoc?...`
- 关键 query（脱敏）：

| 参数 | 本样本 | 含义（推断） |
| --- | --- | --- |
| `scode` | 打开码 | 文档访问票据 |
| `id` | padId | 文档 ID |
| `tab` / `viewId` | `tgY5a7` / `vBT6mz` | 当前表 / 视图 |
| `startrow` / `endrow` | `0` / `60` | **行窗口**（首屏分页） |
| `chunkCellSize` | `15000` | 分块单元格规模提示 |
| `enableChunkRank` | `1` | 开启分块排序/秩 |
| `enableSmartsheetSplit` | `1` | 智能表拆分加载 |
| `supportOptimizedVer` | `4` | 与响应 `optimizedVer:4` 对齐 |
| `wb` / `nowb` | `1` / `0` | 是否要 workbook 导航结构 |
| `outformat` | `1` | JSON 输出 |
| `xsrf` | … | CSRF |
| `req_from` | `1` | 来源标记 |

响应头：`cgi_code:0`，`X-Session-Ret:0`，`x-fe-bad-version` 含 `smartsheet,3.1.0,…`。

### 10.2 响应骨架

顶层：`padType=smartsheet`，`dver=3.0.0`，`bodyData`，**`clientVars`**（主载荷）。

`clientVars` 要点：

| 字段 | 样本 | 说明 |
| --- | --- | --- |
| `collab_client_vars` | 对象 | 协同/表数据容器 |
| `privilegeAttribute` | can_edit/can_share… | 能力位 |
| `grayConfig` | 见下 | 计算/公式灰度 |
| `formulaResults` | `null` | 首包未带公式结果（后续脏区拉取） |
| `websocket` | `true`（bodyData + collab） | 声明支持 WS（本文件无帧） |
| `wecom_allow_op` | 长整型列表 | 企微侧允许操作码 |

`grayConfig`：`use_record_rank`、`gray_new_calc`、`formula_calc_v35_gray`、`use_optimi_time_func` 等。

### 10.3 `collab_client_vars`

| 字段 | 样本 |
| --- | --- |
| `padSubId` | 当前表 `tgY5a7` |
| `rev` / `latestRevisionVersion` / `calcRev` | **78** |
| `maxRow` / `maxCol` | 12 / 5 |
| `header` / `workbook` | 子表导航：smartsheet / dashboard / folder / external |
| `pollingAttemptNumber` | 3（无 WS 时可轮询） |
| `calcByFrontend` | `false`（服务端计算） |
| `isChunked` | 本包未标分块完成态 |
| `smartsheetConfig.pageCtx` | `{ver, calc_ver, total_row, sheet_id, view_id, hit_cache}` |
| `client` | `{sid, tid, sig, upid}` 会话三角（敏感） |
| `apid` | `{i,g,r,s,t}` 与 revision 绑定 |

### 10.4 表体：`initialAttributedText.text[].smartsheet`

- 一行窗口描述：`max_row=12`，`start_row_index=0`，`end_row_index=60`
- `smartsheet`：**Base64 + zlib**，**逗号拼接多段**
- 解压后为 **Mutation 批次数组**，与编辑期 changeset 同协议（`t` + `v:5` + `c`，键名多为 `k1/k2/…`）

本样本两段：

| 段 | t | 枚举 | 内容 |
| --- | --- | --- | --- |
| 0 | **3005** | `INIT_TABLE_MUTATION` | 表结构：字段 ID → 类型/标题/选项（如 17 单选、15 手机、10 填写者、12 提交时间） |
| 1 | **3028** | `APPEND_RECORDS_MUTATION` | 行数据：约 **12** 条 recordId → 各列 cell（类型码 `k30` + 值） |

→ **首屏 = 一次 opendoc 下发「建表 mutation + 追加行 mutation」**，不是另套 REST CRUD JSON。

### 10.5 与前序结论的闭合

- 编辑 HAR 里的 `3013/3014/3017/3024` 与打开时的 `3005/3028` 同属 Mutation 流。
- `formulaResults: null` + JS 侧 `fetch_dirty_formula` → 公式结果多半在打开后异步补。
- `websocket:true` 在全量 HAR 中已见到真实连接；协同协议见 **§12**。

## 11. 全量冷启动（`wx-table-all.har`）

- 条目：**241**（去图后约 229）；`onContentLoad≈3.9s`，`onLoad≈9.2s`
- 资源类型：script 99 / xhr 81 / stylesheet 24 / **websocket 1** / document 1
- HTML 壳：`GET /smartsheet/{padId}` ≈ **1.8MB**（内嵌大量 bootstrap 字符串）；随后立刻 `opendoc`

### 11.1 打开时序（摘要）

```
HTML 壳
  → opendoc（表数据 mutation）
  → initial_smartsheet_sdk_* + vendors + page-smartsheet-main
  → gray_config / tip / user_info / doc_info
  → fetch_view_filter_spec（×2）
  → eager-edit + after-render-async-read/edit chunks
  → main_readonly_phase_scheduler
  → watermark + get_link_info（配额）
  → WebSocket Engine.IO 握手（CLIENT_READY / HEART_BEAT）
  → check_import_append_exist
  → main_editable_phase_scheduler + xtable-edit-pc
  →（切到其他子表时）get_init_table_mutation
  → automation/list、execution/count/remain
```

阶段资产命名已坐实：**readonly → editable**，以及 `xtable-readonly-pc` → `xtable-edit-pc`、`contrib-*-async-read/edit`。

### 11.2 本会话实际打到的业务 API

| API | 作用 |
| --- | --- |
| `GET /dop-api/opendoc` | 当前 tab 首屏 mutation（同 §10） |
| `POST …/reader/fetch_view_filter_spec` | 视图筛选规格；本样本 `view_items: []` |
| `POST …/reader/check_import_append_exist` | 导入/追加任务是否存在 |
| `POST …/reader/get_init_table_mutation` | **按需拉其他子表**结构（见下） |
| `POST /smartsheetservice/get_link_info` | 配额与主键类型限制 |
| `POST /smartsheetservice/get_link_app_info` | 关联应用信息 |
| `POST /smartsheetservice/get_status` | 文档状态 |
| `POST …/automation/list` | 自动化列表 |
| `POST …/automation/execution/count/remain` | 自动化剩余执行次数 |
| `POST /watermark/get` | 水印 |
| `POST /wedoc/gray_config` | 高级能力灰度 |
| `POST /diskauth/get_file_auth` | 文件权限 / allow_operations |
| `GET/POST doc_info / user_info` | 文档元信息、账号 |

**未出现**（本打开路径不需要）：`fetch_dirty_formula`、`query_sheet_data`。

### 11.3 `get_link_info` 配额（产品上限线索）

```json
{
  "max_record_num": 100000,
  "max_field_num": 150,
  "max_cell_num": 15000000,
  "allow_primary_type": [1, 2, 4, 15, 16]
}
```

主键允许类型：TEXT / NUMBER / DATE_TIME / PHONE / EMAIL（与 §8.1 枚举一致）。

### 11.4 `get_init_table_mutation`（懒加载其他 sheet）

- 请求：`{ padID, subIDs:["q979lj"], supportAsync, revision_version, needProxyField }`
- 响应：`result.mutations[subId]` = **明文 JSON** Mutation 数组（本样本未再 zlib）
- 内容：`t:3005 INIT_TABLE_MUTATION`（字段：文本/手机/日期/单选等 + 视图列宽 + 成员缓存）
- 含义：opendoc 只带**当前 tab**；切到「码库」等子表时再拉 init mutation。

### 11.5 WebSocket（Engine.IO 3，轻量观察）

- URL：`wss://doc.weixin.qq.com/websocket/?…&EIO=3&transport=websocket`
- 查询带 `tag/gtag/utag/padid/sig/uid`（与 opendoc `client.sig` 同源体系）
- 开场：`0{sid, upgrades:[polling], pingInterval:60000…}` → `40`
- 业务帧（`42["post"|"get", "<json>\n…"]`）本样本见：
  - **CLIENT_READY**（带 `apid` / `base_rev`）
  - **USER_NEWINFOS**（在线成员）
  - **LAST_REVERSION**
  - **HEART_BEAT**
- 未出现完整 `NEW_CHANGES` changeset 推送（无第二人编辑）；协同时再抓即可。

### 11.6 对实现的启示

1. **首屏数据面**：HTML 壳 + `opendoc` mutation；子表按需 `get_init_table_mutation`。  
2. **渲染阶段**：先只读调度器/只读 xtable，再可编辑调度器/编辑 xtable（与性能埋点相位一致）。  
3. **配额与主键规则**可直接对齐产品规格。  
4. **实时通道**见 §12。

## 12. 协同技术（能拿到的部分）

> **能**：通道分层、握手帧、**在线态 WS 提交实帧**、`ACCEPT_COMMIT`、脏区/公式通知、HTTP 回退契约（SDK）、队列状态机、错误码。  
> **不能（本材料）**：双人推送的完整 `NEW_CHANGES` 帧体。补抓步骤见 §12.6。  
> 实帧脱敏样本：`materials/live-ws-user-changes.redacted.json`（2026-10-22 单人实机）。

### 12.1 两通道分工（**实机修正**）

| 通道 | 用途 |
| --- | --- |
| **WebSocket** `wss://doc.weixin.qq.com/websocket/`（**Engine.IO 3**） | 进房、在线成员、心跳、光标、**在线时本地 `USER_CHANGES` 上送**、**`ACCEPT_COMMIT` 回执**、`COMM_NOTICE`（脏区/公式）、远端 `NEW_CHANGES`（期望） |
| **HTTP** `POST /dop-api/commitchanges` | SDK 仍保留；偏**离线/回退/覆盖写**路径（本实机编辑**未走**此 URL） |
| **HTTP** `POST /wedoc/editnotify` | 编辑态通知（非 changeset 提交） |

**结论（实机）**：WS 已连通时，单元格提交 = `42["post", header\\nbody]` 发 `USER_CHANGES` → 服务端 `42["get", …]` 回 `ACCEPT_COMMIT`（`base_rev`→`new_rev`）。HTTP `commitchanges` 不是在线主路径。

### 12.2 WebSocket 握手（`wx-table-all.har` 实测）

查询参数：`tag/gtag/utag/padid` + `sig` + `uid` + `EIO=3&transport=websocket`（`sig` 与 opendoc `client.sig` / `apid.g` 同系）。

开场：

1. `0{"sid","upgrades":["polling"],"pingInterval":60000,"pingTimeout":180000}`  
2. `40`（Engine.IO connect）  
3. `42["post", "<json行>\\n<json行>"]` / `42["get", …]`（业务事件）

### 12.3 已见业务消息类型

| type | 方向 | 作用 |
| --- | --- | --- |
| **CLIENT_READY** | C→S，回显 onpost | 声明进房：`apid{i,g,r,s,t}`、`base_rev`、`docs_type:smartsheet`、`generalpacket{rel_rev,dver,right_tag}`；同帧附带 `roomType:padpage` / `roomName:padpage/{padId}` |
| **USER_NEWINFOS** | S→C（get） | 在线成员：`mem_count`、`notices[{userId,uuId,colorId,session_type}]` |
| **LAST_REVERSION** | S→C（get） | 最新修订：`notice.lastRev`、`needWebVer` |
| **HEART_BEAT** | 双向 | 客户端约 15s；服务端 `onpost.heartbeat_interval:15000` |
| **CURSOR_MESSAGE** | C→S（post） | 光标/选区协同（本实机编辑时伴随出现） |
| **USER_CHANGES** | C→S（post） | **本地 changeset 上送**（见 §12.4） |
| **ACCEPT_COMMIT** | S→C（get） | 接受提交：`base_rev`→`new_rev`，回显 `data.changeset` + `commitId`/`author`/`applyTime` |
| **COMM_NOTICE** | S→C（get） | 见下：`DIRTY_AREA_CHANGE` / `PROXY_FIELD_CHANGE` / `discussion_update` 等 |

`CLIENT_READY` / `USER_CHANGES` 的 `onpost` 成功：`result=0` + `heartbeat_interval`。

### 12.4 本地提交（**在线主路径 = WS**，实机）

帧格式：`42["post", "<headerJSON>\\n<bodyJSON>"]`

**header**（节选）：`type=USER_CHANGES`，`base_rev`，`dver`，`docs_type=smartsheet`，`apid`，`generalpacket{rel_rev,dver,right_tag}`，`task_id`（与 body 对齐）。

**body**（节选）：

```json
{
  "type": "USER_CHANGES",
  "baseRev": 81,
  "changeSetCount": 1,
  "changeset": "[[{\"t\":3013,\"v\":5,\"c\":{…},\"r\":9,\"o\":0}]]",
  "subId": "tgY5a7",
  "changesetType": "smartsheet",
  "notCrossSheet": true,
  "taskId": "…",
  "pver": 0
}
```

注意：`changeset` 在线上是 **JSON 字符串**（再包一层），解析后为 Mutation 二维数组。

本实机连续两次提交：

| 序 | `t` | 含义 | rev |
| --- | --- | --- | --- |
| 1 | **3017** | `SET_FIELD_ATTR`（改单选字段选项） | 81→82 |
| 2 | **3013** | `SET_RECORD`（写单选单元格） | 82→83 |

**ACCEPT_COMMIT**（`42["get", …]`）：`new_rev = base_rev+1`，`data.changeset` 回显（服务端可补字段，如时间戳键 `32`）。

提交后立刻跟两条 **COMM_NOTICE**：

| notice.type | 含义 |
| --- | --- |
| `DIRTY_AREA_CHANGE` | 脏区变更，`rev` 对齐新修订 |
| `PROXY_FIELD_CHANGE` | 代理/公式字段；`payload` 含 `calcRev`、`noticeMode`、**`formulaResZip`**（zlib+b64） |

→ 公式结果不一定再走单独 HTTP；至少有一条 **WS 推送压缩结果** 路径。

#### HTTP 回退（SDK 静态，本实机未触发）

- URL：`/dop-api/commitchanges?padId=…&xsrf=…`  
- Body：`data=<JSON>`（`USER_CHANGES` + `respective[].changeset`）  
- `retcode===40035` 最多重试 30 次  

客户端队列（`sdk_1`）：

```
prepareUserChange → pendingChanges → persistChanges（可离线）
  → flush / commitOverWriteChanges
  → 成功: acceptCommit；失败: shutDown("D0008") 等
```

### 12.5 远端收包

- **本端接受**：`ACCEPT_COMMIT`（已实抓）。  
- **对端推送**：SDK 处理 `NEW_CHANGES` → `body.data.changeset`（**双人场景仍缺实帧**）。  
- **COMM_NOTICE** / `USER_LEAVE` / `RIGHT_MESSAGE` / `LAST_REVERSION`：见上表与 SDK `handleOtherMessage`。

相关错误码（节选）：

| 码 | 名 | 含义 |
| --- | --- | --- |
| 40021 | SOCKET_COMMIT_VERSION_BREAK | Socket 提交版本断裂 |
| 40034 | SOCKET_COMMIT_DVER_INCONFORMITY | dver 不一致 |
| 111 | GET_CHANGES_ERROR | 拉变更失败 |
| 608639 | COMMIT_BASE_VER_TOO_LOW | base_rev 过低 |
| 608629 | ERR_COMMIT_DUPLICATED | 重复提交 |
| 608669 / 52003 | OVERSIZE_COMMIT | 包过大 |
| 18001 | COMMIT_TIME_OUT | 超时 |

OT：字段 mutation 类上仍有 `transformWithInsertFieldMutation` 等（§8），与 `base_rev` + changeset 组成经典「提交 / 变换 / 接受」模型。

UI 协作：`o-smartsheet-collab-contact-service` 管协作者面板/联系人（**不**承载传输协议）。

### 12.6 若要补齐 `NEW_CHANGES` 帧（可选；非当前排期）

> 产品阶段（2026-10-24）：先打磨现有功能；协同/离线后置。下列仅作材料补全备忘。  
> **不必第二企微账号**：同一账号双浏览器会话（或桌面端+浏览器）同 `padId` 即可。公开网页/爬虫拿不到协议帧。

1. Network → **WS**，保留日志  
2. 两会话打开同一表；A 改单元格  
3. 在 B 的 WS Messages 里搜 `NEW_CHANGES` / `changeset`  
4. 另存 HAR（脱敏）→ 即可补文档「远端推送体」一节  

### 12.7 一张总图（实机修正）

```
本地编辑 → Mutation(t=301x) → MessageCenter 队列
    ↓ WS 42["post"]（在线主路径）
 USER_CHANGES (header + body.changeset 字符串)
    ↓
 服务端 ACCEPT_COMMIT (base_rev → new_rev)  + 回显 changeset
    ↓ 同通道
 COMM_NOTICE: DIRTY_AREA_CHANGE / PROXY_FIELD_CHANGE(formulaResZip)
    ↓（双人，待补）
 对端 NEW_CHANGES(changeset) → applyNewChanges

 HTTP /dop-api/commitchanges  = 离线/回退（SDK 保留，本实机未走）
 HTTP /wedoc/editnotify       = 编辑通知（非数据提交）
```

## 13. 实机补抓记录（单账号，2026-10-22）

- 入口：Playwright 打开表 → 企微扫码登录 → 表格视图可编辑  
- 渲染：主网格为 **canvas** + 浮层 `auto-resize-textarea` 编辑器  
- 抓到：WS `USER_CHANGES` / `ACCEPT_COMMIT` / `COMM_NOTICE` / `CURSOR_MESSAGE`  
- 未抓到：HTTP `commitchanges`、双人 `NEW_CHANGES`  
- 产物：`materials/live-ws-user-changes.redacted.json`

## 14. Canvas 文字排版（REA 锁定 `sdk_1`）

> 范围：只抠「单元格文字测宽 / 折行 / 省略」，不还原整文件。  
> 材料：`materials/wecom-js/initial_smartsheet_sdk_1.93932e86d826bf2ccd9b.js`  
> REA：`analyze_javascript_application`（`source_paths`=该文件）父证据 `ev_477fa69c…c6acbe`。

### 14.1 Chunk 分工（勿混）

| 文件 | 角色 |
| --- | --- |
| **`initial_smartsheet_sdk_1`** | **底层文字布局**：`measureText`×14、`getContext`×33、`BreakLine` / `WordMeasurer` |
| `5347.*.js` | 单元格**编辑器壳**（`canvasEmitter`、`hideCanvasStage`、各字段 React 编辑器），不是测宽核心 |
| `initial_smartsheet_sdk_0` | Mutation / FieldType；公式侧是 **`parseFormulaRes`（反序列化服务端结果）**，非本地求值 |

实机观察：主网格 1× canvas；编辑时浮层 textarea，与上述「测宽在 SDK、编辑器在 5347」一致。

### 14.2 核心符号特征

| 混淆符号 | 推断名 | 作用 |
| --- | --- | --- |
| 类 `q` | `WordMeasurer` | 离屏 canvas 测字宽；font→uid；`word → width` Map 缓存 |
| `measureWordBrowser` | 同左 | `ctx.measureText(word).width` |
| `measureWordServer` | 同左 | 非浏览器环境走原生 `measureWidth` |
| `z.breakLine` / `getBreakLineResult` | `BreakLine` | 在 `maxWidth` / `maxLineCount` / `wrapType` 下折行；带 layoutCache |
| `appendEllipsis` | 同左 | 超宽截断 + `…`；对 grapheme **二分**找切点 |

单行能否放下（统计条等同理）：

\[
w(\text{label}+\text{value}) + P_{L}+P_{R}+2B < W_{cell}
\]

否则 `overflow = ellipsis`。

### 14.3 伪代码（算法骨架）

```text
// 测宽
WordMeasurer.measure(word):
  cache hit → return
  width = browser ? canvas2d.measureText(word).width
                  : nativeMeasure(word, font)
  cache[word] = width

fontKey = "{style} {variant} {size}px {family}"

// 折行（贪心装箱）
breakLine(text, {maxWidth W, maxLineCount L, wrapType, ellipsis}):
  cacheKey = hash(measureUid, L, W, wrapType, ellipsis?, text)
  if layoutCache[key]: return
  for token in lineBreakIterator(text):
    if newline → flush line
    else if curW + measure(token) ≤ W → append
    else if CHAR_WRAP → 按 grapheme 拆开再塞 / 换行
    else → 整词换行或强制 grapheme 拆
  行数受 L 约束；可选 trim 首尾空白；末行/超限行 appendEllipsis

// 省略：二分 grapheme 前缀，使 w(prefix)+w("…") ≤ W
appendEllipsis(line):
  budget = W - ellipsis.width
  从后丢掉词腾空间 → 对卡在边界的词做 lo/hi 二分
  keep = graphemes[0..mid]; append "…"
```

### 14.4 数学原理（在算什么）

1. **测宽：** 给定 font 下字符串标量宽度 \(w(s)\)（Canvas `measureText` ≈ glyph advance 之和）。  
2. **折行：** 容量为 \(W\) 的 1D 贪心装箱；硬换行优先；`wrapType` 决定按词还是按 grapheme 再拆；行数 \(\le L\)。  
3. **省略：** 单调性「前缀越长宽度不减」→ 在 grapheme 下标上二分最大合法前缀。  
4. **缓存：** font uid、词宽、整段 layout key，避免重复 \(O(n)\) 测量。

→ 这是 **1D 文本布局**，不是几何变换矩阵；真正的 `fillText`/`fillRect` paint 会消费这里产出的 `{text, width}` 行列表（调用点仍可选深挖）。

### 14.5 公式边界（对照）

- 打开包 `calcByFrontend: false`；实机有 WS `PROXY_FIELD_CHANGE` + `formulaResZip`（zlib+b64）。  
- `sdk_0`：`parseFormulaRes` → `JSON.parse(standardCell)` → `calcInfo` → `applyMutationDataToCache`。  
- **前端不求值** `SUM(...)`；求值在服务端，前端只应用结果。

### 14.6 可选下一刀

1. 从 `BreakLine` 结果追到 canvas `fillText` / 单元格背景 `fillRect`。  
2. 解压一条非空 `formulaResZip`，核对 `standardCell` 与 FieldType 对齐。
