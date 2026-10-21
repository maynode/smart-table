-- Queue-mode submissions need a durable result for HTTP polling.
ALTER TABLE "form_submissions" ADD COLUMN "result_html" TEXT;
ALTER TABLE "form_submissions" ADD COLUMN "step_outputs" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "form_submissions" ADD COLUMN "error" TEXT;
