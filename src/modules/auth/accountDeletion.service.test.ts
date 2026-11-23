import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prismaMock,
  verifyPasswordMock,
  verifyGoogleMock,
  sendScheduledEmailMock,
  sendAdminDeletedEmailMock,
} = vi.hoisted(() => {
  const tx = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    fiche: {
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    authToken: {
      updateMany: vi.fn(),
    },
    subscription: {
      updateMany: vi.fn(),
    },
    payment: {
      updateMany: vi.fn(),
    },
    accountDeletionLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };

  return {
    prismaMock: {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      accountDeletionLog: tx.accountDeletionLog,
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === "function") {
          return (arg as (t: typeof tx) => Promise<unknown>)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
      __tx: tx,
    },
    verifyPasswordMock: vi.fn(),
    verifyGoogleMock: vi.fn(),
    sendScheduledEmailMock: vi.fn(),
    sendAdminDeletedEmailMock: vi.fn(),
  };
});

vi.mock("../../database/prisma/prisma-client", () => ({
  prisma: prismaMock,
}));

vi.mock("../../lib/password", () => ({
  verifyPassword: verifyPasswordMock,
}));

vi.mock("../../lib/googleAuth", () => ({
  verifyGoogleIdToken: verifyGoogleMock,
}));

vi.mock("../../lib/jwt", () => ({
  signToken: vi.fn((id: number) => `jwt-${id}`),
}));

vi.mock("../../lib/mailer", () => ({
  sendAccountDeletionScheduledEmail: sendScheduledEmailMock,
  sendAccountDeletedByAdminEmail: sendAdminDeletedEmailMock,
}));

import {
  ACCOUNT_DELETION_GRACE_DAYS,
  cancelSelfDeletion,
  hashEmailForAudit,
  permanentlyDeleteClientByAdmin,
  purgeDueAccounts,
  requestSelfDeletion,
  setClientAccountStatus,
} from "./accountDeletion.service";

describe("accountDeletion.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("programme la suppression à J+30 pour un compte classique avec mot de passe valide", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 10,
      email: "client@sc.sn",
      nom: "Awa",
      role: "CLIENT",
      passwordHash: "hashed",
      active: true,
    });
    verifyPasswordMock.mockResolvedValue(true);

    const res = await requestSelfDeletion(10, {
      password: "secret",
      reason: "Plus besoin",
    });

    expect(res.graceDays).toBe(ACCOUNT_DELETION_GRACE_DAYS);
    expect(prismaMock.__tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({
          active: false,
          deletionRequestedBy: "USER",
        }),
      })
    );
    expect(prismaMock.__tx.fiche.updateMany).toHaveBeenCalledWith({
      where: { userId: 10, statut: "ACTIVE" },
      data: { statut: "SUSPENDUE" },
    });
    expect(prismaMock.__tx.accountDeletionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUserId: 10,
          targetEmailHash: hashEmailForAudit("client@sc.sn"),
          action: "REQUESTED",
          initiatedBy: "USER",
          executedBy: "USER",
          reason: "Plus besoin",
        }),
      })
    );
    expect(sendScheduledEmailMock).toHaveBeenCalledOnce();
  });

  it("refuse la suppression si le mot de passe est incorrect", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 10,
      email: "client@sc.sn",
      role: "CLIENT",
      passwordHash: "hashed",
      active: true,
    });
    verifyPasswordMock.mockResolvedValue(false);

    await expect(
      requestSelfDeletion(10, { password: "wrong" })
    ).rejects.toMatchObject({ status: 422, code: "MOT_DE_PASSE_INCORRECT" });
    expect(prismaMock.__tx.user.update).not.toHaveBeenCalled();
  });

  it("exige la confirmation exacte de l'e-mail pour un compte Google sans mot de passe", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 11,
      email: "google@sc.sn",
      nom: "Moussa",
      role: "CLIENT",
      passwordHash: null,
      active: true,
    });

    await expect(
      requestSelfDeletion(11, { confirmEmail: "autre@sc.sn" })
    ).rejects.toMatchObject({ status: 422, code: "CONFIRMATION_INVALIDE" });

    const ok = await requestSelfDeletion(11, { confirmEmail: "GOOGLE@sc.sn" });
    expect(ok.graceDays).toBe(30);
    expect(prismaMock.__tx.user.update).toHaveBeenCalledOnce();
  });

  it("interdit l'auto-suppression d'un compte ADMIN", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: "admin@sc.sn",
      role: "ADMIN",
      passwordHash: "hashed",
      active: true,
    });

    await expect(
      requestSelfDeletion(1, { password: "secret" })
    ).rejects.toMatchObject({
      status: 422,
      code: "AUTO_SUPPRESSION_ADMIN_INTERDITE",
    });
  });

  it("annule la suppression pendant le délai de grâce et réactive compte + fiches", async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 10,
      email: "client@sc.sn",
      nom: "Awa",
      role: "CLIENT",
      passwordHash: "hashed",
      active: false,
      deletionScheduledAt: future,
      deletionRequestedBy: "USER",
      emailVerifiedAt: new Date(),
    });
    verifyPasswordMock.mockResolvedValue(true);
    prismaMock.__tx.user.update.mockResolvedValue({
      id: 10,
      email: "client@sc.sn",
      nom: "Awa",
      role: "CLIENT",
      passwordHash: "hashed",
      active: true,
      emailVerifiedAt: new Date(),
    });

    const result = await cancelSelfDeletion({
      email: "client@sc.sn",
      password: "secret",
    });

    expect(result.token).toBe("jwt-10");
    expect(prismaMock.__tx.fiche.updateMany).toHaveBeenCalledWith({
      where: { userId: 10, statut: "SUSPENDUE" },
      data: { statut: "ACTIVE" },
    });
    expect(prismaMock.__tx.accountDeletionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CANCELED",
          initiatedBy: "USER",
          executedBy: "USER",
        }),
      })
    );
  });

  it("désactive puis réactive un client côté admin avec trace de l'administrateur", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 20,
      email: "c@sc.sn",
      role: "CLIENT",
      active: true,
    });

    await setClientAccountStatus(
      20,
      { id: 1, email: "root@sc.sn" },
      false,
      "Impayé"
    );

    expect(prismaMock.__tx.user.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { active: false },
    });
    expect(prismaMock.__tx.fiche.updateMany).toHaveBeenCalledWith({
      where: { userId: 20, statut: "ACTIVE" },
      data: { statut: "SUSPENDUE" },
    });
    expect(prismaMock.__tx.accountDeletionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DEACTIVATED",
          initiatedBy: "ADMIN",
          executedBy: "ADMIN",
          actorAdminId: 1,
          actorAdminEmail: "root@sc.sn",
          reason: "Impayé",
        }),
      })
    );
  });

  it("suppression définitive stricte par admin : exige l'e-mail exact, conserve les snapshots comptables et trace l'admin", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 30,
      email: "fatou@sc.sn",
      nom: "Fatou",
      role: "CLIENT",
    });

    await expect(
      permanentlyDeleteClientByAdmin(
        30,
        { id: 2, email: "admin@sc.sn" },
        "mauvais@sc.sn"
      )
    ).rejects.toMatchObject({ status: 422, code: "CONFIRMATION_INVALIDE" });

    prismaMock.__tx.user.findUnique.mockResolvedValue({
      id: 30,
      email: "fatou@sc.sn",
      nom: "Fatou",
      role: "CLIENT",
      fiches: [{ id: 101, prenom: "Fatou", nom: "Diop", slug: "fatou-diop" }],
      _count: { payments: 3 },
    });

    const out = await permanentlyDeleteClientByAdmin(
      30,
      { id: 2, email: "admin@sc.sn" },
      "FATOU@sc.sn",
      "Demande RGPD"
    );

    expect(out).toEqual({ fichesDeleted: 1, paymentsPreserved: 3 });
    expect(prismaMock.__tx.subscription.updateMany).toHaveBeenCalledWith({
      where: { ficheId: 101 },
      data: { ficheNomSnapshot: "Fatou Diop", ficheSlugSnapshot: "fatou-diop" },
    });
    expect(prismaMock.__tx.payment.updateMany).toHaveBeenCalledWith({
      where: { ficheId: 101 },
      data: { ficheNomSnapshot: "Fatou Diop", ficheSlugSnapshot: "fatou-diop" },
    });
    expect(prismaMock.__tx.fiche.delete).toHaveBeenCalledWith({
      where: { id: 101 },
    });
    expect(prismaMock.__tx.user.delete).toHaveBeenCalledWith({
      where: { id: 30 },
    });
    expect(prismaMock.__tx.accountDeletionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUserId: 30,
          targetEmailHash: hashEmailForAudit("fatou@sc.sn"),
          action: "PURGED",
          initiatedBy: "ADMIN",
          executedBy: "ADMIN",
          actorAdminId: 2,
          actorAdminEmail: "admin@sc.sn",
          fichesDeletedCount: 1,
          paymentsPreservedCount: 3,
          reason: "Demande RGPD",
        }),
      })
    );
    expect(sendAdminDeletedEmailMock).toHaveBeenCalledOnce();
  });

  it("purge automatiquement les comptes arrivés à échéance du délai de grâce", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 40, deletionRequestedBy: "USER" },
    ]);
    prismaMock.__tx.user.findUnique.mockResolvedValue({
      id: 40,
      email: "old@sc.sn",
      nom: "Old",
      role: "CLIENT",
      fiches: [],
      _count: { payments: 2 },
    });

    const count = await purgeDueAccounts(new Date());

    expect(count).toBe(1);
    expect(prismaMock.__tx.accountDeletionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetUserId: 40,
          action: "PURGED",
          initiatedBy: "USER",
          executedBy: "SYSTEM_CRON",
          paymentsPreservedCount: 2,
        }),
      })
    );
  });
});
