import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env";

export const SESSION_COOKIE_NAME = "sc_session";

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Convertit une durée type "7d", "12h", "30m" ou un nombre de secondes en millisecondes. */
export function parseExpiresInMs(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const match = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!match) return DEFAULT_MAX_AGE_MS;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (multipliers[unit] ?? 1000);
}

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: parseExpiresInMs(env.JWT_EXPIRES_IN),
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _ignored, ...clearOpts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, clearOpts);
}

/** Extrait la valeur du cookie de session `sc_session` depuis l'en-tête `Cookie` sans dépendance externe. */
export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;

  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
