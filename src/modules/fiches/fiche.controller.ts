import { asyncHandler } from "../../lib/asyncHandler";
import { ProductionService } from "../production/production.service";
import { SectionStickerService } from "../production/section-stickers.service";
import { FichePurchasesService } from "./services/fiche-purchases.service";
import { FicheService } from "./services/fiches.service";
import {
  PassageService,
  type PassageSource,
} from "./services/passages.service";
import { RappelService } from "./services/rappels.service";

export const FicheController = {
  createPublicRappel: asyncHandler(async (req, res) => {
    const result = await RappelService.createPublic(
      String(req.params.slug),
      req.body
    );
    res.status(201).json({ ok: true, demande: result });
  }),

  listAllRappels: asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const ficheId =
      req.query.ficheId !== undefined ? Number(req.query.ficheId) : undefined;
    const statut =
      req.query.statut === "NOUVELLE" || req.query.statut === "TRAITEE"
        ? req.query.statut
        : undefined;
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    res.json({
      rappels: await RappelService.listForUser(req.user!, page, limit, {
        ficheId,
        statut,
        search,
      }),
    });
  }),

  exportRappelsCsv: asyncHandler(async (req, res) => {
    const ficheId =
      req.query.ficheId !== undefined ? Number(req.query.ficheId) : undefined;
    const statut =
      req.query.statut === "NOUVELLE" || req.query.statut === "TRAITEE"
        ? req.query.statut
        : undefined;
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    const csv = await RappelService.exportCsvForUser(req.user!, {
      ficheId,
      statut,
      search,
    });
    const dateTag = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="prospects-${dateTag}.csv"`
    );
    res.send(csv);
  }),

  updateRappelStatus: asyncHandler(async (req, res) => {
    res.json({
      demande: await RappelService.updateStatus(
        req.user!,
        Number(req.params.rappelId),
        req.body.statut
      ),
    });
  }),

  deleteRappel: asyncHandler(async (req, res) => {
    res.json(
      await RappelService.remove(req.user!, Number(req.params.rappelId))
    );
  }),

  totalFiches: asyncHandler(async (req, res) => {
    const status = await FicheService.creationStatus(req.user!);
    res.json({
      isLimitReached: status.freeSlots === 0,
      ...status,
    });
  }),

  quotePurchase: asyncHandler(async (req, res) => {
    res.json({
      quote: await FichePurchasesService.quote(req.user!, req.body),
    });
  }),

  createPurchase: asyncHandler(async (req, res) => {
    res.status(201).json({
      ...(await FichePurchasesService.create(req.user!, req.body)),
    });
  }),

  confirmPurchase: asyncHandler(async (req, res) => {
    res.json({
      ...(await FichePurchasesService.confirmSimulated(
        req.user!,
        Number(req.params.purchaseId)
      )),
    });
  }),

  listRappels: asyncHandler(async (req, res) => {
    res.json({
      rappels: await RappelService.listForFiche(
        req.user!,
        Number(req.params.id)
      ),
    });
  }),

  listSectionStickers: asyncHandler(async (req, res) => {
    res.json(await SectionStickerService.listForFiche(req.user!, Number(req.params.id)));
  }),

  createSectionSticker: asyncHandler(async (req, res) => {
    res.status(201).json(await SectionStickerService.create(req.user!, Number(req.params.id), req.body));
  }),

  getCardRequest: asyncHandler(async (req, res) => {
    res.json(
      await ProductionService.getClientCardRequest(
        req.user!,
        Number(req.params.id)
      )
    );
  }),

  createCardRequest: asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await ProductionService.requestClientCarte(
          req.user!,
          Number(req.params.id),
          req.body
        )
      );
  }),

  recordPublicPassage: asyncHandler(async (req, res) => {
    const source = String(req.body.source).toUpperCase() as PassageSource;
    const result = await PassageService.record(
      String(req.params.slug),
      source,
      String(req.body.idempotencyKey),
      req.user
    );
    res.status(result.recorded ? 201 : 200).json({ ok: true, ...result });
  }),

  getPassageStats: asyncHandler(async (req, res) => {
    const result = await PassageService.stats(
      req.user!,
      Number(req.params.id),
      {
        granularity: req.query.granularity === "day" ? "day" : "month",
        ...(typeof req.query.date === "string" ? { date: req.query.date } : {}),
        ...(typeof req.query.month === "string"
          ? { month: req.query.month }
          : {}),
      }
    );
    res.json({ stats: result });
  }),

  getPublicFiche: asyncHandler(async (req, res) => {
    res.json({
      fiche: await FicheService.getPublicFiche(
        String(req.params.slug),
        req.user
      ),
    });
  }),

  listFiches: asyncHandler(async (req, res) => {
    res.json({ fiches: await FicheService.listFiches(req.user!) });
  }),

  createFiche: asyncHandler(async (req, res) => {
    res
      .status(201)
      .json({ fiche: await FicheService.createFiche(req.user!, req.body) });
  }),

  getFiche: asyncHandler(async (req, res) => {
    res.json({
      fiche: await FicheService.getFiche(req.user!, Number(req.params.id)),
    });
  }),

  publishFiche: asyncHandler(async (req, res) => {
    res.json({
      fiche: await FicheService.publishFiche(req.user!, Number(req.params.id)),
    });
  }),

  updateFiche: asyncHandler(async (req, res) => {
    res.json({
      fiche: await FicheService.updateFiche(
        req.user!,
        Number(req.params.id),
        req.body
      ),
    });
  }),

  deleteFiche: asyncHandler(async (req, res) => {
    res.json({
      fiche: await FicheService.deleteFiche(req.user!, Number(req.params.id)),
    });
  }),

  setFicheDraft: asyncHandler(async (req, res) => {
    res.json({
      fiche: await FicheService.setFicheDraft(req.user!, Number(req.params.id)),
    });
  }),
};
