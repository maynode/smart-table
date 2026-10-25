# W6 最终报告（2026-10-26）

> 交接用。对照 `docs/REMAINING-GAPS.md`、企微智能表格对齐方案。第 6 条（像素级视觉对齐 mock）本轮按产品指令不做。

## 1. 变更摘要

| 项 | 内容 |
|----|------|
| 网格搜索 | `ViewQuery.search` → API `cells::text ILIKE`；前端去掉仅已加载行的本地过滤；记录数去掉未拉齐「+」暗示 |
| 模板占位 | 「导入 Excel / 我的模板」未就绪入口从 `TemplatePanel` 正式隐藏 |
| ClickHouse 分析 | `ClickHouseAnalyticsAdapter` 接入与 PG 同源的 `FilterGroup` WHERE；单测覆盖 equals/gt |
| 内容 ACL | 新增 `form-dashboard-acl.e2e-spec.ts`：form/dashboard `none` 隐藏列表与 403、非管理员不可改权限 |
| 分析报告 UI | 新增 Playwright `e2e/analysis-report.spec.ts`：创建→对话确认→生成→删除 |
| Compose 冒烟 | `scripts/smoke-compose.mjs` 注册改为 `account` + 密码策略 `Ab12_cd34` + 密保 |
| 断网/离线 | MessageCenter + IndexedDB + `POST /sheets/:id/commitchanges`；公开表幂等；见 `docs/OFFLINE.md` |

## 2. 验证命令与结果

```bash
pnpm --filter shared build
pnpm --filter api exec jest src/analytics/clickhouse-analytics.adapter.spec.ts
# → PASS（含 filters WHERE）

pnpm --filter api test:e2e -- form-dashboard-acl.e2e-spec.ts --runInBand
# → PASS 3/3

pnpm --filter web exec playwright test e2e/analysis-report.spec.ts
# → PASS 1/1（dev :5173 + API :3000）

docker compose build api web
# → Built；顺带修 deploy/entrypoint-api.sh CRLF（否则 alpine sh: illegal option -）
docker compose up -d api web claim-worker
pnpm smoke:compose
# → 文档齐套 / API 健康 / Web 可达 / 公开领取成功页 / 自动化 success
```

客观限制：本机 3000 若被 Vite/dev 占用需先停再起 compose API；`perf:window` 仍缺千万行 `.perf-env.json`。

## 3. 启动步骤

**开发（验收主路径）：**

```bash
docker compose up -d postgres pgbouncer redis minio   # 或已有本机依赖
pnpm --filter shared build
pnpm --filter api start:dev
pnpm --filter web dev
# 浏览器：http://127.0.0.1:5173/ 或局域网 http://<本机IP>:5173/
```

**Compose 验收口：**

```bash
docker compose up -d --build
pnpm smoke:compose
# Web :8080，API 经网关/直连按 DEPLOYMENT.md
```

**ClickHouse（可选）：**

```bash
docker compose --profile analytics up -d clickhouse
# ANALYTICS_ADAPTER=clickhouse 重启 api；见 docs/DASHBOARD.md
```

## 4. 剩余客观限制

1. **视觉像素对齐（原第 6 条）**：本轮明确不做。
2. **`perf:window`**：无预置千万行环境文件，无法出窗口拉取压测数。
3. **企微真群/真通讯录**：`WECOM_ENABLED=false` 时 Local fallback，非生产企微凭证验收。
4. **Docker 镜像**：本轮已 rebuild + smoke 绿；Windows 检出需保证 `deploy/*.sh` 为 LF（见 `.gitattributes` 若后续补）。
