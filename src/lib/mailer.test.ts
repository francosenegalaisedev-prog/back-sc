import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMailMock, verifyMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const verifyMock = vi.fn();
  const createTransportMock = vi.fn(() => ({
    sendMail: sendMailMock,
    verify: verifyMock,
  }));
  return { sendMailMock, verifyMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock,
  },
}));

vi.mock("./authTokens", () => ({
  createAuthToken: vi.fn().mockResolvedValue("mock-token-123"),
}));

import {
  resetMailTransportForTests,
  sendCallbackRequestEmail,
  sendCardOrderEmail,
  sendForgotPasswordMail,
  sendMail,
  sendSecurityAlertEmail,
  sendSubscriptionConfirmedEmail,
  verifyMailTransport,
} from "./mailer";
import { formatGreeting, isPublicImageUrl } from "./mailer/base-layout";
import { verificationEmailTemplate } from "./mailer/verification-template";

describe("mailer helpers", () => {
  it("formats greeting cleanly without double 'Bonjour'", () => {
    expect(formatGreeting("Awa")).toBe("Bonjour Awa,");
    expect(formatGreeting("  ")).toBe("Bonjour,");
    expect(formatGreeting(null)).toBe("Bonjour,");
    expect(formatGreeting(undefined)).toBe("Bonjour,");
  });

  it("rejects private/Docker/local image URLs for email logos", () => {
    expect(isPublicImageUrl("http://172.17.0.2:8333/ficheimage/logo.png")).toBe(
      false,
    );
    expect(isPublicImageUrl("http://localhost:5173/images/Logo.png")).toBe(
      false,
    );
    expect(isPublicImageUrl("https://www.logcard.io/images/Logo.png")).toBe(
      true,
    );
    expect(isPublicImageUrl("")).toBe(false);
  });

  it("renders verification template without internal S3_ENDPOINT URL", () => {
    const html = verificationEmailTemplate(
      "https://www.logcard.io/images/Logo.png",
      "Awa",
      "https://www.logcard.io/verify-email?token=abc",
      "24 heures",
    );
    expect(html).toContain("https://www.logcard.io/images/Logo.png");
    expect(html).toContain("Bonjour Awa,");
    expect(html).not.toContain("172.17.");
  });
});

describe("mailer delivery & error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMailTransportForTests();
  });

  it("throws 502 Bad Gateway on SMTP failure in strict mode", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("SMTP ECONNREFUSED"));

    await expect(
      sendMail({
        to: "client@example.com",
        subject: "Test strict",
        html: "<p>Hi</p>",
        text: "Hi",
      }),
    ).rejects.toMatchObject({ status: 502, code: "EMAIL_DELIVERY_FAILED" });
  });

  it("resolves to false on SMTP failure in bestEffort mode", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("SMTP timeout"));

    const ok = await sendMail(
      {
        to: "client@example.com",
        subject: "Test best effort",
        html: "<p>Hi</p>",
        text: "Hi",
      },
      { bestEffort: true },
    );
    expect(ok).toBe(false);
  });

  it("configures Nodemailer with timeouts and sender defaults", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "1" });
    await sendForgotPasswordMail({
      id: 7,
      email: "user@example.com",
      nom: "Moussa",
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }),
    );
    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.from.address).not.toContain("no-replay");
    expect(payload.from.name).not.toBe("Mailtrap Test");
    expect(payload.to).toBe("user@example.com");
  });

  it("escapes HTML in callback, card order, security alert and subscription emails", async () => {
    sendMailMock.mockResolvedValue({ messageId: "ok" });

    await sendCallbackRequestEmail({
      to: "owner@example.com",
      ownerName: null,
      ficheName: "<b>Studio</b>",
      visitorName: "<script>alert(1)</script>",
      visitorPhone: "+221770000000",
    });
    const cbCall = sendMailMock.mock.calls[0][0];
    expect(cbCall.html).toContain("Bonjour,");
    expect(cbCall.html).not.toContain("Bonjour Bonjour");
    expect(cbCall.html).not.toContain("<script>");
    expect(cbCall.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");

    await sendCardOrderEmail({
      to: "owner@example.com",
      ownerName: "Awa",
      ficheName: "Chez Awa",
      orderId: 42,
      statut: "traitee",
      montantFcfa: 15_000,
      adresseLivraison: "Dakar Plateau",
    });
    expect(sendMailMock.mock.calls[1][0].subject).toContain("#42");

    await sendSecurityAlertEmail({
      to: "owner@example.com",
      name: "Awa",
      event: "2fa_enabled",
    });
    expect(sendMailMock.mock.calls[2][0].subject).toContain("2FA");

    await sendSubscriptionConfirmedEmail({
      to: "owner@example.com",
      name: "Awa",
      ficheName: "Chez Awa",
      planName: "Pro",
      amountFcfa: 2500,
      endsAt: new Date("2027-01-01T00:00:00Z"),
      reference: "SIM-123",
    });
    expect(sendMailMock.mock.calls[3][0].subject).toContain("Pro");
  });

  it("verifyMailTransport returns boolean without throwing", async () => {
    verifyMock.mockResolvedValueOnce(true);
    expect(await verifyMailTransport()).toBe(true);

    verifyMock.mockRejectedValueOnce(new Error("down"));
    expect(await verifyMailTransport()).toBe(false);
  });
});
