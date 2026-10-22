# VERIFY-M10：分享 / 公开视图 / 配额壳

## 1. 企微证据

截图 `06-share-public/`（分享表单）；`08-pricing-limits/` 目录在（配额壳）；HAR `privilegeAttribute` can_share；自动化 list 含 `workflow_limit` / `action_limit`。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| 分享面板 | `SharePanel.vue` | **对齐交互** |
| 公开视图链接 | `public-views` token(+password) | **对齐主类** |
| 表单分享 audience/过期 | forms share JSON | **对齐**（见 M5） |
| 工作流额度 | `quotas.assertAutomationRun` 等 | **意图对齐** |
| 定价页企微套餐 | 本系统配额配置 | **自洽，不孪生** |

## 3. 偏差

无证据表明必须孪生企微计费档；壳层与能力开关对齐即可。

## 4. 性能

无热点。

## 5. 结论

壳层合格。→ M11。
