-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "base_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "on_find_empty" TEXT NOT NULL DEFAULT 'continue',
    "monthly_quota" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "idempotency_key" TEXT,
    "trigger_record_id" UUID,
    "outputs" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_run_steps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "output" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "duration_ms" INTEGER,

    CONSTRAINT "automation_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_chats" (
    "id" UUID NOT NULL,
    "base_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "member_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_chats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automations_base_id_idx" ON "automations"("base_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_automation_id_idempotency_key_key" ON "automation_runs"("automation_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "automation_runs_automation_id_started_at_idx" ON "automation_runs"("automation_id", "started_at");

-- CreateIndex
CREATE INDEX "automation_run_steps_run_id_step_index_idx" ON "automation_run_steps"("run_id", "step_index");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "group_chats_base_id_idx" ON "group_chats"("base_id");

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run_steps" ADD CONSTRAINT "automation_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
