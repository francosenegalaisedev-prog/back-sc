import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ficheFindFirst: vi.fn(),
  ficheFindUnique: vi.fn(),
  printFindFirst: vi.fn(),
  printFindUnique: vi.fn(),
  printUpdate: vi.fn(),
  printCreate: vi.fn(),
  appSettingFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../../database/prisma/prisma-client", () => ({
  prisma: {
    fiche: { findFirst: mocks.ficheFindFirst, findUnique: mocks.ficheFindUnique },
    printJob: {
      findFirst: mocks.printFindFirst,
      findUnique: mocks.printFindUnique,
      create: mocks.printCreate,
      update: mocks.printUpdate,
    },
    appSetting: {
      findUnique: mocks.appSettingFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../../lib/mailer", () => ({
  sendCardOrderEmail: vi.fn().mockResolvedValue(undefined),
}));

import { env } from "../../config/env";
import type { AuthUser } from "../../types/user";
import { ProductionService } from "./production.service";

const user: AuthUser = { id: 4, role: "CLIENT", emailVerified: true };
const fiche = {
  id: 12,
  slug: "awa-ndiaye",
  prenom: "Awa",
  nom: "Ndiaye",
  entreprise: "Studio",
  telephone: "770000000",
  email: "awa@example.com",
  fonction: "Créatrice",
  statut: "ACTIVE",
  subscriptions: [{ plan: { type: "PRO" } }],
};
const job = {
  id: 31,
  ficheId: fiche.id,
  tier: "PRO",
  formule: "pro",
  slug: fiche.slug,
  nfcUrl: `${env.PUBLIC_SITE_URL}/f/awa-ndiaye`,
  rectoUrl: null,
  versoUrl: null,
  design: null,
  statut: "ENVOYEE",
  deliveryAddress: "Dakar, Plateau",
  deliveryTelephone: "770000000",
  clientNotes: null,
  amountFcfa: 12_000,
  printedAt: null,
  encodedAt: null,
  testedAt: null,
  deliveredAt: null,
  notes: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  clientNom: "Awa Ndiaye",
  clientEntreprise: "Studio",
  clientTelephone: "770000000",
  clientEmail: "awa@example.com",
  clientFonction: "Créatrice",
};

const tx = {
  fiche: { findFirst: mocks.ficheFindFirst },
  printJob: {
    findFirst: mocks.printFindFirst,
    findUnique: mocks.printFindUnique,
    create: mocks.printCreate,
    update: mocks.printUpdate,
  },
  appSetting: {
    findUnique: mocks.appSettingFindUnique,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    (callback: (transaction: typeof tx) => unknown) => callback(tx)
  );
  mocks.ficheFindFirst.mockResolvedValue(fiche);
  mocks.ficheFindUnique.mockResolvedValue(fiche);
  mocks.printFindFirst.mockResolvedValue(null);
  mocks.appSettingFindUnique.mockResolvedValue({ cardPriceFcfa: 15_000 });
  mocks.printFindUnique.mockResolvedValue({
    statut: "ENVOYEE",
    printedAt: null,
    encodedAt: null,
    testedAt: null,
    deliveredAt: null,
    nfcUrl: `${env.PUBLIC_SITE_URL}/f/awa-ndiaye`,
    fiche: { slug: "awa-ndiaye" },
  });
  mocks.printCreate.mockImplementation(({ data }) =>
    Promise.resolve({ ...job, ...data, fiche })
  );
  mocks.printUpdate.mockImplementation(({ data }) =>
    Promise.resolve({ ...job, ...data, fiche })
  );
});

describe("ProductionService.requestClientCarte", () => {
  const input = {
    adresseLivraison: "Dakar, Plateau",
    telephoneLivraison: "770000000",
  };

  it("creates a card using the fiche subscription, server price, previews and design metadata", async () => {
    const result = await ProductionService.requestClientCarte(user, fiche.id, {
      ...input,
      rectoUrl: "/api/media/cartes/0a1b2c3d-0000-4000-8000-000000000001.webp",
      versoUrl: "/api/media/cartes/0a1b2c3d-0000-4000-8000-000000000002.webp",
      design: { couleurAccentHex: "#EF1733", fondRecto: "noir" },
    });

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });

    expect(mocks.printCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ficheId: fiche.id,
          tier: "PRO",
          rectoUrl: "/api/media/cartes/0a1b2c3d-0000-4000-8000-000000000001.webp",
          versoUrl: "/api/media/cartes/0a1b2c3d-0000-4000-8000-000000000002.webp",
          design: { couleurAccentHex: "#EF1733", fondRecto: "noir" },
          amountFcfa: 15_000,
          deliveryAddress: input.adresseLivraison,
          deliveryTelephone: input.telephoneLivraison,
        }),
      })
    );
    expect(result.carte).toMatchObject({
      id: job.id,
      tier: "pro",
      montantFcfa: 15_000,
      statut: "envoyee",
      rectoUrl: "http://localhost:4000/api/media/cartes/0a1b2c3d-0000-4000-8000-000000000001.webp",
    });
  });

  it("uses custom cardPriceFcfa configured in AppSetting", async () => {
    mocks.appSettingFindUnique.mockResolvedValueOnce({ cardPriceFcfa: 18_500 });
    const result = await ProductionService.requestClientCarte(user, fiche.id, input);
    expect(result.carte.montantFcfa).toBe(18_500);
  });

  it("creates a card with null previews when none are provided", async () => {
    await ProductionService.requestClientCarte(user, fiche.id, input);

    expect(mocks.printCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rectoUrl: null, versoUrl: null }),
      })
    );
  });

  describe("ProductionService.updateCarte", () => {
    it("persists the selected status and its transition timestamp", async () => {
      const result = await ProductionService.updateCarte(31, {
        statut: "traitee",
      });

      expect(mocks.printUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 31 },
          data: expect.objectContaining({
            statut: "TRAITEE",
            printedAt: expect.any(Date),
          }),
        })
      );
      expect(result.carte.statut).toBe("traitee");
    });

    it("rejects an invalid transition from LIVREE directly back to ENVOYEE", async () => {
      mocks.printFindUnique.mockResolvedValue({
        statut: "LIVREE",
        printedAt: new Date("2026-01-02T00:00:00.000Z"),
        encodedAt: null,
        testedAt: null,
        deliveredAt: new Date("2026-01-05T00:00:00.000Z"),
        nfcUrl: `${env.PUBLIC_SITE_URL}/f/awa-ndiaye`,
        fiche: { slug: "awa-ndiaye" },
      });

      await expect(
        ProductionService.updateCarte(31, { statut: "envoyee" })
      ).rejects.toMatchObject({ status: 422 });

      expect(mocks.printUpdate).not.toHaveBeenCalled();
    });

    it("does not deliver a card if the fiche address changed", async () => {
      mocks.printFindUnique.mockResolvedValue({
        statut: "TRAITEE",
        printedAt: new Date("2026-01-02T00:00:00.000Z"),
        encodedAt: null,
        testedAt: null,
        deliveredAt: null,
        nfcUrl: `${env.PUBLIC_SITE_URL}/f/old-slug`,
        fiche: { slug: "new-slug" },
      });

      await expect(
        ProductionService.updateCarte(31, { statut: "livree" })
      ).rejects.toMatchObject({ status: 422 });
      expect(mocks.printUpdate).not.toHaveBeenCalled();
    });
  });

  describe("ProductionService.updateCarte : image persistence", () => {
    it("normalizes an uploaded image URL before storing it", async () => {
      await ProductionService.updateCarte(31, {
        rectoUrl: "http://localhost:4000/api/media/cartes/0a1b2c3d-0000-4000-8000-000000000001.webp",
      });

      expect(mocks.printUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 31 },
          data: { rectoUrl: "/api/media/cartes/0a1b2c3d-0000-4000-8000-000000000001.webp" },
        })
      );
    });

    it("refuses image changes after processing has started", async () => {
      mocks.printFindUnique.mockResolvedValue({
        statut: "TRAITEE",
        printedAt: new Date("2026-01-02T00:00:00.000Z"),
        encodedAt: null,
        testedAt: null,
        deliveredAt: null,
        nfcUrl: `${env.PUBLIC_SITE_URL}/f/awa-ndiaye`,
        fiche: { slug: "awa-ndiaye" },
      });

      await expect(
        ProductionService.updateCarte(31, {
          rectoUrl: "https://cdn.example/recto.webp",
        })
      ).rejects.toMatchObject({
        status: 422,
        code: "FICHIERS_CARTE_VERROUILLES",
      });
      expect(mocks.printUpdate).not.toHaveBeenCalled();
    });
  });

  it("rejects unpublished fiches before creating a job", async () => {
    mocks.ficheFindFirst.mockResolvedValue({ ...fiche, statut: "BROUILLON" });

    await expect(
      ProductionService.requestClientCarte(user, fiche.id, input)
    ).rejects.toMatchObject({
      status: 403,
      code: "FICHE_NON_PUBLIEE",
    });
    expect(mocks.printCreate).not.toHaveBeenCalled();
  });

  it("rejects an active request already in production", async () => {
    mocks.printFindFirst.mockResolvedValue({ id: 25 });

    await expect(
      ProductionService.requestClientCarte(user, fiche.id, input)
    ).rejects.toMatchObject({
      status: 409,
      code: "CARTE_DEJA_EN_COURS",
    });
    expect(mocks.printCreate).not.toHaveBeenCalled();
  });
});
