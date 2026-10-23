-- AlterTable
ALTER TABLE "bases" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Backfill stable order by created_at within each workspace
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at ASC) - 1 AS rn
  FROM "bases"
)
UPDATE "bases" AS b
SET "sort_order" = ranked.rn
FROM ranked
WHERE b.id = ranked.id;

-- DropIndex
DROP INDEX IF EXISTS "bases_workspace_id_idx";

-- CreateIndex
CREATE INDEX "bases_workspace_id_sort_order_idx" ON "bases"("workspace_id", "sort_order");
