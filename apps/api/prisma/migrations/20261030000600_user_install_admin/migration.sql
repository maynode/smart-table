-- AlterTable
ALTER TABLE "users" ADD COLUMN "install_admin" BOOLEAN NOT NULL DEFAULT false;

-- 兼容旧语义：未配置 INSTALL_ADMIN_* 时最早注册用户为系统管理员
UPDATE "users"
SET "install_admin" = true
WHERE "id" = (
  SELECT "id" FROM "users" ORDER BY "created_at" ASC LIMIT 1
);
