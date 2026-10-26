-- Public view scope: form result sheets, dashboards, analysis reports.

ALTER TABLE "public_views"
  ADD COLUMN IF NOT EXISTS "form_sheet_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "public_views"
  ADD COLUMN IF NOT EXISTS "dashboard_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "public_views"
  ADD COLUMN IF NOT EXISTS "analysis_report_ids" jsonb NOT NULL DEFAULT '[]'::jsonb;
