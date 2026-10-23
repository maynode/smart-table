-- AlterTable
ALTER TABLE "workspace_members" ADD COLUMN "pinned_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "workspace_members_user_id_pinned_at_idx" ON "workspace_members"("user_id", "pinned_at");
