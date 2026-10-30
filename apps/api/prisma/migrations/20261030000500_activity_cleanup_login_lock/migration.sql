-- AlterTable
ALTER TABLE "users" ADD COLUMN "login_failed_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "login_locked_until" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
