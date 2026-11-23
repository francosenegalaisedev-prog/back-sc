-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedBy" TEXT,
ADD COLUMN     "deletionScheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "account_deletion_logs" (
    "id" SERIAL NOT NULL,
    "targetUserId" INTEGER NOT NULL,
    "targetEmailHash" TEXT NOT NULL,
    "targetRole" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "initiatedBy" TEXT NOT NULL,
    "executedBy" TEXT NOT NULL,
    "actorAdminId" INTEGER,
    "actorAdminEmail" TEXT,
    "reason" TEXT,
    "fichesDeletedCount" INTEGER NOT NULL DEFAULT 0,
    "paymentsPreservedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_deletion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_deletion_logs_createdAt_idx" ON "account_deletion_logs"("createdAt");

-- CreateIndex
CREATE INDEX "account_deletion_logs_targetUserId_createdAt_idx" ON "account_deletion_logs"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "account_deletion_logs_action_createdAt_idx" ON "account_deletion_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "users_deletionScheduledAt_idx" ON "users"("deletionScheduledAt");
