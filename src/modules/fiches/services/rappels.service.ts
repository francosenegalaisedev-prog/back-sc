import type { DemandeRappelStatus } from "../../../database/prisma/generated/prisma/client";
import { prisma } from "../../../database/prisma/prisma-client";
import {
  HttpError,
  badRequest,
  forbidden,
  notFound,
} from "../../../lib/httpError";
import { logger } from "../../../lib/logger";
import { sendCallbackRequestEmail } from "../../../lib/mailer";
import type { AuthUser } from "../../../types/user";
import { getPublicSubscription } from "./fiche-public-access";

const normalizePhone = (value: string) => value.replace(/[\s().-]/g, "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUPLICATE_WINDOW_MS = 10 * 60_000;

export type RappelListFilters = {
  ficheId?: number;
  statut?: DemandeRappelStatus;
  search?: string;
};

export const RappelService = {
  async createPublic(
    slug: string,
    input: {
      nom: string;
      telephone: string;
      email?: string;
      societe?: string;
      website?: string;
    }
  ) {
    // Champ honeypot anti-bot : un robot remplit le champ caché, on ignore sans écrire en base.
    if (input.website?.trim()) {
      return { id: 0, createdAt: new Date() };
    }

    const fiche = await prisma.fiche.findUnique({
      where: { slug },
      select: {
        id: true,
        statut: true,
        prenom: true,
        nom: true,
        entreprise: true,
        user: { select: { email: true, nom: true } },
        onglets: {
          where: { type: "RAPPEL" },
          select: { visible: true },
        },
      },
    });
    if (!fiche) {
      throw notFound("Cette fiche est indisponible");
    }

    const subscription = await getPublicSubscription(fiche.id, fiche.statut);
    if (!subscription) {
      throw notFound("Cette fiche est indisponible");
    }
    if (!subscription.plan.limits?.hasForm) {
      throw forbidden(
        "FORMULAIRE_INDISPONIBLE",
        "Le formulaire de rappel n'est pas activé pour cette fiche."
      );
    }
    if (
      fiche.onglets.length > 0 &&
      !fiche.onglets.some(onglet => onglet.visible)
    ) {
      throw forbidden(
        "FORMULAIRE_INDISPONIBLE",
        "Le formulaire de rappel n'est pas activé pour cette fiche."
      );
    }

    const nom = input.nom.trim();
    const telephone = normalizePhone(input.telephone.trim());
    const email = input.email?.trim() || null;
    const societe = input.societe?.trim() || null;
    if (nom.length < 2) {
      throw badRequest("NOM_INVALIDE", "Veuillez saisir un nom valide.");
    }
    if (!/^\+?[0-9]{7,15}$/.test(telephone)) {
      throw badRequest(
        "TELEPHONE_INVALIDE",
        "Veuillez saisir un numéro de téléphone valide."
      );
    }
    if (email && !EMAIL_RE.test(email)) {
      throw badRequest(
        "EMAIL_INVALIDE",
        "Veuillez saisir une adresse e-mail valide."
      );
    }

    const recentDuplicate = await prisma.demandeRappel.findFirst({
      where: {
        ficheId: fiche.id,
        telephone,
        createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recentDuplicate) {
      throw new HttpError(
        429,
        "DEMANDE_DEJA_ENVOYEE",
        "Une demande de rappel a déjà été envoyée récemment avec ce numéro."
      );
    }

    const demande = await prisma.demandeRappel.create({
      data: { ficheId: fiche.id, nom, telephone, email, societe },
      select: { id: true, statut: true, createdAt: true },
    });

    if (fiche.user?.email) {
      const ficheName =
        fiche.entreprise?.trim() ||
        `${fiche.prenom} ${fiche.nom}`.trim() ||
        slug;
      void sendCallbackRequestEmail({
        to: fiche.user.email,
        ownerName: fiche.user.nom,
        ficheName,
        visitorName: nom,
        visitorPhone: telephone,
        visitorEmail: email,
        visitorCompany: societe,
      }).catch(error => {
        logger.warn("Callback request notification email failed", {
          ficheId: fiche.id,
          rappelId: demande.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return demande;
  },

  async listForFiche(user: AuthUser, ficheId: number) {
    const fiche = await prisma.fiche.findUnique({
      where: { id: ficheId },
      select: { id: true, userId: true },
    });
    if (!fiche || (user.role !== "ADMIN" && fiche.userId !== user.id)) {
      throw notFound("Fiche introuvable");
    }

    const [total, nouvellesCount, demandes] = await prisma.$transaction([
      prisma.demandeRappel.count({ where: { ficheId } }),
      prisma.demandeRappel.count({ where: { ficheId, statut: "NOUVELLE" } }),
      prisma.demandeRappel.findMany({
        where: { ficheId },
        select: {
          id: true,
          nom: true,
          telephone: true,
          email: true,
          societe: true,
          statut: true,
          traiteeAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return { ficheId, total, nouvellesCount, demandes };
  },

  async listForUser(
    user: AuthUser,
    page: number,
    limit: number,
    filters: RappelListFilters = {}
  ) {
    const search = filters.search?.trim();
    const baseWhere = { fiche: { userId: user.id } };
    const where = {
      ...baseWhere,
      ...(filters.ficheId ? { ficheId: filters.ficheId } : {}),
      ...(filters.statut ? { statut: filters.statut } : {}),
      ...(search
        ? {
            OR: [
              { nom: { contains: search, mode: "insensitive" as const } },
              { telephone: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { societe: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [total, nouvellesCount, demandes] = await prisma.$transaction([
      prisma.demandeRappel.count({ where }),
      prisma.demandeRappel.count({
        where: { ...baseWhere, statut: "NOUVELLE" },
      }),
      prisma.demandeRappel.findMany({
        where,
        select: {
          id: true,
          nom: true,
          telephone: true,
          email: true,
          societe: true,
          statut: true,
          traiteeAt: true,
          createdAt: true,
          fiche: {
            select: { id: true, slug: true, prenom: true, nom: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      demandes,
      nouvellesCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async updateStatus(
    user: AuthUser,
    rappelId: number,
    statut: DemandeRappelStatus
  ) {
    const existing = await prisma.demandeRappel.findUnique({
      where: { id: rappelId },
      select: { id: true, fiche: { select: { userId: true } } },
    });
    if (
      !existing ||
      (user.role !== "ADMIN" && existing.fiche.userId !== user.id)
    ) {
      throw notFound("Demande de rappel introuvable");
    }

    return prisma.demandeRappel.update({
      where: { id: rappelId },
      data: {
        statut,
        traiteeAt: statut === "TRAITEE" ? new Date() : null,
      },
      select: {
        id: true,
        ficheId: true,
        nom: true,
        telephone: true,
        email: true,
        societe: true,
        statut: true,
        traiteeAt: true,
        createdAt: true,
      },
    });
  },

  async remove(user: AuthUser, rappelId: number) {
    const existing = await prisma.demandeRappel.findUnique({
      where: { id: rappelId },
      select: { id: true, fiche: { select: { userId: true } } },
    });
    if (
      !existing ||
      (user.role !== "ADMIN" && existing.fiche.userId !== user.id)
    ) {
      throw notFound("Demande de rappel introuvable");
    }

    await prisma.demandeRappel.delete({ where: { id: rappelId } });
    return { deleted: true, id: rappelId };
  },
};
