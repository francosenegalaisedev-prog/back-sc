import { describe, expect, it } from "vitest";
import type { FicheFull } from "./fiches.dto";
import { toFicheDto } from "./fiches.dto";

const fiche = (sections: string[], statut: "ACTIVE" | "SUSPENDUE" | "BROUILLON" = "ACTIVE") =>
  ({
    id: 1,
    slug: "le-sunset",
    statut,
    enLigneSeule: false,
    prenom: "Rose",
    nom: "N",
    fonction: null,
    entreprise: null,
    photo: null,
    logo: null,
    telephone: null,
    whatsapp: null,
    email: null,
    site: null,
    adresse: null,
    googlePlaceId: null,
    scansTotal: 0,
    updatedAt: new Date("2026-10-29"),
    secteur: null,
    premierBouton: "WHATSAPP",
    messageWhatsapp: null,
    presentation: null,
    enteteDisposition: "PORTRAIT",
    enteteTaille: "M",
    enteteTheme: null,
    enteteCouverture: null,
    rdvLabel: null,
    rdvUrl: null,
    reseaux: [],
    liens: [],
    horaires: [],
    medias: [],
    catalogueSections: [],
    menuSections: [],
    biens: [],
    onglets: [],
    sectionStickers: sections.map(section => ({ section })),
  }) as unknown as FicheFull;
const sub = (type = "PRO") => ({ plan: { type, limits: null }, endsAt: null }) as never;

describe("toFicheDto : stickerSections", () => {
  it("expose uniquement les sections autorisées activées quand la fiche est ACTIVE", () => {
    expect(toFicheDto(fiche(["menu", "reseaux", "horaires"]), sub()).stickerSections).toEqual([
      "menu",
      "reseaux",
    ]);
  });

  it("aucune section activée : tableau vide", () => {
    expect(toFicheDto(fiche([]), sub()).stickerSections).toEqual([]);
  });

  it("abonnement échu ou fiche suspendue : aucune section servie (l'état de la fiche inclut celui du sticker)", () => {
    const expired = toFicheDto(fiche(["menu"]), null);
    expect(expired.expiree).toBe(true);
    expect(expired.stickerSections).toEqual([]);

    const suspended = toFicheDto(fiche(["menu"], "SUSPENDUE"), sub());
    expect(suspended.stickerSections).toEqual([]);
  });
});
