-- CreateTable
CREATE TABLE "workspace_invites" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'editor',
    "invited_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_invites_account_idx" ON "workspace_invites"("account");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invites_workspace_id_account_key" ON "workspace_invites"("workspace_id", "account");

-- AddForeignKey
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
