# 公开只读视图

公开只读链接用于把一张工作表以 **GET-only** 方式展示给外部人员；与「可编辑公网外链」严格区分，任何写操作都返回 403。

## 能力

- 链接由随机 24 字节 token 生成，形如 `/view/:token`。
- 可选访问密码（argon2id 哈希存储，至少 4 位）。
- 可选有效期；过期返回 410，撤销/关闭返回 404。
- 只返回未隐藏字段；隐藏字段即使存在于记录 `cells` 中也不会下发。
- 返回最多 500 行只读快照；不含 token 的写接口全部 403。
- 与表单公开提交（`/fill/:token`）是两套 token/权限链路，互不复用。

## 接口

| 接口 | 鉴权 | 说明 |
| --- | --- | --- |
| `POST /sheets/:sheetId/public-views` | 登录 + editor | `{name?, password?, expiresAt?}`，返回 `url` |
| `GET /sheets/:sheetId/public-views` | 登录 + editor | 列出该 Sheet 的链接 |
| `DELETE /public-views/:id` | 登录 + editor | 立即失效 |
| `GET /public-views/:token?password=` | 公开 | 无密码直接返回；有密码缺参 401、错误 403 |
| `POST /public-views/:token/verify` | 公开 | `{password}` 校验并返回数据 |
| `POST/PATCH/DELETE /public-views/:token/records...` | 公开 | 固定 403 |

## 数据形态

```json
{
  "readonly": true,
  "name": "对外数据",
  "sheet": { "id": "...", "name": "公开数据" },
  "fields": [{ "id": "...", "name": "名称", "type": "text" }],
  "records": [{ "id": "...", "cells": { "<fieldId>": "公开行" } }]
}
```

前端 `/view/:token` 页面只用文本渲染，不挂 Canvas 编辑器、不显示评论/自动化入口；密码视图先显示密码框，验证成功后渲染表格。
