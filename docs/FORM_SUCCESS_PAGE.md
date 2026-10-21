# 表单成功页

成功页是「智能表格」相对企微智能表格的关键增强：提交后展示的值来自自动化执行结果，而不是表单里预先填写的内容。

## 1. 变量合并规则

```
successValues = buildSuccessValues({ formCells, stepOutputs })
```

- `formCells`：表单收集到的字段，键为**字段名**（如 `手机号`）。
- `stepOutputs`：自动化运行产出的扁平值，键同为字段名（如 `序列号`、`领取时间`）。
- 同名时 `stepOutputs` 覆盖 `formCells`。
- 空值/`null` 渲染为空字符串；数组以 `, ` 连接；对象序列化为 JSON。

## 2. 模板渲染

```ts
renderSuccessTemplate(templateHtml, values)
```

- `{{字段名}}` 占位符，允许空格：`{{ 序列号 }}`。
- **未知变量原样保留**（例如 `{{客服}}` 尚未由自动化产出时仍显示花括号），避免成功页出现空白或 500。
- 插入值统一 HTML 转义（`& < > " '`），模板本身由管理员维护，作为可信 HTML 渲染；用户输入无法注入脚本。

示例：

```html
<h2>领取成功</h2>
<p>你的序列号是 <strong>{{序列号}}</strong></p>
<p>领取时间：{{领取时间}}</p>
```

## 3. 提交链路

`POST /public/forms/:token/submit`

1. 限流：同一 `token + IP` 每 60 秒最多 `PUBLIC_SUBMIT_RATE_LIMIT` 次，超出返回 `429`。
2. 分享状态：关闭或过期返回 `403`。
3. 字段校验：只接受表单配置的可见字段；隐藏字段被丢弃；必填缺失返回 `400`。
4. 手机号防重（默认开启）：事务内 advisory lock + 查询；重复返回 `409`「该手机号不可重复领取」。
5. 事务：写表单记录 → 写 submission → 触发绑定到该 sheet 的 `recordCreated` 自动化。
6. 码尽：自动化运行 `skipped` → 抛 `409`，事务回滚，表单记录/领取流水/码库修改都不落库。
7. 成功：合并 `formCells ∪ stepOutputs`，渲染 HTML，返回：

```json
{
  "submissionId": "…",
  "recordId": "…",
  "status": "completed",
  "success": { "html": "领取成功，你的序列号是 <strong>DEMO-0001</strong>" },
  "stepOutputs": { "序列号": "DEMO-0001", "领取时间": "2026-10-21" }
}
```

## 4. 预览接口

`POST /forms/:id/success-preview`（需 editor 权限）

```json
{
  "formCells": { "手机号": "13800000000" },
  "stepOutputs": { "序列号": "TEST-01", "客服": "小助手" }
}
```

返回 `{ html, values }`，供表单编辑器实时预览；不触发自动化、不写数据。

## 5. 错误码

| HTTP | 场景 | 前端处理 |
| --- | --- | --- |
| 400 | 必填缺失/未知字段 | 展示具体字段提示 |
| 403 | 分享关闭或过期 | 展示「链接已失效」 |
| 404 | token 不存在 | 展示「表单不存在」 |
| 409 | 码尽 / 手机号重复 | 展示后端 message，保留表单内容 |
| 429 | 提交过于频繁 | 提示稍后重试 |

## 6. 安全

- 模板只允许管理员在后台编辑；公开接口不接收模板。
- 所有插值转义；未知变量保留但不执行。
- 分享 token 随机不可枚举；支持到期时间与随时关闭。
- 公开接口不需要登录，但所有查询都按 token 限定到单个表单。
