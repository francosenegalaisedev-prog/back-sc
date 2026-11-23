import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  parseExpiresInMs,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "./sessionCookie";

describe("sessionCookie", () => {
  it("parseExpiresInMs convertit les durées JWT en millisecondes", () => {
    expect(parseExpiresInMs("7d")).toBe(7 * 86_400_000);
    expect(parseExpiresInMs("2h")).toBe(2 * 3_600_000);
    expect(parseExpiresInMs("30m")).toBe(30 * 60_000);
    expect(parseExpiresInMs("60")).toBe(60_000);
  });

  it("pose un cookie httpOnly SameSite=lax sur path=/", () => {
    const res = { cookie: vi.fn() } as unknown as Response & {
      cookie: ReturnType<typeof vi.fn>;
    };
    setSessionCookie(res, "jwt-token-123");

    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      "jwt-token-123",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      })
    );
  });

  it("efface le cookie avec les mêmes attributs de sécurité", () => {
    const res = { clearCookie: vi.fn() } as unknown as Response & {
      clearCookie: ReturnType<typeof vi.fn>;
    };
    clearSessionCookie(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      })
    );
  });

  it("lit le cookie sc_session parmi plusieurs cookies", () => {
    const req = {
      headers: { cookie: "theme=dark; sc_session=abc.def.ghi; lang=fr" },
    } as Request;
    expect(readSessionCookie(req)).toBe("abc.def.ghi");
    expect(readSessionCookie({ headers: {} } as Request)).toBeNull();
  });
});
