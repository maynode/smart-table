-- Durable delay resume: waiting runs store resume_at + opaque resume_context.
ALTER TABLE "automation_runs"
  ADD COLUMN IF NOT EXISTS "resume_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "resume_context" JSONB,
  ADD COLUMN IF NOT EXISTS "parent_run_id" UUID;

CREATE INDEX IF NOT EXISTS "automation_runs_status_resume_at_idx"
  ON "automation_runs"("status", "resume_at");
