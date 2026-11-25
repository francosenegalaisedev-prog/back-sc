-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_fa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "two_fa_last_used_at" TIMESTAMP(3),
ADD COLUMN     "two_fa_recovery_codes" TEXT[],
ADD COLUMN     "two_fa_secret" TEXT;
