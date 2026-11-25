import bcrypt from "bcryptjs";
import { generate, generateSecret } from "otplib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../database/prisma/prisma-client", () => ({
  prisma: prismaMock,
}));

import { decryptSecret, encryptSecret } from "../../lib/crypto.lib";
import { signToken, signTwoFaToken, verifyToken, verifyTwoFaToken } from "../../lib/jwt";
import { hashPassword } from "../../lib/password";
import { twoFaService } from "./twoFa.service";

describe("2FA crypto & JWT helpers", () => {
  it("encrypts and decrypts secrets with random IVs", () => {
    const secret = generateSecret();
    const cipher1 = encryptSecret(secret);
    const cipher2 = encryptSecret(secret);

    expect(cipher1).not.toBe(cipher2);
    expect(decryptSecret(cipher1)).toBe(secret);
    expect(decryptSecret(cipher2)).toBe(secret);
    expect(() => decryptSecret("invalid")).toThrow();
  });

  it("isolates 2FA pending tokens from regular session tokens", () => {
    const tempToken = signTwoFaToken(42, "CLIENT");
    const decoded = verifyTwoFaToken(tempToken);
    expect(decoded).toEqual({
      sub: "42",
      purpose: "2fa_pending",
      expectedRole: "CLIENT",
    });

    // Un token 2fa_pending ne doit JAMAIS passer verifyToken (requireAuth)
    expect(() => verifyToken(tempToken)).toThrow();

    // Un token de session normal ne doit pas passer verifyTwoFaToken
    const sessionToken = signToken(42);
    expect(verifyToken(sessionToken)).toEqual({ sub: "42" });
    expect(() => verifyTwoFaToken(sessionToken)).toThrow();
  });
});

describe("twoFaService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("setup2fa generates a QR code, encrypts secret and rejects if already enabled", async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: false,
    });
    prismaMock.user.update.mockResolvedValueOnce({});

    const res = await twoFaService.setup2fa(1, "user@example.com");
    expect(res.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(res.manualKey).toBeTruthy();

    const updateCall = prismaMock.user.update.mock.calls[0][0];
    expect(updateCall.data.two_fa_enabled).toBe(false);
    expect(decryptSecret(updateCall.data.two_fa_secret)).toBe(res.manualKey);

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: true,
    });
    await expect(twoFaService.setup2fa(1, "user@example.com")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("confirmAndEnable2FA rejects invalid OTP and accepts valid OTP", async () => {
    const secret = generateSecret();
    const encrypted = encryptSecret(secret);

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: false,
      two_fa_secret: encrypted,
    });

    await expect(
      twoFaService.confirmAndEnable2FA(1, "000000"),
    ).rejects.toMatchObject({ status: 422 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();

    const validOtp = await generate({ secret });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: false,
      two_fa_secret: encrypted,
    });
    prismaMock.user.update.mockResolvedValueOnce({});

    const res = await twoFaService.confirmAndEnable2FA(1, validOtp);
    expect(res.recoveryCodes).toHaveLength(8);
    expect(res.recoveryCodes[0]).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);

    const updateCall = prismaMock.user.update.mock.calls[0][0];
    expect(updateCall.data.two_fa_enabled).toBe(true);
    expect(updateCall.data.two_fa_recovery_codes).toHaveLength(8);
  });

  it("verifyLogin2FA validates OTP, enforces 30s anti-replay, and consumes recovery codes", async () => {
    const secret = generateSecret();
    const encrypted = encryptSecret(secret);
    const validOtp = await generate({ secret });

    // Valid OTP
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: true,
      two_fa_secret: encrypted,
      two_fa_last_used_at: null,
      two_fa_recovery_codes: [],
    });
    prismaMock.user.update.mockResolvedValueOnce({});
    expect(await twoFaService.verifyLogin2FA(1, validOtp)).toBe(true);

    // Anti-replay within 30s
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: true,
      two_fa_secret: encrypted,
      two_fa_last_used_at: new Date(),
      two_fa_recovery_codes: [],
    });
    await expect(twoFaService.verifyLogin2FA(1, validOtp)).rejects.toMatchObject({
      status: 409,
    });

    // Invalid OTP returns false
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: true,
      two_fa_secret: encrypted,
      two_fa_last_used_at: new Date(Date.now() - 60_000),
      two_fa_recovery_codes: [],
    });
    expect(await twoFaService.verifyLogin2FA(1, "123456")).toBe(false);

    // Recovery code (case-insensitive, single use)
    const hash1 = await bcrypt.hash("ABCD-1234", 4);
    const hash2 = await bcrypt.hash("EFGH-5678", 4);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: true,
      two_fa_secret: encrypted,
      two_fa_last_used_at: null,
      two_fa_recovery_codes: [hash1, hash2],
    });
    prismaMock.user.update.mockResolvedValueOnce({});

    expect(await twoFaService.verifyLogin2FA(1, "abcd-1234")).toBe(true);
    expect(prismaMock.user.update).toHaveBeenLastCalledWith({
      where: { id: 1 },
      data: { two_fa_recovery_codes: [hash2] },
    });
  });

  it("disable2FA verifies password for classic accounts and OTP for Google-only accounts", async () => {
    const passwordHash = await hashPassword("Secret1234!");

    // Wrong password
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: true,
      passwordHash,
    });
    await expect(
      twoFaService.disable2FA(1, { password: "WrongPassword" }),
    ).rejects.toMatchObject({ status: 422 });

    // Correct password
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 1,
      two_fa_enabled: true,
      passwordHash,
    });
    prismaMock.user.update.mockResolvedValueOnce({});
    expect(await twoFaService.disable2FA(1, { password: "Secret1234!" })).toEqual({
      ok: true,
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        two_fa_enabled: false,
        two_fa_secret: null,
        two_fa_recovery_codes: [],
        two_fa_last_used_at: null,
      },
    });

    // Google-only account (passwordHash: null) using valid OTP
    const secret = generateSecret();
    const encrypted = encryptSecret(secret);
    const validOtp = await generate({ secret });
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: 2,
        two_fa_enabled: true,
        passwordHash: null,
      })
      .mockResolvedValueOnce({
        id: 2,
        two_fa_enabled: true,
        two_fa_secret: encrypted,
        two_fa_last_used_at: null,
        two_fa_recovery_codes: [],
      });
    prismaMock.user.update.mockResolvedValue({});

    expect(await twoFaService.disable2FA(2, { code: validOtp })).toEqual({
      ok: true,
    });
  });
});
