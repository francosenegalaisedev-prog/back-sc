-- Nettoyage du modèle section_sticker_requests :
-- Seul l'administrateur génère / active / désactive les stickers par section.
-- Suppression des colonnes inutiles (quantite, message) et des statuts obsolètes (DEMANDE, REFUSEE).

DROP INDEX IF EXISTS "section_sticker_requests_open_per_section";

DELETE FROM "section_sticker_requests" WHERE "statut" IN ('DEMANDE', 'REFUSEE');

ALTER TABLE "section_sticker_requests" DROP COLUMN IF EXISTS "quantite";
ALTER TABLE "section_sticker_requests" DROP COLUMN IF EXISTS "message";

CREATE TYPE "SectionStickerStatus_new" AS ENUM ('ACTIVE', 'DESACTIVEE');
ALTER TABLE "section_sticker_requests" ALTER COLUMN "statut" DROP DEFAULT;
ALTER TABLE "section_sticker_requests"
  ALTER COLUMN "statut" TYPE "SectionStickerStatus_new"
  USING ("statut"::text::"SectionStickerStatus_new");
ALTER TYPE "SectionStickerStatus" RENAME TO "SectionStickerStatus_old";
ALTER TYPE "SectionStickerStatus_new" RENAME TO "SectionStickerStatus";
DROP TYPE "SectionStickerStatus_old";
ALTER TABLE "section_sticker_requests" ALTER COLUMN "statut" SET DEFAULT 'ACTIVE';

CREATE UNIQUE INDEX "section_sticker_requests_active_per_section"
  ON "section_sticker_requests"("ficheId", "section")
  WHERE "statut" = 'ACTIVE';
