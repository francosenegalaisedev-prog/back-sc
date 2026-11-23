import { z } from "zod";

// ───────── Stickers « par section » ─────────
// Seules ces 7 sections peuvent avoir un sticker dédié (/s/:slug/:section), généré par l'administration.
export const ALLOWED_STICKER_SECTIONS = [
  "reseaux",
  "catalogue",
  "galerie",
  "rappel",
  "avis",
  "menu",
  "biens",
] as const;

export type AllowedStickerSection = (typeof ALLOWED_STICKER_SECTIONS)[number];

export const sectionKey = z.enum(ALLOWED_STICKER_SECTIONS, {
  message: "Section non autorisée pour un sticker.",
});

/** Génération directe par l'administration d'un sticker actif pour une section d'une fiche. */
export const adminCreateSectionStickerSchema = z
  .object({
    ficheId: z.number().int().positive(),
    section: sectionKey,
  })
  .strict();

const statutLower = z.enum(["active", "desactivee"]);

/** Activation / désactivation par l'administration. */
export const patchSectionStickerSchema = z
  .object({ statut: statutLower })
  .strict();

export const listSectionStickersQuery = z.object({
  statut: statutLower.optional(),
  ficheId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type AdminCreateSectionStickerInput = z.infer<
  typeof adminCreateSectionStickerSchema
>;
export type PatchSectionStickerInput = z.infer<typeof patchSectionStickerSchema>;
export type ListSectionStickersQuery = z.infer<typeof listSectionStickersQuery>;
