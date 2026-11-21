-- CreateEnum
CREATE TYPE "DemandeRappelSource" AS ENUM ('PUBLIC', 'MANUEL', 'SCAN');

-- AlterTable
ALTER TABLE "DemandeRappel"
  ALTER COLUMN "nom" DROP NOT NULL,
  ALTER COLUMN "telephone" DROP NOT NULL,
  ADD COLUMN "source" "DemandeRappelSource" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "photoUrl" TEXT,
  ADD COLUMN "noteTexte" TEXT,
  ADD COLUMN "noteAudioUrl" TEXT;
