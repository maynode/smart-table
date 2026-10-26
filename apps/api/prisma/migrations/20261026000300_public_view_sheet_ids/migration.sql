-- Public view content scope: which sheets are exposed (default host sheet only for legacy rows).

ALTER TABLE "public_views"
  ADD COLUMN IF NOT EXISTS "sheet_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
