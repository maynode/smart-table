-- Nested workspace folders and optional base folder membership (Task 19).

CREATE TABLE IF NOT EXISTS "folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "parent_id" uuid,
  "name" text NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "folders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE,
  CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "folders_workspace_id_idx" ON "folders" ("workspace_id");
CREATE INDEX IF NOT EXISTS "folders_parent_id_idx" ON "folders" ("parent_id");

ALTER TABLE "bases" ADD COLUMN IF NOT EXISTS "folder_id" uuid;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bases_folder_id_fkey'
  ) THEN
    ALTER TABLE "bases"
      ADD CONSTRAINT "bases_folder_id_fkey"
      FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "bases_folder_id_idx" ON "bases" ("folder_id");
