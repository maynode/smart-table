-- API keys, webhook subscriptions and delivery attempts/dead letters (Task 22).

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "scopes" jsonb NOT NULL DEFAULT '["read","write"]',
  "created_by" uuid,
  "last_used_at" timestamptz(6),
  "revoked_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "api_keys_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "api_keys_workspace_id_idx" ON "api_keys" ("workspace_id");

CREATE TABLE IF NOT EXISTS "webhooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "url" text NOT NULL,
  "secret" text NOT NULL,
  "events" jsonb NOT NULL DEFAULT '["record.created","record.updated","record.deleted"]',
  "active" boolean NOT NULL DEFAULT true,
  "created_by" uuid,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "webhooks_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "webhooks_workspace_id_idx" ON "webhooks" ("workspace_id");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "webhook_id" uuid NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "response_status" integer,
  "error" text NOT NULL DEFAULT '',
  "next_retry_at" timestamptz(6),
  "delivered_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "webhook_deliveries_webhook_id_fkey"
    FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_created_at_idx"
  ON "webhook_deliveries" ("webhook_id", "created_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_status_next_retry_at_idx"
  ON "webhook_deliveries" ("status", "next_retry_at");
