# Kubernetes 部署

适用于已有 PostgreSQL/Redis（或使用 Operator）的集群。Compose 仍是单机默认交付方式。

## 1. 准备

```bash
kubectl create namespace smart-table
kubectl -n smart-table create secret generic smart-table-secrets \
  --from-literal=DATABASE_URL='postgresql://user:pass@pgbouncer:6432/smarttable?pgbouncer=true&connection_limit=10' \
  --from-literal=DIRECT_DATABASE_URL='postgresql://user:pass@postgres:5432/smarttable' \
  --from-literal=REDIS_URL='redis://redis:6379' \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=S3_ACCESS_KEY='minio' \
  --from-literal=S3_SECRET_KEY='minio-secret'

kubectl -n smart-table create configmap smart-table-config \
  --from-literal=PUBLIC_FORM_BASE_URL='https://table.example.com' \
  --from-literal=SUBMIT_MODE='sync' \
  --from-literal=S3_DRIVER='minio' \
  --from-literal=S3_ENDPOINT='http://minio:9000' \
  --from-literal=S3_BUCKET='smart-table'
```

> `DATABASE_URL` 必须走 PgBouncer（6432，事务模式）；`DIRECT_DATABASE_URL` 走 5432，只给迁移使用。

## 2. 构建并推送镜像

```bash
docker build -f deploy/Dockerfile.api -t registry.example.com/smart-table-api:1.0.0 .
docker build -f deploy/Dockerfile.web -t registry.example.com/smart-table-web:1.0.0 .
docker push registry.example.com/smart-table-api:1.0.0
docker push registry.example.com/smart-table-web:1.0.0
```

把清单中的 `image:` 替换为实际仓库地址。API 容器入口会先执行 `prisma migrate deploy`，多副本同时启动时 Prisma 迁移锁保证只有一个执行。

## 3. 应用

```bash
kubectl apply -f deploy/k8s/api-deployment.yaml
kubectl apply -f deploy/k8s/claim-worker-deployment.yaml
kubectl apply -f deploy/k8s/web-deployment.yaml
kubectl apply -f deploy/k8s/api-hpa.yaml
```

- `api`：2 副本起，HPA 按 CPU 70% 扩到 10；`/health` 探针；`/metrics` 供 Prometheus 抓取。
- `claim-worker`：消费 `form-submissions` 与 `automation-runs` 队列；建议与 API 分开扩容。
- `web`：nginx 托管静态资源，需在 Ingress 把 `/api`、`/files` 转发到 `smart-table-api:3000`（或直接把 nginx Service 暴露，nginx.conf 已内置反代）。

## 4. Ingress 示例

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: smart-table
  namespace: smart-table
spec:
  rules:
    - host: table.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: smart-table-web
                port:
                  number: 80
```

## 5. 扩缩容与队列

- 同步模式（默认）：提交在 API 事务内完成，最简单；压测 100 并发/50 码已验证 50 成功 50 明确失败。
- 队列模式：API 设 `SUBMIT_MODE=queue`，提交返回 202 + `pollUrl`；worker 设 `SUBMIT_MODE=queue` 且 `AUTOMATION_QUEUE=bullmq`，横向扩容 worker 即可提升吞吐。
- 队列模式下 API 也会启动提交 worker；如需严格分离，可给 API 增加 `SUBMIT_WORKER=off`（后续扩展点），当前重复消费是安全的：提交状态以数据库为准，已完成任务直接跳过。

## 6. 存储

- 对象存储：S3/MinIO，确保 bucket 存在且 API/worker 均可访问。
- 数据库备份：每日 `pg_dump -Fc`；恢复步骤见 `docs/DEPLOYMENT.md`。

## 7. 监控

- `GET /metrics` 输出 Prometheus 文本：`form_submit_total{mode,status}`、`automation_run_total` 等。
- API Deployment 已带 `prometheus.io/scrape` 注解；没有 Prometheus Operator 时用静态抓取。
- 建议告警：提交 409 比例突增（码尽）、`automation_run_total{status="failed"}`、API p95、队列积压。
