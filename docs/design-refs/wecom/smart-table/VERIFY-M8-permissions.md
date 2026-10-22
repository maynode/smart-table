# VERIFY-M8：内容权限（行 / 列）

## 1. 企微证据

截图 `05-permissions/`：全员对象列表 → 表权限 → 记录范围菜单 → 档位（全部/可编辑/仅浏览/无）→ 行/列细调。request-map / HAR 有 visibility/editability mutation 3041/3044 痕迹；细粒度 ACL HTTP 本材料未完整展开 → 以截图交互为准。

## 2. 我方映射

入口：`PermissionsPanel.vue`、`permissions.service.ts`（`assertCan` / `applyReadScope` / `fieldRule` / `rowVisible`）。

| 企微交互 | 我方 | 状态 |
|----------|------|------|
| 全员 + 指定成员 | everyone + member subject | **对齐** |
| 浏览/编辑/无 | role + contentPermission | **对齐** |
| 记录范围 | row rule（filter / 仅自己创建等） | **对齐主类** |
| 字段可见/可编 | `fieldRule.mode=fields` | **对齐** |
| 首页钻取细调 | PermissionsPanel 列表→详情 | **对齐截图** |

## 3. 偏差

企微「部门/标签」主体：产品不做企微通讯录 → 用本系统成员表达。材料无更多算子细节 → 不编造。

## 4. 性能

读时在已查询 records 上 filter；大表应下推 SQL（知悉债）。写路径 `assertCan` 单次。

## 5. 结论

壳与主语义对齐。→ M9。
