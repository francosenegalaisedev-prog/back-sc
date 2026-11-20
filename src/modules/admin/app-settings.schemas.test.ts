import { describe, expect, it } from "vitest";
import { updateAppSettingsSchema } from "./app-settings.schemas";

const validPayload = {
  platformName: "Support Connecté",
  supportEmail: "support@supportconnecte.sn",
  supportPhone: "+221 77 000 00 00",
  socialLinks: {
    instagram: "https://instagram.com/supportconnecte",
    facebook: "https://facebook.com/supportconnecte",
    linkedin: "",
  },
  maintenance: false,
};

describe("updateAppSettingsSchema", () => {
  it("accepts a valid payload and trims strings", () => {
    const parsed = updateAppSettingsSchema.parse({
      ...validPayload,
      platformName: "  Support Connecté  ",
      supportEmail: "",
    });
    expect(parsed.platformName).toBe("Support Connecté");
    expect(parsed.supportEmail).toBe("");
  });

  it("rejects non-HTTPS social links and unknown fields", () => {
    expect(() =>
      updateAppSettingsSchema.parse({
        ...validPayload,
        socialLinks: {
          ...validPayload.socialLinks,
          instagram: "http://instagram.com/insecure",
        },
      }),
    ).toThrow();

    expect(() =>
      updateAppSettingsSchema.parse({
        ...validPayload,
        unexpectedField: true,
      }),
    ).toThrow();
  });
});
