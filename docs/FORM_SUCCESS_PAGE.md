# 表单成功页

提交成功后的正文与自动化「发送消息」步骤一致（插值后的消息内容）；填写页外壳固定为「✓ / 提交成功 / 再填一次」。

- **主文案**：取自自动化 `sendMessage` 产出的 `消息内容`（与站内信同一段字）。
- **无发送消息时**：回退到表单里保存的 `successTemplate`（若有），用 `formCells ∪ stepOutputs` 做 `{{变量}}` 插值。
- **变量**：在自动化「发送消息」里用「插入变量」配置（如第3步的序列号），不要在表单编辑器里另写一套。

## 1. 提交链路

`POST /public/forms/:token/submit`

1. 校验、写记录、跑绑定的 `recordCreated` 自动化。
2. 若 `stepOutputs['消息内容']` 有值 → 转义后作为成功页正文返回。
3. 否则 → `renderSuccessTemplate(successTemplate, buildSuccessValues(...))`。

## 2. 预览接口

`POST /forms/:id/success-preview` 仍按模板 + 示例 `formCells` / `stepOutputs` 渲染，供调试；产品配置入口在自动化「发送消息」。
