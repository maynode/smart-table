-- Content permissions (Task 17) and record owner for "own records" scope.

ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "created_by" uuid;

CREATE TABLE IF NOT EXISTS "content_permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "subject_type" text NOT NULL DEFAULT 'everyone',
  "subject_id" text NOT NULL DEFAULT '',
  "level" text NOT NULL,
  "record_rule" jsonb,
  "field_rule" jsonb,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_permissions_object_type_object_id_subject_type_subject_id_key"
  ON "content_permissions" ("object_type", "object_id", "subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "content_permissions_workspace_id_object_type_idx"
  ON "content_permissions" ("workspace_id", "object_type");
