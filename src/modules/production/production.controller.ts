import { asyncHandler } from "../../lib/asyncHandler";
import type { ListSectionStickersQuery, PatchSectionStickerInput } from "./section-stickers.schemas";
import { SectionStickerService } from "./section-stickers.service";
import type {
  CreateStickerInput,
  ListCartesQuery,
  ListStickersQuery,
  PatchCarteInput,
  PatchQrInput,
  PatchStickerInput,
} from "./production.schemas";
import { ProductionService } from "./production.service";

export const ProductionController = {
  summary: asyncHandler(async (_req, res) => {
    res.json(await ProductionService.summary());
  }),

  // ───── Cartes ─────
  listCartes: asyncHandler(async (req, res) => {
    res.json(
      await ProductionService.listCartes(
        req.query as unknown as ListCartesQuery
      )
    );
  }),
  updateCarte: asyncHandler(async (req, res) => {
    res.json(
      await ProductionService.updateCarte(
        Number(req.params.id),
        req.body as PatchCarteInput
      )
    );
  }),

  // ───── Stickers par section (demandes de devis des clients) ─────
  listSectionStickers: asyncHandler(async (req, res) => {
    res.json(await SectionStickerService.adminList(req.query as unknown as ListSectionStickersQuery));
  }),
  updateSectionSticker: asyncHandler(async (req, res) => {
    res.json(await SectionStickerService.adminSetStatus(Number(req.params.id), req.body as PatchSectionStickerInput));
  }),

  // ───── Stickers ─────
  listStickers: asyncHandler(async (req, res) => {
    res.json(
      await ProductionService.listStickers(
        req.query as unknown as ListStickersQuery
      )
    );
  }),
  createSticker: asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await ProductionService.createSticker(req.body as CreateStickerInput)
      );
  }),
  updateSticker: asyncHandler(async (req, res) => {
    res.json(
      await ProductionService.updateSticker(
        Number(req.params.id),
        req.body as PatchStickerInput
      )
    );
  }),

  // ───── QR dynamiques ─────
  listQr: asyncHandler(async (_req, res) => {
    res.json(await ProductionService.listQr());
  }),
  updateQr: asyncHandler(async (req, res) => {
    res.json(
      await ProductionService.updateQr(
        req.params.code as string,
        req.body as PatchQrInput
      )
    );
  }),

  // ───── Public : GET /q/:code ─────
  redirect: asyncHandler(async (req, res) => {
    const cible = await ProductionService.resoudre(
      req.params.code as string,
      req.get("user-agent") ?? ""
    );
    if (!cible) {
      res.status(404).type("text/plain").send("Ce lien n'est pas disponible.");
      return;
    }
    res.set("Cache-Control", "no-store"); // la cible peut changer à tout moment
    res.redirect(302, cible);
  }),
};
