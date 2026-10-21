# 文件夹与模板库

## 文件夹

工作区内的 Base 可以放进嵌套文件夹，最多 8 层。

| 接口 | 说明 |
| --- | --- |
| `GET /workspaces/:workspaceId/folders` | 返回文件夹树与未归档 Base |
| `POST /workspaces/:workspaceId/folders` | `{ name, parentId? }` 新建根/子文件夹 |
| `PATCH /folders/:id` | 改名或移动父级；拒绝自引用与成环 |
| `DELETE /folders/:id` | 删除后子文件夹与 Base 上移到父级 |
| `POST /bases/:baseId/move` | `{ folderId }` 或 `null` 归档/移出 |

权限沿用工作区角色：读取需要 `viewer`，创建/移动/删除需要 `editor` 及以上；跨工作区文件夹一律拒绝。

## 模板库

`GET /templates` 返回静态模板目录（不依赖租户数据），`POST /templates/:key/instantiate` 在当前工作区一键生成 Base：

| key | 内容 |
| --- | --- |
| `serial-claim` | 码库（100 个 `SN-0001…` 未领码）+ 收集表单 + 联动修改自动化 + 公开分享链接 |
| `customer-crm` | 客户档案（阶段/金额）与 2 条示例记录 |
| `project-tasks` | 项目任务（优先级/截止日期/完成）与 2 条示例记录 |

- 实例化要求 `editor`；可传 `folderId` 直接放入文件夹。
- `serial-claim` 复用 Task 11 的种子结构（字段 id 动态生成，不复制演示账号），返回 `shareUrl`。
- 模板生成的是**独立副本**，后续改模板定义不会影响已创建的 Base。

## 前端入口

侧栏「文件夹」「模板」打开对应弹窗：文件夹树支持新建根/子文件夹、移入当前 Base、删除；模板库卡片展示字段数与说明，点击「使用模板」后跳转到新 Base。
