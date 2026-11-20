import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "./auth.schemas";

describe("auth.schemas", () => {
  it("normalizes email and enforces minimum password length on register", () => {
    const parsed = registerSchema.parse({
      email: "  Awa@Exemple.SN ",
      password: "Password123",
      nom: " Awa ",
    });
    expect(parsed.email).toBe("awa@exemple.sn");
    expect(parsed.nom).toBe("Awa");

    expect(() =>
      registerSchema.parse({ email: "awa@exemple.sn", password: "short" }),
    ).toThrow();
  });

  it("validates login, profile update and password change", () => {
    expect(
      loginSchema.parse({ email: "USER@EXEMPLE.SN", password: "x" }).email,
    ).toBe("user@exemple.sn");

    expect(() =>
      updateProfileSchema.parse({
        nom: "A",
        email: "awa@exemple.sn",
      }),
    ).toThrow();

    expect(() =>
      changePasswordSchema.parse({
        currentPassword: "old",
        password: "123",
      }),
    ).toThrow();
  });
});
