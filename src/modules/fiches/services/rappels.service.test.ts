import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ficheFindUnique: vi.fn(),
  rappelFindFirst: vi.fn(),
  rappelFindUnique: vi.fn(),
  rappelCreate: vi.fn(),
  rappelUpdate: vi.fn(),
  rappelDelete: vi.fn(),
  rappelCount: vi.fn(),
  rappelFindMany: vi.fn(),
  transaction: vi.fn(),
  getPublicSubscription: vi.fn(),
  sendCallbackRequestEmail: vi.fn(),
}));

vi.mock("../../../database/prisma/prisma-client", () => ({
  prisma: {
    fiche: { findUnique: mocks.ficheFindUnique },
    demandeRappel: {
      findFirst: mocks.rappelFindFirst,
      findUnique: mocks.rappelFindUnique,
      create: mocks.rappelCreate,
      update: mocks.rappelUpdate,
      delete: mocks.rappelDelete,
      count: mocks.rappelCount,
      findMany: mocks.rappelFindMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("./fiche-public-access", () => ({
  getPublicSubscription: mocks.getPublicSubscription,
}));

vi.mock("../../../lib/mailer", () => ({
  sendCallbackRequestEmail: mocks.sendCallbackRequestEmail,
}));

import { RappelService } from "./rappels.service";

const activeFiche = {
  id: 10,
  statut: "ACTIVE",
  prenom: "Awa",
  nom: "Ndiaye",
  entreprise: "Le Sunset",
  user: { email: "awa@sunset.sn", nom: "Awa" },
  onglets: [{ visible: true }],
};

describe("RappelService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendCallbackRequestEmail.mockResolvedValue(undefined);
  });

  it("ignore silencieusement les soumissions bots qui remplissent le honeypot", async () => {
    const res = await RappelService.createPublic("le-sunset", {
      nom: "Bot",
      telephone: "+221770000000",
      website: "https://spam.example",
    });
    expect(res.id).toBe(0);
    expect(mocks.ficheFindUnique).not.toHaveBeenCalled();
    expect(mocks.rappelCreate).not.toHaveBeenCalled();
  });

  it("refuse la création si la formule n'autorise pas le formulaire (hasForm: false)", async () => {
    mocks.ficheFindUnique.mockResolvedValue(activeFiche);
    mocks.getPublicSubscription.mockResolvedValue({
      plan: { limits: { hasForm: false } },
    });

    await expect(
      RappelService.createPublic("le-sunset", {
        nom: "Moussa",
        telephone: "+221 77 123 45 67",
      })
    ).rejects.toMatchObject({ status: 403, code: "FORMULAIRE_INDISPONIBLE" });
  });

  it("refuse la création si l'onglet RAPPEL est masqué", async () => {
    mocks.ficheFindUnique.mockResolvedValue({
      ...activeFiche,
      onglets: [{ visible: false }],
    });
    mocks.getPublicSubscription.mockResolvedValue({
      plan: { limits: { hasForm: true } },
    });

    await expect(
      RappelService.createPublic("le-sunset", {
        nom: "Moussa",
        telephone: "+221 77 123 45 67",
      })
    ).rejects.toMatchObject({ status: 403, code: "FORMULAIRE_INDISPONIBLE" });
  });

  it("bloque un doublon récent avec le même numéro (429)", async () => {
    mocks.ficheFindUnique.mockResolvedValue(activeFiche);
    mocks.getPublicSubscription.mockResolvedValue({
      plan: { limits: { hasForm: true } },
    });
    mocks.rappelFindFirst.mockResolvedValue({ id: 99 });

    await expect(
      RappelService.createPublic("le-sunset", {
        nom: "Moussa",
        telephone: "+221 77 123 45 67",
      })
    ).rejects.toMatchObject({ status: 429, code: "DEMANDE_DEJA_ENVOYEE" });
    expect(mocks.rappelCreate).not.toHaveBeenCalled();
  });

  it("crée la demande et envoie un e-mail de notification au propriétaire", async () => {
    const createdAt = new Date("2026-11-20T16:00:00Z");
    mocks.ficheFindUnique.mockResolvedValue(activeFiche);
    mocks.getPublicSubscription.mockResolvedValue({
      plan: { limits: { hasForm: true } },
    });
    mocks.rappelFindFirst.mockResolvedValue(null);
    mocks.rappelCreate.mockResolvedValue({
      id: 42,
      statut: "NOUVELLE",
      createdAt,
    });

    const res = await RappelService.createPublic("le-sunset", {
      nom: "  Moussa Diop  ",
      telephone: "+221 77 123-45.67",
      email: "  moussa@exemple.sn ",
      societe: "  Atelier Dakar ",
    });

    expect(res).toEqual({ id: 42, statut: "NOUVELLE", createdAt });
    expect(mocks.rappelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ficheId: 10,
          nom: "Moussa Diop",
          telephone: "+221771234567",
          email: "moussa@exemple.sn",
          societe: "Atelier Dakar",
        },
      })
    );
    expect(mocks.sendCallbackRequestEmail).toHaveBeenCalledWith({
      to: "awa@sunset.sn",
      ownerName: "Awa",
      ficheName: "Le Sunset",
      visitorName: "Moussa Diop",
      visitorPhone: "+221771234567",
      visitorEmail: "moussa@exemple.sn",
      visitorCompany: "Atelier Dakar",
    });
  });

  it("refuse un e-mail invalide s'il est renseigné", async () => {
    mocks.ficheFindUnique.mockResolvedValue(activeFiche);
    mocks.getPublicSubscription.mockResolvedValue({
      plan: { limits: { hasForm: true } },
    });

    await expect(
      RappelService.createPublic("le-sunset", {
        nom: "Moussa",
        telephone: "+221 77 123 45 67",
        email: "pas-un-email",
      })
    ).rejects.toMatchObject({ status: 400, code: "EMAIL_INVALIDE" });
    expect(mocks.rappelCreate).not.toHaveBeenCalled();
  });

  it("met à jour le statut uniquement pour le propriétaire (ou ADMIN)", async () => {
    mocks.rappelFindUnique.mockResolvedValue({
      id: 42,
      fiche: { userId: 7 },
    });
    mocks.rappelUpdate.mockResolvedValue({
      id: 42,
      statut: "TRAITEE",
    });

    await expect(
      RappelService.updateStatus({ id: 99, role: "CLIENT" } as never, 42, "TRAITEE")
    ).rejects.toMatchObject({ status: 404 });

    const updated = await RappelService.updateStatus(
      { id: 7, role: "CLIENT" } as never,
      42,
      "TRAITEE"
    );
    expect(updated).toMatchObject({ id: 42, statut: "TRAITEE" });
  });

  it("supprime la demande uniquement pour le propriétaire (ou ADMIN)", async () => {
    mocks.rappelFindUnique.mockResolvedValue({
      id: 42,
      fiche: { userId: 7 },
    });
    mocks.rappelDelete.mockResolvedValue({ id: 42 });

    await expect(
      RappelService.remove({ id: 99, role: "CLIENT" } as never, 42)
    ).rejects.toMatchObject({ status: 404 });

    const result = await RappelService.remove(
      { id: 7, role: "CLIENT" } as never,
      42
    );
    expect(result).toEqual({ deleted: true, id: 42 });
    expect(mocks.rappelDelete).toHaveBeenCalledWith({ where: { id: 42 } });
  });
});
