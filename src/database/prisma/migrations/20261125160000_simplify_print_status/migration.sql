-- CreateEnum
CREATE TYPE "PrintStatus_new" AS ENUM ('ENVOYEE', 'TRAITEE', 'LIVREE');

-- AlterTable
ALTER TABLE "print_jobs" ALTER COLUMN "statut" DROP DEFAULT;
ALTER TABLE "print_jobs"
  ALTER COLUMN "statut" TYPE "PrintStatus_new"
  USING (
    CASE "statut"::text
      WHEN 'A_IMPRIMER' THEN 'ENVOYEE'::"PrintStatus_new"
      WHEN 'LIVREE' THEN 'LIVREE'::"PrintStatus_new"
      ELSE 'TRAITEE'::"PrintStatus_new"
    END
  );

-- DropEnum & Rename
DROP TYPE "PrintStatus";
ALTER TYPE "PrintStatus_new" RENAME TO "PrintStatus";

-- Restore default
ALTER TABLE "print_jobs" ALTER COLUMN "statut" SET DEFAULT 'ENVOYEE';
