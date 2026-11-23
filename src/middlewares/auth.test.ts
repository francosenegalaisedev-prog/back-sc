import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  verifyToken: vi.fn(),
}));

vi.mock("../database/prisma/prisma-client", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock("../lib/jwt", () => ({
  verifyToken: mocks.verifyToken,
}));

import { optionalAuth, requireAuth } from "./auth";

describe("auth middleware (cookie httpOnly + Bearer fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requireAuth authentifie via le cookie sc_session sans en-tête Authorization", async () => {
    mocks.verifyToken.mockReturnValue({ sub: "42" });
    mocks.userFindUnique.mockResolvedValue({
      id: 42,
      role: "CLIENT",
      email: "awa@exemple.sn",
      nom: "Awa",
      active: true,
      emailVerifiedAt: new Date(),
    });

    const req = {
      method: "GET",
      path: "/api/auth/me",
      headers: { cookie: "sc_session=valid-cookie-jwt" },
    } as unknown as Request;
    const res = { locals: { requestId: "req-1" } } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(mocks.verifyToken).toHaveBeenCalledWith("valid-cookie-jwt");
    expect(req.user).toMatchObject({ id: 42, role: "CLIENT" });
    expect(next).toHaveBeenCalledWith();
  });

  it("optionalAuth identifie le propriétaire via le cookie sc_session", async () => {
    mocks.verifyToken.mockReturnValue({ sub: "42" });
    mocks.userFindUnique.mockResolvedValue({
      id: 42,
      role: "CLIENT",
      email: "awa@exemple.sn",
      nom: "Awa",
      active: true,
      emailVerifiedAt: null,
    });

    const req = {
      headers: { cookie: "sc_session=valid-cookie-jwt" },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as unknown as NextFunction;

    await optionalAuth(req, res, next);

    expect(req.user).toMatchObject({ id: 42, role: "CLIENT" });
    expect(next).toHaveBeenCalledWith();
  });
});
