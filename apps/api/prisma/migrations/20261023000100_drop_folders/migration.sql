-- Drop folders: bases hang directly under workspaces.

ALTER TABLE "bases" DROP CONSTRAINT IF EXISTS "bases_folder_id_fkey";

DROP INDEX IF EXISTS "bases_folder_id_idx";

ALTER TABLE "bases" DROP COLUMN IF EXISTS "folder_id";

DROP TABLE IF EXISTS "folders";
