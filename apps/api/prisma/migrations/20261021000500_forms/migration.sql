-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL,
    "base_id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cover_url" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "share" JSONB NOT NULL DEFAULT '{}',
    "share_token" TEXT NOT NULL,
    "success_template" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "record_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "cells" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forms_share_token_key" ON "forms"("share_token");

-- CreateIndex
CREATE INDEX "forms_base_id_idx" ON "forms"("base_id");

-- CreateIndex
CREATE INDEX "forms_sheet_id_idx" ON "forms"("sheet_id");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_created_at_idx" ON "form_submissions"("form_id", "created_at");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_base_id_fkey" FOREIGN KEY ("base_id") REFERENCES "bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
