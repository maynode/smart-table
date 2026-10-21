-- Public read-only sheet links with optional password/expiry (Task 21).

CREATE TABLE IF NOT EXISTS "public_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sheet_id" uuid NOT NULL,
  "token" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "password_hash" text,
  "expires_at" timestamptz(6),
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "public_views_sheet_id_fkey"
    FOREIGN KEY ("sheet_id") REFERENCES "sheets"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "public_views_sheet_id_idx" ON "public_views" ("sheet_id");
