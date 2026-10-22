# 校验③：公开表单可见条件与成功页 — 企微源码对照

> 日期：2026-10-22  
> 证据：`page-smartsheet-main.*.js` i18n（`form_only_when` / `form_show_on_met` / `form_visible_setting*` / `form_field` / `form_required` / 封面·二维码）；灰度 `ENABLE_FORM_CASCADE_VISIBLE`  
> 我方：`packages/shared/form-display.ts`、`forms.service.ts`、`FormFillView.vue`、`FormBuilderPanel.vue`

## 1. 企微侧

| 能力 | 源码/文案痕迹 |
|------|----------------|
| 字段条件显示 | `form_only_when`「仅在满足以下」+ `form_show_on_met`「时显示」；`form_entry_visible_tips` |
| 级联可见 | 灰度 `wecom:smartsheet:enable_form_cascade_visible` |
| 条件字段限制 | `form_visible_setting_unsupport`：公式/查找引用字段不可作条件 |
| 必填 / 字段进出 | `form_required` / `form_field` / `form_remove` |
| 分享 | `link_copy`「已复制填写链接」；封面、二维码文案 |
| 谁可填 / 可见设置 | `form_visible_setting`、`form_view_share_seting` |

本 HAR 未抓到独立「成功页模板」HTTP；企微偏站内通知 + 默认感谢文案。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| 仅在满足条件时显示（AND） | `displayConditions.every(...)`：equals/notEquals/contains/notEmpty/isEmpty | **对齐** |
| 级联可见 | 前端按作答值动态显隐；提交只校验可见必填 | **对齐** |
| 公式/查找不可作条件 | 未硬拦（编辑器可选任意字段） | **弱差**（可后续禁选） |
| 封面 / 二维码 / 复制链接 | `coverUrl`、分享 QR、`shareToken` | **对齐** |
| 谁可填写 / 过期 | `audience` + `expiresAt`（`assertShareOpen`） | **对齐** |
| 成功反馈 | `successTemplate` + `{{序列号}}` 等变量；领取同事务出码 | **强于企微**（产品允许） |

## 3. 性能 / 安全

- 公开提交：并发槽位 + IP/token 限流；重复手机号 advisory lock（领取场景）。
- 可选 Bearer → `submitterUserId`（对齐企微「填写者」；匿名走管理员回落）。

## 4. 结论

可见条件语义与分享面相对企微对齐；成功页模板与领取直出为增强。→ 校验④。
