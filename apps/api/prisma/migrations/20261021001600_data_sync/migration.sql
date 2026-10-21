-- External data sync: definitions, runs and uploaded CSV/Excel fixtures (Task 24).

CREATE TABLE IF NOT EXISTS "data_syncs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sheet_id" uuid NOT NULL,
  "name" text NOT NULL,
  "source_type" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}',
  "mapping" jsonb NOT NULL DEFAULT '{}',
  "match_field_id" uuid,
  "mode" text NOT NULL DEFAULT 'upsert',
  "cron" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "next_run_at" timestamptz(6),
  "last_run_at" timestamptz(6),
  "created_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "data_syncs_sheet_id_fkey"
    FOREIGN KEY ("sheet_id") REFERENCES "sheets"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "data_syncs_sheet_id_idx" ON "data_syncs" ("sheet_id");
CREATE INDEX IF NOT EXISTS "data_syncs_enabled_next_run_at_idx"
  ON "data_syncs" ("enabled", "next_run_at");

CREATE TABLE IF NOT EXISTS "data_sync_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sync_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'running',
  "trigger" text NOT NULL DEFAULT 'manual',
  "rows_read" integer NOT NULL DEFAULT 0,
  "rows_written" integer NOT NULL DEFAULT 0,
  "error" text NOT NULL DEFAULT '',
  "started_at" timestamptz(6) NOT NULL DEFAULT now(),
  "finished_at" timestamptz(6),
  CONSTRAINT "data_sync_runs_sync_id_fkey"
    FOREIGN KEY ("sync_id") REFERENCES "data_syncs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "data_sync_runs_sync_id_started_at_idx"
  ON "data_sync_runs" ("sync_id", "started_at");

CREATE TABLE IF NOT EXISTS "data_sync_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sheet_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "mimetype" text NOT NULL DEFAULT '',
  "size" integer NOT NULL,
  "content" bytea NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "data_sync_files_sheet_id_idx"
  ON "data_sync_files" ("sheet_id");
