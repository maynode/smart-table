-- MessageCenter commitchanges idempotency + public form submit idempotency

CREATE TABLE "commit_ops" (
    "id" UUID NOT NULL,
    "client_op_id" TEXT NOT NULL,
    "sheet_id" UUID,
    "user_id" UUID,
    "op_type" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commit_ops_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commit_ops_client_op_id_key" ON "commit_ops"("client_op_id");
CREATE INDEX "commit_ops_sheet_id_created_at_idx" ON "commit_ops"("sheet_id", "created_at");

CREATE TABLE "form_submit_idempotency" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "form_id" UUID NOT NULL,
    "submission_id" UUID,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submit_idempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "form_submit_idempotency_idempotency_key_key" ON "form_submit_idempotency"("idempotency_key");
CREATE INDEX "form_submit_idempotency_form_id_idx" ON "form_submit_idempotency"("form_id");
