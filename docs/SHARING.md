# 跨工作区共享

Workspace A 可把 **Base** 或 **单张 Sheet** 授权给 Workspace B，B 的成员按授权角色访问；撤销后立即失效。与「公开只读链接」不同，跨工作区共享仍要求登录且用户属于目标工作区。

## 数据模型

`cross_workspace_shares`：

| 列 | 说明 |
| --- | --- |
| source_workspace_id | 资源所在工作区 |
| target_workspace_id | 被授权工作区 |
| object_type / object_id | `base` 或 `sheet` |
| role | `view`（只读）/ `edit`（可编辑） |
| created_by | 授权人 |

唯一约束 `(object_type, object_id, target_workspace_id)`，重复授权返回 409。

## 接口

| 接口 | 说明 |
| --- | --- |
| `POST /workspaces/:sourceId/shares` | 授权；要求源工作区 `admin` |
| `GET /workspaces/:workspaceId/shares?direction=out\|in` | 列出授出/收到 |
| `DELETE /shares/:id` | 撤销；源工作区 owner 或目标工作区 admin |

## 权限解析

1. 先按正常成员关系判断；源工作区成员不受共享影响。
2. 非成员且属于目标工作区时，查找 `sheet` 直接授权或 `base` 授权：
   - `view` → `viewer`
   - `edit` → `editor`
3. Base 授权对 Base 下所有 Sheet 生效；Sheet 授权只放开该 Sheet，`GET /bases/:id/sheets` 只返回被授权的那张表。
4. 行/列 ACL（`content_permissions`）继续生效；共享用户的角色参与内容权限计算，但不会成为 owner/admin，因此不能管理权限。
5. 撤销后所有共享解析立即返回 403；不依赖缓存或 token 失效。

## UI

编辑器顶栏「共享」打开面板：选择整个 Base 或当前 Sheet、目标工作区、view/edit，列出已授出记录并可撤销。目标工作区主页的 Base 列表会包含被共享的 Base。
