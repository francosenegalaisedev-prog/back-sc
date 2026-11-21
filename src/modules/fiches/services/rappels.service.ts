import type {
  DemandeRappelSource,
  DemandeRappelStatus,
} from "../../../database/prisma/generated/prisma/client";
import { prisma } from "../../../database/prisma/prisma-client";
import {
  HttpError,
  badRequest,
  forbidden,
  notFound,
} from "../../../lib/httpError";
import { logger } from "../../../lib/logger";
import { sendCallbackRequestEmail } from "../../../lib/mailer";
import {
  isValidPhone,
  normalizePhone,
  PHONE_ERROR_MESSAGE,
} from "../../../lib/phone";
import type { AuthUser } from "../../../types/user";
import { ProspectMediaService } from "../../media/prospect-media.service";
import { getPublicSubscription } from "./fiche-public-access";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const EXPORT_MAX_ROWS = 5000;

const csvCell = (value: string | null | undefined) => {
  const raw = value ?? "";
  // Protection contre l'injection de formules CSV dans Excel/LibreOffice
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};

const formatProspectMedia = <
  T extends { photoUrl?: string | null; noteAudioUrl?: string | null },
>(
  item: T
): T => ({
  ...item,
  photoUrl: ProspectMediaService.toAbsolute(item.photoUrl),
  noteAudioUrl: ProspectMediaService.toAbsolute(item.noteAudioUrl),
});

const SOURCE_LABELS: Record<DemandeRappelSource, string> = {
  PUBLIC: "Fiche publique",
  MANUEL: "Ajout manuel",
  SCAN: "Scan carte",
};

const buildUserRappelWhere = (userId: number, filters: RappelListFilters = {}) => {
  const search = filters.search?.trim();
  return {
    fiche: { userId },
    ...(filters.ficheId ? { ficheId: filters.ficheId } : {}),
    ...(filters.statut ? { statut: filters.statut } : {}),
    ...(search
      ? {
          OR: [
            { nom: { contains: search, mode: "insensitive" as const } },
            { telephone: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
            { societe: { contains: search, mode: "insensitive" as const } },
            { noteTexte: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
};

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
        "Le formulaire « Échangez contact » n'est pas activé pour cette fiche."
      );
    }
    if (
      fiche.onglets.length > 0 &&
      !fiche.onglets.some(onglet => onglet.visible)
    ) {
      throw forbidden(
        "FORMULAIRE_INDISPONIBLE",
        "Le formulaire « Échangez contact » n'est pas activé pour cette fiche."
      );
    }

    const nom = input.nom.trim();
    const telephone = normalizePhone(input.telephone.trim());
    const email = input.email?.trim() || null;
    const societe = input.societe?.trim() || null;
    if (nom.length < 2) {
      throw badRequest("NOM_INVALIDE", "Veuillez saisir un nom valide.");
    }
    if (!isValidPhone(input.telephone)) {
      throw badRequest("TELEPHONE_INVALIDE", PHONE_ERROR_MESSAGE);
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
        "Vos coordonnées ont déjà été envoyées récemment avec ce numéro."
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
          source: true,
          nom: true,
          telephone: true,
          email: true,
          societe: true,
          photoUrl: true,
          noteTexte: true,
          noteAudioUrl: true,
          statut: true,
          traiteeAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return {
      ficheId,
      total,
      nouvellesCount,
      demandes: demandes.map(formatProspectMedia),
    };
  },

  async listForUser(
    user: AuthUser,
    page: number,
    limit: number,
    filters: RappelListFilters = {}
  ) {
    const baseWhere = { fiche: { userId: user.id } };
    const where = buildUserRappelWhere(user.id, filters);

    const [total, nouvellesCount, demandes] = await prisma.$transaction([
      prisma.demandeRappel.count({ where }),
      prisma.demandeRappel.count({
        where: { ...baseWhere, statut: "NOUVELLE" },
      }),
      prisma.demandeRappel.findMany({
        where,
        select: {
          id: true,
          source: true,
          nom: true,
          telephone: true,
          email: true,
          societe: true,
          photoUrl: true,
          noteTexte: true,
          noteAudioUrl: true,
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
      demandes: demandes.map(formatProspectMedia),
      nouvellesCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async createForUser(
    user: AuthUser,
    input: {
      ficheId: number;
      source: "MANUEL" | "SCAN";
      nom?: string;
      telephone?: string;
      email?: string;
      societe?: string;
      photoUrl?: string;
      noteTexte?: string;
      noteAudioUrl?: string;
    }
  ) {
    const fiche = await prisma.fiche.findUnique({
      where: { id: input.ficheId },
      select: { id: true, userId: true },
    });
    if (!fiche || (user.role !== "ADMIN" && fiche.userId !== user.id)) {
      throw notFound("Fiche introuvable");
    }

    const nom = input.nom?.trim() || null;
    const rawTel = input.telephone?.trim() || "";
    const telephone = rawTel ? normalizePhone(rawTel) : null;
    const email = input.email?.trim() || null;
    const societe = input.societe?.trim() || null;
    const noteTexte = input.noteTexte?.trim() || null;

    if (input.source === "MANUEL") {
      if (!nom || nom.length < 2) {
        throw badRequest(
          "NOM_INVALIDE",
          "Veuillez saisir un nom (2 caractères minimum)."
        );
      }
      if (!rawTel || !isValidPhone(rawTel)) {
        throw badRequest("TELEPHONE_INVALIDE", PHONE_ERROR_MESSAGE);
      }
    }

    const photoRef = input.photoUrl
      ? ProspectMediaService.extractRef(input.photoUrl)
      : null;
    if (input.photoUrl && !photoRef) {
      throw badRequest(
        "PHOTO_INVALIDE",
        "La photo de carte doit provenir du téléversement sécurisé."
      );
    }
    if (input.source === "SCAN" && !photoRef) {
      throw badRequest(
        "PHOTO_REQUISE",
        "Veuillez prendre ou sélectionner une photo de la carte."
      );
    }

    const audioRef = input.noteAudioUrl
      ? ProspectMediaService.extractRef(input.noteAudioUrl)
      : null;
    if (input.noteAudioUrl && !audioRef) {
      throw badRequest(
        "AUDIO_INVALIDE",
        "La note vocale doit provenir du téléversement sécurisé."
      );
    }
    if (noteTexte && audioRef) {
      throw badRequest(
        "NOTE_EXCLUSIVE",
        "Choisissez soit une note écrite, soit une note vocale."
      );
    }

    const created = await prisma.demandeRappel.create({
      data: {
        ficheId: fiche.id,
        source: input.source,
        nom,
        telephone,
        email,
        societe,
        photoUrl: photoRef,
        noteTexte,
        noteAudioUrl: audioRef,
      },
      select: {
        id: true,
        ficheId: true,
        source: true,
        nom: true,
        telephone: true,
        email: true,
        societe: true,
        photoUrl: true,
        noteTexte: true,
        noteAudioUrl: true,
        statut: true,
        traiteeAt: true,
        createdAt: true,
      },
    });
    return formatProspectMedia(created);
  },

  async updateForUser(
    user: AuthUser,
    rappelId: number,
    input: {
      nom: string;
      telephone: string;
      email?: string;
      societe?: string;
      noteTexte?: string;
      deletePhoto?: boolean;
    }
  ) {
    const existing = await prisma.demandeRappel.findUnique({
      where: { id: rappelId },
      select: {
        id: true,
        source: true,
        photoUrl: true,
        fiche: { select: { userId: true } },
      },
    });
    if (
      !existing ||
      (user.role !== "ADMIN" && existing.fiche.userId !== user.id)
    ) {
      throw notFound("Prospect introuvable");
    }

    const nom = input.nom.trim();
    const telephone = normalizePhone(input.telephone.trim());
    const email = input.email?.trim() || null;
    const societe = input.societe?.trim() || null;

    const updated = await prisma.demandeRappel.update({
      where: { id: rappelId },
      data: {
        nom,
        telephone,
        email,
        societe,
        ...(input.noteTexte !== undefined
          ? { noteTexte: input.noteTexte.trim() || null }
          : {}),
        ...(existing.source === "SCAN" ? { source: "MANUEL" } : {}),
        ...(input.deletePhoto ? { photoUrl: null } : {}),
      },
      select: {
        id: true,
        ficheId: true,
        source: true,
        nom: true,
        telephone: true,
        email: true,
        societe: true,
        photoUrl: true,
        noteTexte: true,
        noteAudioUrl: true,
        statut: true,
        traiteeAt: true,
        createdAt: true,
      },
    });

    if (input.deletePhoto && existing.photoUrl) {
      void ProspectMediaService.deleteRef(existing.photoUrl);
    }

    return formatProspectMedia(updated);
  },

  async deletePhotoForUser(user: AuthUser, rappelId: number) {
    const existing = await prisma.demandeRappel.findUnique({
      where: { id: rappelId },
      select: {
        id: true,
        nom: true,
        telephone: true,
        photoUrl: true,
        fiche: { select: { userId: true } },
      },
    });
    if (
      !existing ||
      (user.role !== "ADMIN" && existing.fiche.userId !== user.id)
    ) {
      throw notFound("Prospect introuvable");
    }
    if (!existing.nom && !existing.telephone) {
      throw badRequest(
        "CONVERSION_REQUISE",
        "Saisissez d'abord les coordonnées manuellement avant de supprimer la photo."
      );
    }

    const updated = await prisma.demandeRappel.update({
      where: { id: rappelId },
      data: { photoUrl: null },
      select: {
        id: true,
        ficheId: true,
        source: true,
        nom: true,
        telephone: true,
        email: true,
        societe: true,
        photoUrl: true,
        noteTexte: true,
        noteAudioUrl: true,
        statut: true,
        traiteeAt: true,
        createdAt: true,
      },
    });

    if (existing.photoUrl) {
      void ProspectMediaService.deleteRef(existing.photoUrl);
    }

    return formatProspectMedia(updated);
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
      throw notFound("Prospect introuvable");
    }

    const updated = await prisma.demandeRappel.update({
      where: { id: rappelId },
      data: {
        statut,
        traiteeAt: statut === "TRAITEE" ? new Date() : null,
      },
      select: {
        id: true,
        ficheId: true,
        source: true,
        nom: true,
        telephone: true,
        email: true,
        societe: true,
        photoUrl: true,
        noteTexte: true,
        noteAudioUrl: true,
        statut: true,
        traiteeAt: true,
        createdAt: true,
      },
    });
    return formatProspectMedia(updated);
  },

  async remove(user: AuthUser, rappelId: number) {
    const existing = await prisma.demandeRappel.findUnique({
      where: { id: rappelId },
      select: {
        id: true,
        photoUrl: true,
        noteAudioUrl: true,
        fiche: { select: { userId: true } },
      },
    });
    if (
      !existing ||
      (user.role !== "ADMIN" && existing.fiche.userId !== user.id)
    ) {
      throw notFound("Prospect introuvable");
    }

    await prisma.demandeRappel.delete({ where: { id: rappelId } });
    if (existing.photoUrl) void ProspectMediaService.deleteRef(existing.photoUrl);
    if (existing.noteAudioUrl)
      void ProspectMediaService.deleteRef(existing.noteAudioUrl);
    return { deleted: true, id: rappelId };
  },

  async exportCsvForUser(user: AuthUser, filters: RappelListFilters = {}) {
    const where = buildUserRappelWhere(user.id, filters);
    const demandes = await prisma.demandeRappel.findMany({
      where,
      select: {
        source: true,
        nom: true,
        societe: true,
        telephone: true,
        email: true,
        noteTexte: true,
        statut: true,
        createdAt: true,
        fiche: { select: { slug: true, prenom: true, nom: true } },
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ROWS,
    });

    const header = [
      "Nom",
      "Société",
      "Téléphone",
      "E-mail",
      "Fiche",
      "Source",
      "Note",
      "Statut",
      "Date de réception",
    ]
      .map(csvCell)
      .join(";");

    const lines = demandes.map(d => {
      const ficheName =
        [d.fiche.prenom, d.fiche.nom].filter(Boolean).join(" ") || d.fiche.slug;
      const statutLabel = d.statut === "TRAITEE" ? "Traité" : "Nouveau";
      const sourceLabel = SOURCE_LABELS[d.source ?? "PUBLIC"] ?? "Fiche publique";
      const dateStr = new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(d.createdAt);
      return [
        d.nom ?? "",
        d.societe ?? "",
        d.telephone ?? "",
        d.email ?? "",
        ficheName,
        sourceLabel,
        d.noteTexte ?? "",
        statutLabel,
        dateStr,
      ]
        .map(csvCell)
        .join(";");
    });

    return `\uFEFF${[header, ...lines].join("\r\n")}\r\n`;
  },
};
