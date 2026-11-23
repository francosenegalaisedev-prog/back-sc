import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../database/prisma/generated/prisma/client";
import {
  ALLOWED_STICKER_SECTIONS,
  adminCreateSectionStickerSchema,
  patchSectionStickerSchema,
} from "./section-stickers.schemas";

const mocks = vi.hoisted(() => ({
  ficheFindFirst: vi.fn(),
  ficheFindUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("../../database/prisma/prisma-client", () => ({
  prisma: {
    fiche: {
      findFirst: mocks.ficheFindFirst,
      findUnique: mocks.ficheFindUnique,
    },
    sectionStickerRequest: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
    },
  },
}));

vi.mock("../../lib/mailer", () => ({
  sendSectionStickerActivatedEmail: mocks.sendEmail,
}));

import { SectionStickerService } from "./section-stickers.service";

const clientUser = { id: 7, role: "CLIENT" as const, emailVerified: true };
const adminUser = { id: 1, role: "ADMIN" as const, emailVerified: true };

const adminRow = (overrides: Record<string, unknown> = {}) => ({
  id: 42,
  ficheId: 10,
  userId: 7,
  section: "menu",
  statut: "ACTIVE" as const,
  activatedAt: new Date("2026-11-23T12:00:00Z"),
  createdAt: new Date("2026-11-23T12:00:00Z"),
  updatedAt: new Date("2026-11-23T12:00:00Z"),
  fiche: {
    id: 10,
    slug: "chez-awa",
    prenom: "Awa",
    nom: "Ndiaye",
    entreprise: "Chez Awa",
    statut: "ACTIVE" as const,
  },
  user: { id: 7, nom: "Awa", email: "awa@sc.sn" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("section-stickers.schemas", () => {
  it("autorise uniquement les 7 sections définies", () => {
    for (const s of ALLOWED_STICKER_SECTIONS) {
      expect(
        adminCreateSectionStickerSchema.safeParse({ ficheId: 1, section: s })
          .success
      ).toBe(true);
    }
    for (const bad of ["horaires", "presentation", "liens", "videos", "texte", "custom_1"]) {
      expect(
        adminCreateSectionStickerSchema.safeParse({ ficheId: 1, section: bad })
          .success
      ).toBe(false);
    }
  });

  it("n'autorise que active et desactivee pour PATCH", () => {
    expect(patchSectionStickerSchema.safeParse({ statut: "active" }).success).toBe(true);
    expect(patchSectionStickerSchema.safeParse({ statut: "desactivee" }).success).toBe(true);
    expect(patchSectionStickerSchema.safeParse({ statut: "refusee" }).success).toBe(false);
  });
});

describe("SectionStickerService.adminGenerate", () => {
  it("génère et active directement un sticker pour une fiche PRO/SIGNATURE active et notifie le client", async () => {
    mocks.ficheFindUnique.mockResolvedValue({
      id: 10,
      userId: 7,
      statut: "ACTIVE",
      subscriptions: [{ plan: { type: "PRO" } }],
    });
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue(adminRow());

    const res = await SectionStickerService.adminGenerate({
      ficheId: 10,
      section: "menu",
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ficheId: 10,
          userId: 7,
          section: "menu",
          statut: "ACTIVE",
        }),
      })
    );
    expect(res.demande.statut).toBe("active");
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });

  it("réactive un sticker désactivé existant au lieu d'en dupliquer un", async () => {
    mocks.ficheFindUnique.mockResolvedValue({
      id: 10,
      userId: 7,
      statut: "ACTIVE",
      subscriptions: [{ plan: { type: "SIGNATURE" } }],
    });
    mocks.findFirst.mockResolvedValue({ id: 42, statut: "DESACTIVEE" });
    mocks.update.mockResolvedValue(adminRow());

    const res = await SectionStickerService.adminGenerate({
      ficheId: 10,
      section: "menu",
    });

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        data: expect.objectContaining({ statut: "ACTIVE" }),
      })
    );
    expect(res.demande.statut).toBe("active");
  });

  it("refuse si la fiche n'est pas active ou n'a pas de formule Pro/Signature", async () => {
    mocks.ficheFindUnique.mockResolvedValue({
      id: 10,
      userId: 7,
      statut: "SUSPENDUE",
      subscriptions: [{ plan: { type: "PRO" } }],
    });
    await expect(
      SectionStickerService.adminGenerate({ ficheId: 10, section: "menu" })
    ).rejects.toMatchObject({ status: 422, code: "FICHE_NON_PUBLIEE" });

    mocks.ficheFindUnique.mockResolvedValue({
      id: 10,
      userId: 7,
      statut: "ACTIVE",
      subscriptions: [{ plan: { type: "ESSENTIELLE" } }],
    });
    await expect(
      SectionStickerService.adminGenerate({ ficheId: 10, section: "menu" })
    ).rejects.toMatchObject({ status: 422, code: "FORMULE_INSUFFISANTE" });
  });

  it("refuse en 409 si un sticker actif existe déjà sur cette section", async () => {
    mocks.ficheFindUnique.mockResolvedValue({
      id: 10,
      userId: 7,
      statut: "ACTIVE",
      subscriptions: [{ plan: { type: "PRO" } }],
    });
    mocks.findFirst.mockResolvedValue({ id: 42, statut: "ACTIVE" });

    await expect(
      SectionStickerService.adminGenerate({ ficheId: 10, section: "menu" })
    ).rejects.toMatchObject({ status: 409, code: "STICKER_DEJA_ACTIF" });
  });

  it("transforme P2002 en 409 STICKER_DEJA_ACTIF", async () => {
    mocks.ficheFindUnique.mockResolvedValue({
      id: 10,
      userId: 7,
      statut: "ACTIVE",
      subscriptions: [{ plan: { type: "PRO" } }],
    });
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "7.0.0",
      })
    );

    await expect(
      SectionStickerService.adminGenerate({ ficheId: 10, section: "menu" })
    ).rejects.toMatchObject({ status: 409, code: "STICKER_DEJA_ACTIF" });
  });
});

describe("SectionStickerService.listForFiche & adminSetStatus", () => {
  it("ne renvoie au client que les stickers actifs des sections autorisées", async () => {
    mocks.ficheFindFirst.mockResolvedValue({ id: 10 });
    mocks.findMany.mockResolvedValue([adminRow()]);

    await SectionStickerService.listForFiche(clientUser, 10);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ficheId: 10,
          statut: "ACTIVE",
          section: { in: [...ALLOWED_STICKER_SECTIONS] },
        }),
      })
    );
  });

  it("renvoie tous les statuts à l'admin pour une fiche", async () => {
    mocks.ficheFindFirst.mockResolvedValue({ id: 10 });
    mocks.findMany.mockResolvedValue([adminRow({ statut: "DESACTIVEE" })]);

    await SectionStickerService.listForFiche(adminUser, 10);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ficheId: 10,
          section: { in: [...ALLOWED_STICKER_SECTIONS] },
        },
      })
    );
  });

  it("désactive puis réactive un sticker via adminSetStatus", async () => {
    mocks.findUnique.mockResolvedValue({ statut: "ACTIVE" });
    mocks.update.mockResolvedValue(adminRow({ statut: "DESACTIVEE" }));

    const off = await SectionStickerService.adminSetStatus(42, {
      statut: "desactivee",
    });
    expect(off.demande.statut).toBe("desactivee");
    expect(mocks.sendEmail).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValue({ statut: "DESACTIVEE" });
    mocks.update.mockResolvedValue(adminRow({ statut: "ACTIVE" }));
    const on = await SectionStickerService.adminSetStatus(42, {
      statut: "active",
    });
    expect(on.demande.statut).toBe("active");
    expect(mocks.sendEmail).toHaveBeenCalledOnce();
  });
});
