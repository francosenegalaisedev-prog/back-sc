import { createHash } from "node:crypto";
import { prisma } from "../../database/prisma/prisma-client";
import { verifyGoogleIdToken } from "../../lib/googleAuth";
import {
  badRequest,
  forbidden,
  notFound,
  unauthorized,
  unprocessable,
} from "../../lib/httpError";
import { signToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";
import {
  sendAccountDeletedByAdminEmail,
  sendAccountDeletionScheduledEmail,
} from "../../lib/mailer";
import { verifyPassword } from "../../lib/password";

export const ACCOUNT_DELETION_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DeletionInitiator = "USER" | "ADMIN";
export type DeletionExecutor = "USER" | "ADMIN" | "SYSTEM_CRON";
export type DeletionAction =
  | "REQUESTED"
  | "CANCELED"
  | "DEACTIVATED"
  | "REACTIVATED"
  | "PURGED";

/**
 * Empreinte irréversible de l'e-mail pour conserver une preuve de traçabilité
 * sans stocker d'adresse e-mail en clair après suppression définitive.
 */
export function hashEmailForAudit(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

export function computeDeletionScheduledAt(
  from: Date = new Date(),
  graceDays: number = ACCOUNT_DELETION_GRACE_DAYS
): Date {
  return new Date(from.getTime() + graceDays * DAY_MS);
}

/**
 * Demande de suppression par l'utilisateur connecté :
 * - Vérifie l'identité (mot de passe pour un compte classique, e-mail exact pour un compte Google sans mot de passe).
 * - Désactive le compte immédiatement et suspend ses fiches actives.
 * - Programme la suppression définitive à J+30 (délai de grâce).
 * - Enregistre la trace dans `account_deletion_logs`.
 */
export async function requestSelfDeletion(
  userId: number,
  input: { password?: string; confirmEmail?: string; reason?: string }
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("Compte introuvable");
  if (user.role === "ADMIN") {
    throw unprocessable(
      "AUTO_SUPPRESSION_ADMIN_INTERDITE",
      "Un administrateur ne peut pas supprimer son propre compte depuis cet espace."
    );
  }

  if (user.passwordHash) {
    if (!input.password) {
      throw unprocessable(
        "MOT_DE_PASSE_REQUIS",
        "Veuillez saisir votre mot de passe pour confirmer la suppression."
      );
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      throw unprocessable(
        "MOT_DE_PASSE_INCORRECT",
        "Le mot de passe saisi est incorrect."
      );
    }
  } else {
    const expected = user.email.trim().toLowerCase();
    const provided = (input.confirmEmail ?? "").trim().toLowerCase();
    if (!provided || provided !== expected) {
      throw unprocessable(
        "CONFIRMATION_INVALIDE",
        "Veuillez saisir votre adresse e-mail exacte pour confirmer la suppression."
      );
    }
  }

  const now = new Date();
  const scheduledAt = computeDeletionScheduledAt(now);
  const cleanReason = input.reason?.trim() || null;

  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        active: false,
        deletionRequestedAt: now,
        deletionScheduledAt: scheduledAt,
        deletionRequestedBy: "USER",
      },
    });

    await tx.fiche.updateMany({
      where: { userId: user.id, statut: "ACTIVE" },
      data: { statut: "SUSPENDUE" },
    });

    await tx.authToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });

    await tx.accountDeletionLog.create({
      data: {
        targetUserId: user.id,
        targetEmailHash: hashEmailForAudit(user.email),
        targetRole: user.role,
        action: "REQUESTED",
        initiatedBy: "USER",
        executedBy: "USER",
        reason: cleanReason,
        scheduledFor: scheduledAt,
      },
    });
  });

  logger.info("Account deletion scheduled by user", {
    userId: user.id,
    scheduledAt: scheduledAt.toISOString(),
  });

  // L'e-mail d'information ne doit pas bloquer la désactivation si le transport SMTP échoue.
  try {
    await sendAccountDeletionScheduledEmail({
      to: user.email,
      name: user.nom,
      scheduledAt,
      graceDays: ACCOUNT_DELETION_GRACE_DAYS,
    });
  } catch (error) {
    logger.warn("Account deletion confirmation email failed", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    deletionScheduledAt: scheduledAt.toISOString(),
    graceDays: ACCOUNT_DELETION_GRACE_DAYS,
  };
}

/**
 * Annule une suppression programmée par l'utilisateur pendant le délai de grâce (30 jours)
 * et reconnecte immédiatement l'utilisateur.
 */
export async function cancelSelfDeletion(input: {
  email?: string;
  password?: string;
  credential?: string;
}) {
  let user = null;

  if (input.credential) {
    const identity = await verifyGoogleIdToken(input.credential);
    user =
      (await prisma.user.findUnique({
        where: { googleId: identity.googleId },
      })) ??
      (await prisma.user.findUnique({
        where: { email: identity.email },
      }));
    if (!user) throw unauthorized("Identifiants invalides.");
  } else if (input.email && input.password) {
    user = await prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    const ok =
      user?.passwordHash != null &&
      (await verifyPassword(input.password, user.passwordHash));
    if (!user || !ok) {
      throw unauthorized("E-mail ou mot de passe incorrect.");
    }
  } else {
    throw badRequest(
      "IDENTIFIANTS_REQUIS",
      "Fournissez vos identifiants ou votre connexion Google pour annuler la suppression."
    );
  }

  if (
    user.active ||
    !user.deletionScheduledAt ||
    user.deletionRequestedBy !== "USER"
  ) {
    throw unprocessable(
      "AUCUNE_SUPPRESSION_EN_COURS",
      "Aucune demande de suppression annulable n’est en cours sur ce compte."
    );
  }

  const now = new Date();
  if (user.deletionScheduledAt <= now) {
    throw forbidden(
      "DELAI_EXPIRE",
      "Le délai de grâce est expiré : ce compte ne peut plus être réactivé."
    );
  }

  const restored = await prisma.$transaction(async tx => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: {
        active: true,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
        deletionRequestedBy: null,
      },
    });

    await tx.fiche.updateMany({
      where: { userId: user.id, statut: "SUSPENDUE" },
      data: { statut: "ACTIVE" },
    });

    await tx.accountDeletionLog.create({
      data: {
        targetUserId: user.id,
        targetEmailHash: hashEmailForAudit(user.email),
        targetRole: user.role,
        action: "CANCELED",
        initiatedBy: "USER",
        executedBy: "USER",
      },
    });

    return updated;
  });

  logger.info("Account deletion canceled by user", { userId: restored.id });

  return {
    user: {
      id: restored.id,
      email: restored.email,
      nom: restored.nom,
      role: restored.role,
      emailVerified: restored.emailVerifiedAt !== null,
      hasPassword: restored.passwordHash !== null,
    },
    token: signToken(restored.id),
  };
}

/**
 * Suppression définitive d'un utilisateur et de ses fiches/médias/prospects,
 * tout en préservant l'historique comptable (Payment / Subscription avec snapshots et ON DELETE SET NULL)
 * et en enregistrant une trace immuable dans `account_deletion_logs`.
 */
export async function purgeUserPermanently(
  userId: number,
  actor: {
    initiatedBy: DeletionInitiator;
    executedBy: DeletionExecutor;
    actorAdminId?: number;
    actorAdminEmail?: string;
    reason?: string | null;
  }
) {
  return prisma.$transaction(async tx => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nom: true,
        role: true,
        fiches: {
          select: { id: true, prenom: true, nom: true, slug: true },
        },
        _count: { select: { payments: true } },
      },
    });
    if (!user) throw notFound("Utilisateur introuvable");

    for (const fiche of user.fiches) {
      const ficheNom =
        [fiche.prenom, fiche.nom].filter(Boolean).join(" ").trim() ||
        fiche.slug;

      await tx.subscription.updateMany({
        where: { ficheId: fiche.id },
        data: { ficheNomSnapshot: ficheNom, ficheSlugSnapshot: fiche.slug },
      });
      await tx.payment.updateMany({
        where: { ficheId: fiche.id },
        data: { ficheNomSnapshot: ficheNom, ficheSlugSnapshot: fiche.slug },
      });
      await tx.fiche.delete({ where: { id: fiche.id } });
    }

    await tx.user.delete({ where: { id: user.id } });

    await tx.accountDeletionLog.create({
      data: {
        targetUserId: user.id,
        targetEmailHash: hashEmailForAudit(user.email),
        targetRole: user.role,
        action: "PURGED",
        initiatedBy: actor.initiatedBy,
        executedBy: actor.executedBy,
        actorAdminId: actor.actorAdminId ?? null,
        actorAdminEmail: actor.actorAdminEmail ?? null,
        reason: actor.reason?.trim() || null,
        fichesDeletedCount: user.fiches.length,
        paymentsPreservedCount: user._count.payments,
      },
    });

    logger.info("User account permanently purged", {
      targetUserId: user.id,
      initiatedBy: actor.initiatedBy,
      executedBy: actor.executedBy,
      actorAdminId: actor.actorAdminId,
      fichesDeletedCount: user.fiches.length,
      paymentsPreservedCount: user._count.payments,
    });

    return {
      email: user.email,
      nom: user.nom,
      fichesDeleted: user.fiches.length,
      paymentsPreserved: user._count.payments,
    };
  });
}

/**
 * Tâche planifiée : supprime définitivement tous les comptes dont le délai de grâce est écoulé.
 */
export async function purgeDueAccounts(now: Date = new Date()): Promise<number> {
  const dueUsers = await prisma.user.findMany({
    where: {
      deletionScheduledAt: { lte: now },
      role: "CLIENT",
    },
    select: {
      id: true,
      deletionRequestedBy: true,
    },
  });

  let purged = 0;
  for (const u of dueUsers) {
    try {
      await purgeUserPermanently(u.id, {
        initiatedBy: u.deletionRequestedBy === "ADMIN" ? "ADMIN" : "USER",
        executedBy: "SYSTEM_CRON",
        reason: "Expiration du délai de grâce de 30 jours",
      });
      purged += 1;
    } catch (error) {
      logger.error("Failed to purge due account", {
        userId: u.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return purged;
}

/**
 * Désactivation ou réactivation réversible d'un compte client par un administrateur.
 */
export async function setClientAccountStatus(
  userId: number,
  actingAdmin: { id: number; email: string },
  active: boolean,
  reason?: string
) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== "CLIENT") {
    throw notFound("Client introuvable");
  }

  const cleanReason = reason?.trim() || null;

  await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: userId },
      data: active
        ? {
            active: true,
            deletionRequestedAt: null,
            deletionScheduledAt: null,
            deletionRequestedBy: null,
          }
        : {
            active: false,
          },
    });

    if (!active) {
      await tx.fiche.updateMany({
        where: { userId, statut: "ACTIVE" },
        data: { statut: "SUSPENDUE" },
      });
    } else {
      await tx.fiche.updateMany({
        where: { userId, statut: "SUSPENDUE" },
        data: { statut: "ACTIVE" },
      });
    }

    await tx.accountDeletionLog.create({
      data: {
        targetUserId: target.id,
        targetEmailHash: hashEmailForAudit(target.email),
        targetRole: target.role,
        action: active ? "REACTIVATED" : "DEACTIVATED",
        initiatedBy: "ADMIN",
        executedBy: "ADMIN",
        actorAdminId: actingAdmin.id,
        actorAdminEmail: actingAdmin.email,
        reason: cleanReason,
      },
    });
  });

  logger.info("Client account status updated by admin", {
    targetUserId: userId,
    active,
    actorAdminId: actingAdmin.id,
  });
}

/**
 * Suppression définitive et stricte d'un compte client par un administrateur.
 * Exige la saisie exacte de l'adresse e-mail du client comme garde-fou.
 */
export async function permanentlyDeleteClientByAdmin(
  userId: number,
  actingAdmin: { id: number; email: string },
  confirmer: string,
  reason?: string
) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, nom: true, role: true },
  });
  if (!target || target.role !== "CLIENT") {
    throw notFound("Client introuvable");
  }

  if (confirmer.trim().toLowerCase() !== target.email.trim().toLowerCase()) {
    throw unprocessable(
      "CONFIRMATION_INVALIDE",
      "Pour supprimer définitivement ce compte, saisissez son adresse e-mail exacte."
    );
  }

  const result = await purgeUserPermanently(target.id, {
    initiatedBy: "ADMIN",
    executedBy: "ADMIN",
    actorAdminId: actingAdmin.id,
    actorAdminEmail: actingAdmin.email,
    reason,
  });

  try {
    await sendAccountDeletedByAdminEmail({
      to: result.email,
      name: result.nom,
      reason,
    });
  } catch (error) {
    logger.warn("Admin account deletion email failed", {
      targetUserId: target.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    fichesDeleted: result.fichesDeleted,
    paymentsPreserved: result.paymentsPreserved,
  };
}

export async function listAccountDeletionLogs(q: {
  page: number;
  limit: number;
}) {
  const [items, total] = await prisma.$transaction([
    prisma.accountDeletionLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.accountDeletionLog.count(),
  ]);

  return {
    items,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    },
  };
}
