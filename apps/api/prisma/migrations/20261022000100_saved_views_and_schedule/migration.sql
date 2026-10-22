-- Saved named views (persist filter/sort/group/row-height/color query)
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_views_sheet_id_name_key" ON "saved_views"("sheet_id", "name");
CREATE INDEX "saved_views_sheet_id_idx" ON "saved_views"("sheet_id");

ALTER TABLE "saved_views"
    ADD CONSTRAINT "saved_views_sheet_id_fkey"
    FOREIGN KEY ("sheet_id") REFERENCES "sheets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Real scheduled automation execution
ALTER TABLE "automations"
    ADD COLUMN "last_run_at" TIMESTAMPTZ(6),
    ADD COLUMN "next_run_at" TIMESTAMPTZ(6);

CREATE INDEX "automations_next_run_at_idx" ON "automations"("next_run_at");

-- WeCom appchat id for group-chat steps (nullable in local mode)
ALTER TABLE "group_chats" ADD COLUMN "wecom_chat_id" TEXT;
CREATE UNIQUE INDEX "group_chats_wecom_chat_id_key" ON "group_chats"("wecom_chat_id");
