# 外部数据同步

把外部 HTTP JSON API 或上传的 CSV/Excel 定时写入工作表，支持字段映射、upsert/覆盖和运行日志。

## 数据源

### HTTP JSON

`GET` 目标 URL，支持：

- 顶层 JSON 数组 `[{...}]`；
- `{ "data": [{...}] }`；
- `{ "rows": [{...}] }`。

可传自定义请求头（如 Token）。超时 15 秒，非 2xx 或非数组记为失败。

### CSV / Excel

先上传文件（≤5MB，`.csv` / `.xlsx`）取得 `fileId`，再创建同步：

```http
POST /sheets/:sheetId/data-syncs/files
Content-Type: multipart/form-data
file=@rows.csv
```

CSV 支持引号与转义；XLSX 读取第一个工作表，首行为表头。

## 创建

```http
POST /sheets/:sheetId/data-syncs
```

```json
{
  "name": "CRM 客户同步",
  "sourceType": "http",
  "config": { "url": "https://crm.example.com/api/customers" },
  "mapping": { "customer_no": "<fieldId>", "name": "<fieldId>" },
  "matchFieldId": "<fieldId>",
  "mode": "upsert",
  "cron": "0 * * * *"
}
```

- `mapping` 的 key 是外部列名/JSON 字段，value 是本表字段 ID；字段必须属于该 Sheet。
- `matchFieldId` 配合 `upsert`：按该字段值查找已有记录，存在则更新，否则新增。
- `mode: "replace"`：先清空本表记录再写入（定时覆盖场景）。
- `cron` 为 5 段表达式；服务进程每 60 秒检查 `next_run_at` 并执行到期任务。多副本部署时建议仅由单个 scheduler 副本运行，或后续切换 BullMQ 调度。

## 运行与日志

| 接口 | 说明 |
| --- | --- |
| `POST /data-syncs/:id/run` | 立即执行，返回 run（`success`/`failed`） |
| `GET /data-syncs/:id/runs` | 最近 50 次运行 |
| `GET /sheets/:sheetId/data-syncs` | 同步任务列表 |
| `DELETE /data-syncs/:id` | 删除任务及日志 |

写入复用 `SheetsService`：ACL、字段校验、自动化、Webhook、行版本与审计均与手工写入一致。失败不会中断请求，错误写入 `data_sync_runs.error`，并记录 `sync.failed` 审计。

## 前端

Base 顶栏「同步数据」打开向导：选择 HTTP/文件、填写 URL 或上传文件、逐列映射字段、选择匹配字段/模式/Cron；任务列表可立即同步、查看运行记录和删除。
