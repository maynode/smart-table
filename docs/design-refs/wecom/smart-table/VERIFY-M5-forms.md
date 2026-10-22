# VERIFY-M5：收集表单构建 / 填写 / 成功页

加深 [VERIFY-03-public-form.md](./VERIFY-03-public-form.md)。

## 1. 企微证据

`page-smartsheet-main`：`form_only_when` / `form_show_on_met` / `form_visible_setting_unsupport`（公式/查找不可作条件）/ 封面·二维码；灰度 `ENABLE_FORM_CASCADE_VISIBLE`。截图 `11-form-builder/`、`03-form-success-page/`、`06-share-public/`。

## 2. 我方映射

| 企微 | 我方 | 状态 |
|------|------|------|
| 条件显示 AND | `displayConditions.every` | **对齐** |
| 编辑/填写 Tab | FormBuilderPanel | **对齐** |
| 封面/QR/复制链接 | cover + shareToken | **对齐** |
| audience/过期 | share JSON + `assertShareOpen` | **对齐** |
| 成功页 | `successTemplate` 变量（可出序列号） | **强于企微** |
| 公式字段作条件禁 | UI 过滤 + API 校验拒绝 formula/lookup | **已修对齐** |

## 3. 偏差

~~公式/查找作显示条件~~ → **已修**（`conditionFieldCandidates` + `forms.service` 报错）。

## 4. 性能

提交限流、并发槽、重复手机 advisory lock；与领取同事务。

## 5. 结论

主路径对齐。→ M6。
