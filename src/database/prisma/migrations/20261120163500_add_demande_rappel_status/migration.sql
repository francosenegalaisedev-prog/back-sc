-- CreateEnum
CREATE TYPE "DemandeRappelStatus" AS ENUM ('NOUVELLE', 'TRAITEE');

-- AlterTable
ALTER TABLE "DemandeRappel"
ADD COLUMN "statut" "DemandeRappelStatus" NOT NULL DEFAULT 'NOUVELLE',
ADD COLUMN "traiteeAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "DemandeRappel_ficheId_statut_createdAt_idx" ON "DemandeRappel"("ficheId", "statut", "createdAt");
