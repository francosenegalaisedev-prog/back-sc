import { describe, expect, it } from "vitest";
import { createRappelSchema, updateFicheSchema } from "./fiches.schemas";

describe("fiches.schemas — validation, sanitization et messages français", () => {
  it("nettoie les caractères de contrôle et retours ligne sur les champs mono-ligne", () => {
    const parsed = updateFicheSchema.parse({
      prenom: "  Awa\u0000\nDiop\t ",
      entreprise: "Studio\r\nDakar\u0007",
      data: {
        presentation: "Ligne 1\r\nLigne 2\u0000",
      },
    });

    expect(parsed.prenom).toBe("Awa Diop");
    expect(parsed.entreprise).toBe("Studio Dakar");
    expect(parsed.data?.presentation).toBe("Ligne 1\nLigne 2");
  });

  it("valide les numéros sénégalais (70, 71, 75, 76, 77, 78, 33) et internationaux", () => {
    expect(
      updateFicheSchema.safeParse({
        telephone: "77 123 45 67",
        whatsapp: "+221 71 987 65 43",
      }).success
    ).toBe(true);

    expect(
      updateFicheSchema.safeParse({
        telephone: "+33 6 12 34 56 78",
        whatsapp: "+225 07 07 12 34 56",
      }).success
    ).toBe(true);

    // Champs vides autorisés pour effacer un numéro
    expect(
      updateFicheSchema.safeParse({ telephone: "", whatsapp: "" }).success
    ).toBe(true);
  });

  it("refuse les numéros invalides avec un message clair en français", () => {
    const res = updateFicheSchema.safeParse({
      telephone: "79 123 45 67",
      whatsapp: "bonjour",
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues).toHaveLength(2);
      expect(res.error.issues[0].message).toContain("Numéro invalide");
      expect(res.error.issues[1].message).toContain("Numéro invalide");
    }
  });

  it("retourne des messages en français pour les champs requis, longueurs, URLs, prix et enums", () => {
    const res = updateFicheSchema.safeParse({
      prenom: "   ",
      email: "mauvais-email",
      site: "www.exemple.sn",
      data: {
        secteur: "inconnu",
        sections: [
          {
            titre: "",
            articles: [{ nom: "Café", prix: -10 }],
          },
        ],
      },
    });

    expect(res.success).toBe(false);
    if (!res.success) {
      const messages = res.error.issues.map(i => i.message);
      expect(messages).toContain("Ce champ est requis.");
      expect(messages).toContain("Adresse e-mail invalide.");
      expect(messages).toContain(
        "URL invalide : elle doit commencer par https:// (ou http://, tel:, mailto:)."
      );
      expect(messages).toContain("Valeur non autorisée.");
      expect(messages).toContain("La valeur doit être positive.");
      // Aucun message anglais par défaut de Zod
      for (const msg of messages) {
        expect(msg).not.toMatch(/String must|Invalid enum|Expected number/i);
      }
    }
  });

  it("valide également createRappelSchema avec les règles Sénégal + international", () => {
    expect(
      createRappelSchema.safeParse({
        nom: "Moussa",
        telephone: "78 123 45 67",
        email: "moussa@exemple.sn",
        societe: "Atelier\u0000Dakar",
      }).success
    ).toBe(true);

    const invalid = createRappelSchema.safeParse({
      nom: "M",
      telephone: "+221 79 000 00 00",
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(i => i.message)).toContain(
        "Veuillez saisir au moins 2 caractères."
      );
      expect(
        invalid.error.issues.some(i => i.message.includes("Numéro invalide"))
      ).toBe(true);
    }
  });
});
