-- AlterTable
ALTER TABLE "app_settings" ALTER COLUMN "platformName" SET DEFAULT 'LogCard';

-- Update default platform name if still using legacy brand
UPDATE "app_settings"
SET "platformName" = 'LogCard'
WHERE "platformName" = 'Support Connecté';
