-- AlterTable
ALTER TABLE "users" ADD COLUMN "avatar_seed" TEXT NOT NULL DEFAULT '';

-- Backfill existing users with a deterministic seed from account
UPDATE "users"
SET "avatar_seed" = REPLACE("account", '_', '')
WHERE "avatar_seed" = '';
