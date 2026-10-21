-- WeCom identity mapping for OAuth login (Task 25).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "wecom_user_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_wecom_user_id_key"
  ON "users" ("wecom_user_id");
