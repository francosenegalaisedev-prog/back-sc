import { z } from "zod";
import { isValidPhone, PHONE_ERROR_MESSAGE } from "../../lib/phone";

// ───────── Sanitization & Briques réutilisables ─────────
// Supprime les caractères de contrôle invisibles (\x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F).
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const sanitizeSingleLine = (value: unknown) => {
  if (typeof value !== "string") return value;
  return value
    .replace(CONTROL_CHARS_RE, "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
};

const sanitizeMultiLine = (value: unknown) => {
  if (typeof value !== "string") return value;
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS_RE, "")
    .trim();
};

const strSchema = () =>
  z.string({
    invalid_type_error: "Veuillez saisir un texte valide.",
    required_error: "Ce champ est requis.",
  });

const text = (max: number) =>
  z.preprocess(
    sanitizeSingleLine,
    strSchema().max(max, `${max} caractères maximum.`)
  );

const textRequired = (max: number, min = 1) =>
  z.preprocess(
    sanitizeSingleLine,
    strSchema()
      .min(
        min,
        min === 1
          ? "Ce champ est requis."
          : `Veuillez saisir au moins ${min} caractères.`
      )
      .max(max, `${max} caractères maximum.`)
  );

const longText = (max: number) =>
  z.preprocess(
    sanitizeMultiLine,
    strSchema().max(max, `${max} caractères maximum.`)
  );

const enumFr = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, {
    errorMap: () => ({ message: "Valeur non autorisée." }),
  });

// Seules les URL http(s), tel:, mailto:, ancres et chemins relatifs sont acceptées (pas de « javascript: »).
// `/(?!\/)` : un chemin relatif, mais pas « //hote » (URL relative au protocole = redirection vers un autre site).
const SAFE_URL = /^(https?:\/\/|tel:|mailto:|#|\/(?!\/))/i;
const URL_ERROR_MESSAGE =
  "URL invalide : elle doit commencer par https:// (ou http://, tel:, mailto:).";

const url = z.preprocess(
  sanitizeSingleLine,
  strSchema()
    .max(2000, "2000 caractères maximum.")
    .refine(v => v === "" || SAFE_URL.test(v), URL_ERROR_MESSAGE)
);
const urlRequired = url.refine(v => v.length > 0, "URL requise.");

const phoneOptional = z.preprocess(
  sanitizeSingleLine,
  strSchema()
    .max(30, "30 caractères maximum.")
    .refine(v => v === "" || isValidPhone(v), PHONE_ERROR_MESSAGE)
);

const blankToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);
const prix = z.preprocess(
  blankToUndef,
  z.coerce
    .number({ invalid_type_error: "Veuillez saisir un nombre entier positif." })
    .int("Veuillez saisir un nombre entier.")
    .min(0, "La valeur doit être positive.")
    .max(2_000_000_000, "Valeur trop élevée.")
    .optional()
);
const smallInt = z.preprocess(
  blankToUndef,
  z.coerce
    .number({ invalid_type_error: "Veuillez saisir un nombre entier positif." })
    .int("Veuillez saisir un nombre entier.")
    .min(0, "La valeur doit être positive.")
    .max(100_000, "Valeur trop élevée.")
    .optional()
);

export const JOURS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
] as const;

// L'API parle en minuscules (comme le front) ; la base en MAJUSCULES (enums Prisma).
export const SECTEURS = [
  "restaurant",
  "immobilier",
  "commerce",
  "hotel",
  "independant",
  "beaute",
] as const;
export const TAB_TYPES = [
  "presentation",
  "menu",
  "biens",
  "catalogue",
  "galerie",
  "videos",
  "liens",
  "rendezvous",
  "rappel",
  "horaires",
  "avis",
  "reseaux",
  "localisation",
  "texte",
] as const;

// ───────── Contenu (data) ─────────
const reseau = z.object({ label: textRequired(60), url });
const lien = z.object({ label: textRequired(80), url });
const horaire = z.object({ jour: enumFr(JOURS), horaire: text(60) });
const media = z.object({
  type: enumFr(["image", "video"]).default("image"),
  url: urlRequired,
  alt: text(200).optional(),
});

const article = z.object({
  nom: textRequired(120),
  description: longText(500).optional(),
  photo: url.optional(),
  prix,
  badge: text(30).optional(),
});
const sectionCatalogue = z.object({
  titre: textRequired(100),
  articles: z.array(article).max(50, "50 articles maximum par section."),
});

const plat = z.object({
  nom: textRequired(120),
  prix,
  description: longText(500).optional(),
  image: url.optional(),
  video: url.optional(),
  videoWebm: url.optional(),
  badge: text(30).optional(),
});
const menu = z.object({
  sections: z
    .array(
      z.object({
        titre: textRequired(100),
        plats: z.array(plat).max(50, "50 plats maximum par section."),
      })
    )
    .max(20, "20 sections de menu maximum."),
});

const bien = z.object({
  titre: textRequired(150),
  type: enumFr(["vente", "location"]),
  prix,
  periode: text(20).optional(),
  ville: text(100).optional(),
  surface: smallInt,
  terrain: smallInt,
  chambres: smallInt,
  sdb: smallInt,
  atouts: z.array(text(60)).max(20, "20 atouts maximum.").default([]),
  description: longText(1000).optional(),
  photos: z.array(urlRequired).max(20, "20 photos maximum par bien.").default([]),
});

const onglet = z.object({
  type: enumFr(TAB_TYPES),
  titre: text(60).optional(),
  contenu: longText(5000).optional(), // uniquement pour « texte »
  visible: z.boolean().default(true),
});

const entete = z.object({
  disposition: enumFr(["portrait", "logo", "banniere", "duo"]).optional(),
  taille: enumFr(["s", "m", "l"]).optional(),
  theme: enumFr(["or", "clair", "bleu", "nuit"]).optional(),
  couverture: url.optional(),
});

const dataSchema = z
  .object({
    secteur: enumFr(SECTEURS),
    premierBouton: enumFr(["whatsapp", "appel", "email"]),
    messageWhatsapp: longText(500),
    presentation: longText(5000), // la limite réelle dépend de la formule (voir fiches.limits.ts)
    reseauxSociaux: z.array(reseau).max(20, "20 réseaux sociaux maximum."),
    liens: z.array(lien).max(50, "50 liens maximum."),
    horaires: z.array(horaire).max(7, "7 jours maximum."),
    galerie: z.array(media).max(50, "50 médias maximum."),
    sections: z.array(sectionCatalogue).max(20, "20 sections maximum."),
    menu,
    biens: z.array(bien).max(100, "100 biens maximum."),
    rendezVous: z.object({ label: text(80), url }),
    onglets: z.array(onglet).max(40, "40 onglets maximum."),
    entete,
  })
  .partial();

// ───────── Mise à jour par le client ─────────
// Les champs réservés (id, slug, formule, statut, dateEcheance, scansTotal, userId…) ne figurent pas ici :
// zod les retire silencieusement, ils ne peuvent donc jamais être écrits par un client.
export const updateFicheSchema = z
  .object({
    prenom: textRequired(100),
    nom: text(100),
    fonction: text(150),
    entreprise: text(150),
    photo: url,
    logo: url,
    telephone: phoneOptional,
    whatsapp: phoneOptional,
    email: text(254).refine(
      v => v === "" || z.string().email().safeParse(v).success,
      "Adresse e-mail invalide."
    ),
    site: url,
    adresse: text(250),
    googlePlaceId: text(200),
    data: dataSchema,
    // Version vue par le client au chargement (champ `updatedAt` de la fiche). Facultatif : absent = pas de contrôle.
    baseUpdatedAt: z
      .string()
      .datetime({ message: "Horodatage de version invalide." }),
  })
  .partial();

export type UpdateFicheInput = z.infer<typeof updateFicheSchema>;

export const createFicheSchema = z.object({
  prenom: textRequired(100),
  nom: text(100).optional(),
  fonction: text(150).optional(),
  entreprise: text(150).optional(),
  telephone: phoneOptional.optional(),
  whatsapp: phoneOptional.optional(),
  secteur: enumFr(SECTEURS).optional(),
});
export type CreateFicheInput = z.infer<typeof createFicheSchema>;

export const recordPassageSchema = z.object({
  source: enumFr(["qr", "nfc", "direct"]),
  idempotencyKey: z
    .string()
    .min(16, "Clé d'idempotence invalide.")
    .max(64, "Clé d'idempotence invalide.")
    .regex(/^[a-zA-Z0-9_-]+$/, "Clé d'idempotence invalide."),
});

export const passageStatsQuerySchema = z
  .object({
    granularity: enumFr(["day", "month"]).default("month"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date attendu : AAAA-MM-JJ.")
      .optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format de mois attendu : AAAA-MM.")
      .optional(),
  })
  .refine(value => !(value.date && value.month), {
    message: "Choisissez une date ou un mois, pas les deux.",
  });

export const idParam = z.object({
  id: z.coerce.number().int().positive("Identifiant invalide."),
});
export const slugParam = z.object({
  slug: z.string().min(1, "Slug requis.").max(80, "Slug trop long."),
});

export const createRappelSchema = z.object({
  nom: textRequired(100, 2),
  telephone: z.preprocess(
    sanitizeSingleLine,
    strSchema()
      .max(30, "30 caractères maximum.")
      .refine(isValidPhone, PHONE_ERROR_MESSAGE)
  ),
  email: text(160)
    .refine(
      v => v === "" || z.string().email().safeParse(v).success,
      "Veuillez saisir une adresse e-mail valide."
    )
    .optional(),
  societe: text(120).optional(),
  website: z.string().max(200).optional(),
});

export const rappelIdParam = z.object({
  rappelId: z.coerce.number().int().positive("Identifiant invalide."),
});

export const updateRappelStatusSchema = z.object({
  statut: enumFr(["NOUVELLE", "TRAITEE"]),
});

export const rappelListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  ficheId: z.coerce.number().int().positive().optional(),
  statut: enumFr(["NOUVELLE", "TRAITEE"]).optional(),
  search: text(100).optional(),
});

export const rappelExportQuerySchema = z.object({
  ficheId: z.coerce.number().int().positive().optional(),
  statut: enumFr(["NOUVELLE", "TRAITEE"]).optional(),
  search: text(100).optional(),
});
