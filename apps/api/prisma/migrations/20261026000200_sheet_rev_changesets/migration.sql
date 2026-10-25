-- Pad-level sheet_rev + changeset log for realtime collab

ALTER TABLE "sheets" ADD COLUMN IF NOT EXISTS "sheet_rev" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "sheet_changesets" (
    "id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "rev" INTEGER NOT NULL,
    "author_id" UUID,
    "commit_id" TEXT NOT NULL,
    "mutations" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_changesets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sheet_changesets_sheet_id_rev_key" ON "sheet_changesets"("sheet_id", "rev");
CREATE INDEX IF NOT EXISTS "sheet_changesets_sheet_id_rev_idx" ON "sheet_changesets"("sheet_id", "rev");

ALTER TABLE "sheet_changesets"
  DROP CONSTRAINT IF EXISTS "sheet_changesets_sheet_id_fkey";
ALTER TABLE "sheet_changesets"
  ADD CONSTRAINT "sheet_changesets_sheet_id_fkey"
  FOREIGN KEY ("sheet_id") REFERENCES "sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
