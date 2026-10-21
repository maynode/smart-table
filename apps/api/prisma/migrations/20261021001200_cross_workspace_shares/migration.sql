-- Cross-workspace Base/Sheet grants (Task 20).

CREATE TABLE IF NOT EXISTS "cross_workspace_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_workspace_id" uuid NOT NULL,
  "target_workspace_id" uuid NOT NULL,
  "object_type" text NOT NULL,
  "object_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "cross_workspace_shares_source_workspace_id_fkey"
    FOREIGN KEY ("source_workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "cross_workspace_shares_target_workspace_id_fkey"
    FOREIGN KEY ("target_workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "cross_workspace_shares_object_type_object_id_target_workspace_id_key"
    UNIQUE ("object_type", "object_id", "target_workspace_id")
);
CREATE INDEX IF NOT EXISTS "cross_workspace_shares_target_workspace_id_idx"
  ON "cross_workspace_shares" ("target_workspace_id");
CREATE INDEX IF NOT EXISTS "cross_workspace_shares_source_workspace_id_idx"
  ON "cross_workspace_shares" ("source_workspace_id");
