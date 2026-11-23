import type { SectionStickerStatus } from "../../database/prisma/generated/prisma/client";
import { Prisma } from "../../database/prisma/generated/prisma/client";
import { prisma } from "../../database/prisma/prisma-client";
import { env } from "../../config/env";
import { conflict, notFound, unprocessable } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { sendSectionStickerActivatedEmail } from "../../lib/mailer";
import type { AuthUser } from "../../types/user";
import {
  ALLOWED_STICKER_SECTIONS,
  type AdminCreateSectionStickerInput,
  type ListSectionStickersQuery,
  type PatchSectionStickerInput,
} from "./section-stickers.schemas";

/*
  Stickers « par section » : seul l'administrateur génère, active et désactive les stickers
  pour une fiche (dans « Aperçu et stickers par section »).
  Le client voit en lecture seule ses stickers actifs (lien /s/:slug/:section et QR code).
  L'état de la fiche conditionne celui du sticker : si la fiche est suspendue, brouillon ou expirée,
  aucun sticker de section n'est servi publiquement.
*/
const ALLOWED_SET = new Set<string>(ALLOWED_STICKER_SECTIONS);

const SECTION_LABELS: Record<string, string> = {
  reseaux: "Réseaux sociaux",
  catalogue: "Produits & prestations",
  galerie: "Galerie",
  rappel: "Échangez contact",
  avis: "Avis Google",
  menu: "Menu interactif",
  biens: "Biens immobiliers",
};

const lower = (s: SectionStickerStatus) =>
  s.toLowerCase() as "active" | "desactivee";
const upper = (s: string) => s.toUpperCase() as SectionStickerStatus;

type Row = Prisma.SectionStickerRequestGetPayload<object>;

const clientDto = (r: Row) => ({
  id: r.id,
  section: r.section,
  statut: lower(r.statut),
  createdAt: r.createdAt,
  activatedAt: r.activatedAt,
});

const ADMIN_INCLUDE = {
  fiche: {
    select: {
      id: true,
      slug: true,
      prenom: true,
      nom: true,
      entreprise: true,
      statut: true,
    },
  },
  user: { select: { id: true, nom: true, email: true } },
} as const;
type AdminRow = Prisma.SectionStickerRequestGetPayload<{
  include: typeof ADMIN_INCLUDE;
}>;

const adminDto = (r: AdminRow) => ({
  ...clientDto(r),
  updatedAt: r.updatedAt,
  fiche: r.fiche,
  client: r.user,
});

const TRANSITIONS: Record<SectionStickerStatus, SectionStickerStatus[]> = {
  ACTIVE: ["DESACTIVEE"],
  DESACTIVEE: ["ACTIVE"],
};

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const abonnementValable = (now: Date): Prisma.SubscriptionWhereInput => ({
  status: "ACTIVE",
  OR: [{ endsAt: null }, { endsAt: { gt: now } }],
});

const notifyActivated = async (row: AdminRow) => {
  const to = row.user?.email;
  if (!to) return;
  const ficheName =
    row.fiche.entreprise?.trim() ||
    [row.fiche.prenom, row.fiche.nom].filter(Boolean).join(" ").trim() ||
    row.fiche.slug;
  const base = env.PUBLIC_SITE_URL.replace(/\/$/, "");
  const stickerUrl = `${base}/s/${encodeURIComponent(row.fiche.slug)}/${encodeURIComponent(row.section)}`;
  try {
    await sendSectionStickerActivatedEmail({
      to,
      ownerName: row.user?.nom,
      ficheName,
      sectionLabel: SECTION_LABELS[row.section] ?? row.section,
      stickerUrl,
    });
  } catch (error) {
    logger.warn("Section sticker activation email failed", {
      stickerId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const SectionStickerService = {
  /** Stickers par section d'une fiche (lecture seule côté client, ou administrateur). */
  async listForFiche(user: AuthUser, ficheId: number) {
    const fiche = await prisma.fiche.findFirst({
      where:
        user.role === "ADMIN"
          ? { id: ficheId }
          : { id: ficheId, userId: user.id },
      select: { id: true },
    });
    if (!fiche) throw notFound("Fiche introuvable");
    const rows = await prisma.sectionStickerRequest.findMany({
      where: {
        ficheId,
        section: { in: [...ALLOWED_STICKER_SECTIONS] },
        ...(user.role !== "ADMIN" ? { statut: "ACTIVE" } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { demandes: rows.map(clientDto) };
  },

  /** L'administration génère et active directement un sticker pour une section autorisée d'une fiche. */
  async adminGenerate(input: AdminCreateSectionStickerInput) {
    if (!ALLOWED_SET.has(input.section)) {
      throw unprocessable(
        "SECTION_NON_AUTORISEE",
        "Cette section ne peut pas recevoir de sticker.",
      );
    }

    const fiche = await prisma.fiche.findUnique({
      where: { id: input.ficheId },
      select: {
        id: true,
        userId: true,
        statut: true,
        subscriptions: {
          where: abonnementValable(new Date()),
          orderBy: { startsAt: "desc" },
          take: 1,
          select: { plan: { select: { type: true } } },
        },
      },
    });
    if (!fiche) throw notFound("Fiche introuvable");
    if (fiche.statut !== "ACTIVE") {
      throw unprocessable(
        "FICHE_NON_PUBLIEE",
        "La fiche doit être active pour générer un sticker par section.",
      );
    }
    const plan = fiche.subscriptions[0]?.plan.type;
    if (plan !== "PRO" && plan !== "SIGNATURE") {
      throw unprocessable(
        "FORMULE_INSUFFISANTE",
        "Les stickers par section sont réservés aux formules Pro et Signature avec un abonnement actif.",
      );
    }

    const existing = await prisma.sectionStickerRequest.findFirst({
      where: { ficheId: input.ficheId, section: input.section },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    if (existing?.statut === "ACTIVE") {
      throw conflict(
        "STICKER_DEJA_ACTIF",
        "Un sticker actif existe déjà pour cette section.",
      );
    }

    let row: AdminRow;
    try {
      if (existing) {
        row = await prisma.sectionStickerRequest.update({
          where: { id: existing.id },
          data: {
            statut: "ACTIVE",
            activatedAt: new Date(),
            userId: fiche.userId,
          },
          include: ADMIN_INCLUDE,
        });
      } else {
        row = await prisma.sectionStickerRequest.create({
          data: {
            ficheId: input.ficheId,
            userId: fiche.userId,
            section: input.section,
            statut: "ACTIVE",
            activatedAt: new Date(),
          },
          include: ADMIN_INCLUDE,
        });
      }
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw conflict(
          "STICKER_DEJA_ACTIF",
          "Un sticker actif existe déjà pour cette section.",
        );
      }
      throw e;
    }

    await notifyActivated(row);
    return { demande: adminDto(row) };
  },

  /** Tous les stickers par section (administration), les plus récents d'abord. */
  async adminList(query: ListSectionStickersQuery) {
    const rows = await prisma.sectionStickerRequest.findMany({
      where: {
        section: { in: [...ALLOWED_STICKER_SECTIONS] },
        ...(query.statut && { statut: upper(query.statut) }),
        ...(query.ficheId && { ficheId: query.ficheId }),
      },
      include: ADMIN_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
    });
    return { demandes: rows.map(adminDto) };
  },

  /** L'administration active ou désactive un sticker de section. */
  async adminSetStatus(id: number, input: PatchSectionStickerInput) {
    const next = upper(input.statut);
    const current = await prisma.sectionStickerRequest.findUnique({
      where: { id },
      select: { statut: true },
    });
    if (!current) throw notFound("Sticker de section introuvable");
    if (!TRANSITIONS[current.statut].includes(next)) {
      throw conflict(
        "TRANSITION_INVALIDE",
        `Un sticker « ${lower(current.statut)} » ne peut pas passer à « ${lower(next)} ».`,
      );
    }
    try {
      const updated = await prisma.sectionStickerRequest.update({
        where: { id },
        data: {
          statut: next,
          ...(next === "ACTIVE" && { activatedAt: new Date() }),
        },
        include: ADMIN_INCLUDE,
      });
      if (next === "ACTIVE") await notifyActivated(updated);
      return { demande: adminDto(updated) };
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw conflict(
          "STICKER_DEJA_ACTIF",
          "Un autre sticker actif existe déjà pour cette section de la fiche.",
        );
      }
      throw e;
    }
  },
};
