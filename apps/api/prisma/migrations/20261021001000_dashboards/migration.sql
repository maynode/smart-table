-- Dashboards, widget charts and scheduled dashboard delivery (Task 18).

CREATE TABLE IF NOT EXISTS "dashboards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "base_id" uuid NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'dashboard',
  "layout" jsonb NOT NULL DEFAULT '[]',
  "created_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "dashboards_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "dashboards_base_id_idx" ON "dashboards" ("base_id");

CREATE TABLE IF NOT EXISTS "dashboard_widgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dashboard_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "sheet_id" uuid,
  "config" jsonb NOT NULL DEFAULT '{}',
  "layout" jsonb NOT NULL DEFAULT '{}',
  "order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "dashboard_widgets_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "dashboard_widgets_dashboard_id_idx" ON "dashboard_widgets" ("dashboard_id");

CREATE TABLE IF NOT EXISTS "dashboard_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dashboard_id" uuid NOT NULL,
  "cron" text NOT NULL,
  "channel" text NOT NULL DEFAULT 'notification',
  "enabled" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz(6),
  "next_run_at" timestamptz(6),
  "created_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "dashboard_schedules_dashboard_id_fkey" FOREIGN KEY ("dashboard_id") REFERENCES "dashboards"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "dashboard_schedules_dashboard_id_idx" ON "dashboard_schedules" ("dashboard_id");

CREATE TABLE IF NOT EXISTS "dashboard_schedule_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "schedule_id" uuid NOT NULL,
  "status" text NOT NULL,
  "message" text NOT NULL DEFAULT '',
  "payload" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "dashboard_schedule_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "dashboard_schedules"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "dashboard_schedule_runs_schedule_id_created_at_idx"
  ON "dashboard_schedule_runs" ("schedule_id", "created_at");
