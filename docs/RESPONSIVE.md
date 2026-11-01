# 响应式契约

> 产品设计：`docs/superpowers/specs/2026-10-31-responsive-adaptive-ux-design.md`  
> 实施计划：`docs/superpowers/plans/2026-10-31-responsive-adaptive-ux.md`

## 断点

| Token | 宽度 | 实现 |
|-------|------|------|
| phone | `≤767` | `viewportModeFromWidth` / `@media (max-width: 767.98px)` |
| tablet | `768–1099` | 同上 |
| desktop | `≥1100` | 同上 |

统一入口：`apps/web/src/composables/viewport.ts`、`useViewport.ts`。禁止再引入冲突的 640/860/960 断点（遗留已迁）。

## 壳层

- **站外底栏**：仅 **phone** 显示（首页 / 通知 / 我的；`/admin/*` 同）；平板/桌面用顶栏，避免挤坏 hub 双栏。
- Base、登录、公开页始终隐藏底栏。
- **Base 面 Tab**：数据 | 表单 | 自动化 | 仪表盘 | 分析；侧栏按面过滤；phone 侧栏为抽屉（☰，非面 Tab）。
- **深链**：`?face=&oid=&formMode=`（`applyRouteDeepLink` 必须读取并切换面，不可只写不读）。
- 首页 `.hub` 用 flex 填满 `app-shell-main`，禁止 `100vh`；phone 隐藏工作区侧栏，改用顶栏 select 切换。
- 反馈 FAB 在有站外底栏时抬高 `station-nav-height`，避免挡住「我的」。

## 数据表

- Phone 默认 `RecordListView` + `RecordDetailSheet`；可切 `CompactRecordTable`。
- Tablet/Desktop：`CanvasGrid`（tablet 行高略增）。

## 各面手机形态（本切片）

| 面 | 手机行为 |
|----|----------|
| 表单构建 | 单列；字段条件 / 填写分享进全屏 sheet |
| 自动化 | 面内列表；编辑器全屏；运行日志卡片 |
| 仪表盘 | 单列卡片；添加配置全屏 sheet |
| 分析 | 报告与对话纵向堆叠 |
| 管理用户 | 卡片列表（反馈本就卡片） |
| 通知 / 我的 | 底栏可达；通知断点对齐 phone |

## 验证

- `pnpm --filter web exec vitest run src/composables/viewport.spec.ts src/composables/recordSummary.spec.ts src/views/base-face.spec.ts`
- `pnpm --filter web exec playwright test e2e/responsive-phone.spec.ts`

## CSS 变量

见 `styles.css`：`--bp-phone-max`、`--station-nav-height`、`--touch-min`、`--safe-*`。
