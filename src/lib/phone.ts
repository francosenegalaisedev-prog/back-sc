const RAW_PHONE_ALLOWED = /^[0-9+\s().-]+$/;
// Préfixes mobiles (70, 71, 75, 76, 77, 78) et fixes (30, 33) sénégalais : 9 chiffres.
const SENEGAL_LOCAL_RE = /^(70|71|75|76|77|78|33|30)\d{7}$/;
// Format international E.164 (indicatif pays + numéro : 7 à 15 chiffres au total).
const INTERNATIONAL_E164_RE = /^\+[1-9]\d{6,14}$/;

export const PHONE_ERROR_MESSAGE =
  "Numéro invalide (ex. 77 123 45 67, +221 78 123 45 67 ou +33 6 12 34 56 78).";

/**
 * Supprime les séparateurs visuels (espaces, tirets, points, parenthèses)
 * et normalise un préfixe international `00` en `+`.
 */
export function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]+/g, "");
  if (compact.startsWith("00")) {
    return `+${compact.slice(2)}`;
  }
  return compact;
}

/**
 * Valide un numéro de téléphone :
 * - Sénégal en format local (9 chiffres : 70, 71, 75, 76, 77, 78, 30, 33)
 * - Sénégal en format international (+221 / 221 / 00221 + 9 chiffres valides)
 * - International (autres pays en E.164 : +indicatif puis 7 à 15 chiffres)
 */
export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !RAW_PHONE_ALLOWED.test(trimmed)) return false;

  const normalized = normalizePhone(trimmed);

  // Sénégal avec indicatif (+221 ou 221)
  if (normalized.startsWith("+221")) {
    return SENEGAL_LOCAL_RE.test(normalized.slice(4));
  }
  if (normalized.startsWith("221") && normalized.length >= 11) {
    return SENEGAL_LOCAL_RE.test(normalized.slice(3));
  }

  // Sénégal local sans indicatif (9 chiffres)
  if (!normalized.startsWith("+")) {
    return SENEGAL_LOCAL_RE.test(normalized);
  }

  // Autres pays (E.164)
  return INTERNATIONAL_E164_RE.test(normalized);
}
