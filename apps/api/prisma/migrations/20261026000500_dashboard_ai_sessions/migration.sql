-- CreateTable
CREATE TABLE "dashboard_ai_sessions" (
    "id" UUID NOT NULL,
    "dashboard_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "dashboard_ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_ai_sessions_dashboard_id_key" ON "dashboard_ai_sessions"("dashboard_id");

-- AddForeignKey
ALTER TABLE "dashboard_ai_sessions" ADD CONSTRAINT "dashboard_ai_sessions_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
