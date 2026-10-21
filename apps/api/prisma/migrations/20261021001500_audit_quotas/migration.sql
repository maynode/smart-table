-- Audit trail, installation/workspace quotas and storage accounting (Task 23).

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid,
  "actor_id" uuid,
  "action" text NOT NULL,
  "object_type" text NOT NULL,
  "object_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "ip" text NOT NULL DEFAULT '',
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_logs_workspace_id_created_at_idx"
  ON "audit_logs" ("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs" ("action");
CREATE INDEX IF NOT EXISTS "audit_logs_object_type_object_id_idx"
  ON "audit_logs" ("object_type", "object_id");

CREATE TABLE IF NOT EXISTS "quota_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "workspace_id" uuid UNIQUE,
  "max_seats" integer NOT NULL DEFAULT 50,
  "max_storage_bytes" bigint NOT NULL DEFAULT 10737418240,
  "max_automation_runs_per_month" integer NOT NULL DEFAULT 10000,
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "storage_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "key" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "storage_objects_workspace_id_idx"
  ON "storage_objects" ("workspace_id");
