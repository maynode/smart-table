# 部署指南（私有化）

本产品以 Docker Compose 为默认交付形态，Kubernetes 清单位于 `deploy/k8s/`。所有数据、对象存储、队列都留在企业内部网络，不依赖任何公网 SaaS。

## 1. 组件

| 组件 | 镜像/位置 | 作用 |
| --- | --- | --- |
| `postgres` | `postgres:16-alpine` | 唯一事实源：工作区、Base、工作表、记录、表单、自动化运行日志 |
| `pgbouncer` | `edoburu/pgbouncer:v1.23.1-p2` | 事务模式连接池，API 走 6432；迁移走直连 5432 |
| `redis` | `redis:7-alpine` | BullMQ 队列、限流辅助 |
| `api` | `deploy/Dockerfile.api` | NestJS + Fastify HTTP API，启动前执行 `prisma migrate deploy` |
| `web` | `deploy/Dockerfile.web` | nginx 托管 Vue 构建产物，代理 `/api` 与 `/files` |
| `claim-worker` | 复用 API 镜像 | `AUTOMATION_QUEUE=bullmq`，消费自动化任务 |
| `minio`（可选） | `object-storage` profile | S3 兼容对象存储；默认用本地目录模拟 S3 |

## 2. 快速启动

```bash
cp .env.example .env          # 修改 JWT_SECRET 与数据库密码
docker compose up -d --build
docker compose exec api pnpm --filter api seed:serial-claim
```

- Web：<http://127.0.0.1:8080>
- API 存活：<http://127.0.0.1:3000/health>；就绪（DB+Redis）：<http://127.0.0.1:3000/ready>
- 演示账号：`demo@smart-table.local` / `Passw0rd!123`
- 种子命令会输出分享链接，形如 `http://127.0.0.1:8080/fill/<token>`

冒烟验证：

```bash
pnpm smoke:compose
```

脚本会检查文档齐套、API/Web 可达，并真实走一遍「建表 → 建码库 → 表单提交 → 成功页含序列号 → 自动化运行成功」。

## 3. 关键环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 6432 + `pgbouncer=true` | 运行期连接池地址 |
| `DIRECT_DATABASE_URL` | 5432 | Prisma 迁移/DDL 直连，绝不能走 PgBouncer |
| `REDIS_URL` | `redis://redis:6379` | BullMQ |
| `JWT_SECRET` | 开发占位 | **生产拒启弱密钥**：长度 ≥32 且不得含 `dev-only`；Compose 默认仅为本机演示密钥，上线前必须替换 |
| `METRICS_TOKEN` | 空 | 生产必填；`/metrics` 需 Bearer / `x-metrics-token` / `?token=` |
| `STRICT_ENV` | 空 | 设为 `1` 时即使非 production 也启用 JWT/metrics 门禁 |
| `PUBLIC_FORM_BASE_URL` | `http://127.0.0.1:8080` | 分享链接/二维码的站点根地址 |
| `PUBLIC_SUBMIT_RATE_LIMIT` | `30` | 每个分享 token + IP 每 60 秒提交上限 |
| `S3_DRIVER` | `filesystem` | `filesystem` 本地目录；`minio` 走 S3 |
| `S3_LOCAL_DIR` | `/data/s3`（Compose 卷） | 本地对象目录 |
| `SUBMIT_MODE` | `sync` | `sync` 同步返回；`queue` 由 worker 异步执行 |
| `AUTOMATION_QUEUE` | `inline` | API 进程内联执行；`bullmq` 交给 claim-worker |

### 切换 MinIO

```bash
# .env: S3_DRIVER=minio, S3_ENDPOINT=http://127.0.0.1:9000 ...
docker compose --profile object-storage up -d
```

受限网络可先 `docker load` 一个可用 MinIO 镜像，再把 `MINIO_IMAGE` / `MINIO_MC_IMAGE` 指向本地镜像。未启用对象存储时 API 仍可正常领取，封面写入本地卷。

## 4. 数据库迁移

- 迁移文件：`apps/api/prisma/migrations/`，只增不改。
- 容器启动时自动执行 `prisma migrate deploy`（入口脚本）。
- 手工执行：`pnpm --filter api prisma:migrate`。
- 迁移必须使用 `DIRECT_DATABASE_URL`；PgBouncer 事务模式不支持会话级 DDL/预编译语句。

## 5. 备份与恢复

备份（每日建议）：

```bash
docker exec smart-table-postgres pg_dump -U smarttable -d smarttable -Fc \
  > backup-$(date +%F).dump
docker run --rm -v smart-table_claimdata:/data -v "$PWD":/backup alpine \
  tar czf /backup/s3-$(date +%F).tar.gz /data
```

恢复：

```bash
docker compose stop api claim-worker
docker exec -i smart-table-postgres pg_restore -U smarttable -d smarttable --clean \
  < backup-2026-10-21.dump
docker compose start api claim-worker
```

对象存储（MinIO）使用 `mc mirror` 或卷级快照备份；数据库与对象存储需同一恢复点。

## 6. 扩容

- **HTTP API / claim-worker** 可水平扩：worker 占码用 `FOR UPDATE SKIP LOCKED`，公开表单限流与单元格锁走 Redis，多副本一致。
- **协同 WebSocket 必须会话粘滞**：负载均衡对 `/collab` 与 `/live`（含 Upgrade）按连接粘滞到同一 API 副本；房间扇出为进程内，无跨副本 Socket adapter。单元格锁已 Redis 共享，即使用户落到不同 HTTP 副本，锁仍正确。
- Compose 示例里 `api` / `web` 写了 `container_name`，**不能**直接 `docker compose up --scale api=N`（名字冲突）。扩容请去掉 `container_name`，或在前面加 sticky LB / k8s Service（见 `deploy/k8s/`）。
- PgBouncer `DEFAULT_POOL_SIZE` 与 API 的 `connection_limit` 需按数据库连接上限调优。
- 千万行表格渲染在浏览器完成（多图层 Canvas + 视口裁剪），不随 API 扩容线性增加带宽。
- 探针：liveness → `/health`；readiness → `/ready`（DB + Redis）。

## 7. 升级

1. 备份数据库与对象存储。
2. 拉取新镜像/代码，`docker compose build`。
3. `prisma migrate deploy` 会在新 API 容器启动时自动执行。
4. 滚动重启 `api`、`claim-worker`、`web`。
5. 跑 `pnpm smoke:compose`。

## 8. 故障排查

| 现象 | 排查 |
| --- | --- |
| API 启动即退出 | 看 `docker compose logs api`；多为迁移失败或 DATABASE_URL 指向错误 |
| 提交 500 | 检查 `DIRECT_DATABASE_URL` 是否误用了 PgBouncer 端口 |
| 分享链接 404 | `PUBLIC_FORM_BASE_URL` 与 nginx 站点地址不一致 |
| 码尽 409 | 码库中「未领」记录不足；补充记录或调整自动化 |
| 封面 404 | `S3_DRIVER=filesystem` 时确认 `/data/s3` 卷挂载；MinIO 模式确认 bucket 已创建 |
| worker 不消费 | `AUTOMATION_QUEUE=bullmq` 且 Redis 可达；查看 `claim-worker` 日志 |

## 9. 仪表盘分析引擎（可选 ClickHouse）

默认 `ANALYTICS_ADAPTER=postgres`，仪表盘聚合直接读 PostgreSQL JSONB。需要 ClickHouse 时：

```bash
docker compose --profile analytics up -d clickhouse
ANALYTICS_ADAPTER=clickhouse docker compose up -d api
```

compose 中 ClickHouse 暴露 `8123`（HTTP）与 `9000`（native），数据卷 `clickhousedata`；API 通过 `CLICKHOUSE_URL`、`CLICKHOUSE_DATABASE`、`CLICKHOUSE_USER/PASSWORD` 连接。未启用 profile 时不会启动该容器，也不影响默认栈；图表配置与定时推送见 `docs/DASHBOARD.md`。
