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
  deleteProspectMedia: vi.fn(),
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

vi.mock("../../media/prospect-media.service", () => ({
  ProspectMediaService: {
    extractRef: (v: string | null | undefined) =>
      v && v.includes("/api/media/prospects/")
        ? v.slice(v.indexOf("/api/media/prospects/"))
        : null,
    toAbsolute: (v: string | null | undefined) => v ?? null,
    deleteRef: mocks.deleteProspectMedia,
  },
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

  it("exporte les prospects en CSV UTF-8 BOM en neutralisant les formules", async () => {
    mocks.rappelFindMany.mockResolvedValue([
      {
        nom: "=CMD|test",
        societe: 'Atelier "Dakar"',
        telephone: "+221771234567",
        email: "contact@atelier.sn",
        statut: "NOUVELLE",
        createdAt: new Date("2026-11-20T12:00:00Z"),
        fiche: { slug: "le-sunset", prenom: "Awa", nom: "Ndiaye" },
      },
    ]);

    const csv = await RappelService.exportCsvForUser(
      { id: 7, role: "CLIENT" } as never,
      { statut: "NOUVELLE" }
    );

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      '"Nom";"Société";"Téléphone";"E-mail";"Fiche";"Source";"Note";"Statut";"Date de réception"'
    );
    expect(csv).toContain('"\'=CMD|test"');
    expect(csv).toContain('"Atelier ""Dakar"""');
    expect(csv).toContain('"\'+221771234567"');
    expect(csv).toContain('"contact@atelier.sn"');
  });

  it("crée un prospect SCAN avec photo et note écrite pour le propriétaire", async () => {
    mocks.ficheFindUnique.mockResolvedValue({ id: 10, userId: 7 });
    mocks.rappelCreate.mockResolvedValue({
      id: 55,
      ficheId: 10,
      source: "SCAN",
      nom: null,
      telephone: null,
      email: null,
      societe: null,
      photoUrl: "/api/media/prospects/0a1b2c3d-0000-4000-8000-000000000001.webp",
      noteTexte: "Rencontré au salon",
      noteAudioUrl: null,
      statut: "NOUVELLE",
      traiteeAt: null,
      createdAt: new Date("2026-11-21T20:00:00Z"),
    });

    const created = await RappelService.createForUser(
      { id: 7, role: "CLIENT" } as never,
      {
        ficheId: 10,
        source: "SCAN",
        photoUrl:
          "https://api.example.com/api/media/prospects/0a1b2c3d-0000-4000-8000-000000000001.webp",
        noteTexte: "Rencontré au salon",
      }
    );

    expect(created.source).toBe("SCAN");
    expect(mocks.rappelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "SCAN",
          photoUrl:
            "/api/media/prospects/0a1b2c3d-0000-4000-8000-000000000001.webp",
          noteTexte: "Rencontré au salon",
        }),
      })
    );
  });

  it("convertit un scan en prospect manuel et supprime la photo uniquement si demandé", async () => {
    mocks.rappelFindUnique.mockResolvedValue({
      id: 55,
      source: "SCAN",
      photoUrl: "/api/media/prospects/0a1b2c3d-0000-4000-8000-000000000001.webp",
      fiche: { userId: 7 },
    });
    mocks.rappelUpdate.mockResolvedValue({
      id: 55,
      ficheId: 10,
      source: "MANUEL",
      nom: "Ousmane Ba",
      telephone: "771234567",
      email: null,
      societe: "Ba Services",
      photoUrl: null,
      noteTexte: null,
      noteAudioUrl: null,
      statut: "NOUVELLE",
      traiteeAt: null,
      createdAt: new Date("2026-11-21T20:00:00Z"),
    });

    const converted = await RappelService.updateForUser(
      { id: 7, role: "CLIENT" } as never,
      55,
      {
        nom: "Ousmane Ba",
        telephone: "77 123 45 67",
        societe: "Ba Services",
        deletePhoto: true,
      }
    );

    expect(converted.source).toBe("MANUEL");
    expect(mocks.deleteProspectMedia).toHaveBeenCalledWith(
      "/api/media/prospects/0a1b2c3d-0000-4000-8000-000000000001.webp"
    );
  });

  it("refuse de supprimer la photo tant que le prospect n'a pas été converti manuellement", async () => {
    mocks.rappelFindUnique.mockResolvedValue({
      id: 55,
      nom: null,
      telephone: null,
      photoUrl: "/api/media/prospects/0a1b2c3d-0000-4000-8000-000000000001.webp",
      fiche: { userId: 7 },
    });

    await expect(
      RappelService.deletePhotoForUser({ id: 7, role: "CLIENT" } as never, 55)
    ).rejects.toMatchObject({ status: 400, code: "CONVERSION_REQUISE" });
  });
});
