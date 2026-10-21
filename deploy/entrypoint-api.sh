#!/bin/sh
set -eu

# Migrations must use the direct connection, never PgBouncer transaction mode.
pnpm --filter api exec prisma migrate deploy

exec node apps/api/dist/main.js
