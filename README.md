# 智能表格（私有化）

企业私有化部署的智能表格：能力与交互对标 **企业微信智能表格 + 仪表盘**，并在成功页动态字段、自动化「只处理 N 条（默认 1）」、并发占码原子安全、百万级填表 / 千万行网格上做到更强。

## 仓库结构

```
apps/web      Vue 3 + 多层 Canvas 网格
apps/api      NestJS (Fastify) + Prisma + 占码 worker
packages/shared  字段类型 / 自动化 / 表单成功页 / 视图查询契约
deploy/       Kubernetes 与部署资产
docs/         产品、设计、实施计划与企微截图参照
```

## 本地启动

```bash
# 1. 依赖
pnpm install

# 2. 基础设施（postgres + pgbouncer + redis；对象存储默认用本地目录模拟 S3）
docker compose up -d postgres pgbouncer redis
# 可选：真实 MinIO（需镜像可用，且 .env 里 S3_DRIVER=minio）
# docker compose --profile object-storage up -d

# 3. 环境变量
cp .env.example .env

# 4. API（http://localhost:3000/health）
pnpm --filter api start:dev

# 5. Web（http://localhost:5173）
pnpm --filter web dev
```

## 测试

```bash
pnpm --filter api test:e2e     # API e2e
pnpm --filter web test         # 前端单测
```

## 端口

| 服务 | 端口 |
|------|------|
| API | 3000 |
| Web (Vite) | 5173 |
| PostgreSQL（直连，迁移用） | 5432 |
| PgBouncer（运行时连接池） | 6432 |
| Redis | 6379 |
| MinIO API / Console | 9000 / 9001 |
