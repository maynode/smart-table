-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_account" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "op" TEXT NOT NULL DEFAULT 'other',
    "summary" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL DEFAULT '',
    "resource_type" TEXT NOT NULL DEFAULT '',
    "resource_id" TEXT,
    "workspace_id" UUID,
    "base_id" UUID,
    "sheet_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'api',
    "ip" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "activity_logs_actor_id_created_at_idx" ON "activity_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_action_created_at_idx" ON "activity_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_op_created_at_idx" ON "activity_logs"("op", "created_at");
