import { describe, expect, it } from "vitest";
import { isValidPhone, normalizePhone } from "./phone";

describe("phone validation (Sénégal + international)", () => {
  it("accepte les préfixes mobiles sénégalais (70, 71, 75, 76, 77, 78) et fixes (33, 30)", () => {
    for (const prefix of ["70", "71", "75", "76", "77", "78", "33", "30"]) {
      expect(isValidPhone(`${prefix} 123 45 67`)).toBe(true);
      expect(isValidPhone(`+221 ${prefix} 123-45.67`)).toBe(true);
      expect(isValidPhone(`00221 ${prefix}1234567`)).toBe(true);
      expect(isValidPhone(`221${prefix}1234567`)).toBe(true);
    }
  });

  it("accepte les numéros internationaux d'autres pays au format +indicatif", () => {
    expect(isValidPhone("+33 6 12 34 56 78")).toBe(true);
    expect(isValidPhone("0033 6 12 34 56 78")).toBe(true);
    expect(isValidPhone("+1 (555) 123-4567")).toBe(true);
    expect(isValidPhone("+225 07 07 12 34 56")).toBe(true);
    expect(isValidPhone("+212 6 12 34 56 78")).toBe(true);
  });

  it("refuse les numéros sénégalais invalides ou mal formés", () => {
    expect(isValidPhone("79 123 45 67")).toBe(false);
    expect(isValidPhone("+221 79 123 45 67")).toBe(false);
    expect(isValidPhone("+221 77 123 45")).toBe(false);
    expect(isValidPhone("77 123 45 67 89")).toBe(false);
  });

  it("refuse les chaînes non numériques ou trop courtes", () => {
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone("bonjour")).toBe(false);
    expect(isValidPhone("77 123 45 abc")).toBe(false);
    expect(isValidPhone("+123")).toBe(false);
    expect(isValidPhone("123456")).toBe(false);
  });

  it("normalise les séparateurs et le préfixe 00", () => {
    expect(normalizePhone("00221 77 123-45.67")).toBe("+221771234567");
    expect(normalizePhone(" +33 (6) 12 34 56 78 ")).toBe("+33612345678");
  });
});
