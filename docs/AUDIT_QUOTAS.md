# 审计日志与配额

## 审计

记录级写操作会写入 `audit_logs`，用于私有化部署的合规追溯：

- `record.created` / `record.updated` / `record.deleted`
- 字段：workspace、actor、objectType/objectId、metadata（sheetId、baseId、变更 cells、版本号）、IP、时间
- 审计写入失败只记录日志，不阻断业务请求

查询（需工作区成员）：

```http
GET /workspaces/:id/audit-logs?action=record.updated&objectType=record&actorId=&limit=100
```

按时间倒序，`limit` 最大 200。面板入口：Base 顶栏「配额」旁无独立审计 UI 时可通过 API 查询；后续可在管理台扩展。

## 配额

支持安装级策略 + 工作区覆盖；工作区覆盖优先。

| 配额 | 默认值 | 超限错误码 |
| --- | --- | --- |
| 席位数 | 50 | `QUOTA_SEATS_EXCEEDED` |
| 存储字节 | 10 GiB | `QUOTA_STORAGE_EXCEEDED` |
| 每月自动化运行次数 | 10000 | `QUOTA_AUTOMATION_RUNS_EXCEEDED` |

默认值可用 `QUOTA_MAX_SEATS`、`QUOTA_MAX_STORAGE_BYTES`、`QUOTA_MAX_AUTOMATION_RUNS_PER_MONTH` 覆盖。

查询用量（工作区成员）：

```http
GET /workspaces/:id/quota
```

返回 `limits`、`usage`、`exceeded`、`canEdit`。用量实时聚合：成员数、`storage_objects` 字节和、本月 `automation_runs` 数。

安装管理员：

- 环境变量 `INSTALL_ADMIN_EMAILS` 逗号分隔；未配置时最早注册的用户视为安装管理员（单租户私有化默认）。
- `GET /admin/quotas` 查看安装策略和 `canEdit`。
- `PUT /admin/quotas`：

```json
{
  "scope": "installation",
  "maxSeats": 200,
  "maxStorageBytes": 107374182400,
  "maxAutomationRunsPerMonth": 50000
}
```

`scope: "workspace"` + `workspaceId` 可给单个工作区覆盖。

执行点：

- 邀请成员前检查席位；
- 手动/队列自动化运行前检查本月次数；
- 表单封面上传前检查存储字节，成功后写入 `storage_objects` 计量。

超限返回 403，body 含 `code` 与中文 `message`，前端直接展示。

## 前端

Base 顶栏「配额」打开 `QuotaPanel`：用量进度、安装级策略编辑（仅安装管理员可保存）。UI 不构成权限边界，所有校验在服务端完成。
