import type { NextFunction, Request, Response } from "express";
import type { Role } from "../database/prisma/generated/prisma/client";
import { prisma } from "../database/prisma/prisma-client";
import { forbidden, unauthorized } from "../lib/httpError";
import { verifyToken } from "../lib/jwt";
import { logger } from "../lib/logger";
import { readSessionCookie } from "../lib/sessionCookie";

function extractAuthToken(req: Request): {
  token: string | null;
  reason?: string;
} {
  const cookieToken = readSessionCookie(req);
  if (cookieToken) return { token: cookieToken };

  const header = req.headers.authorization;
  if (!header) return { token: null, reason: "missing_authorization_header" };
  if (!header.startsWith("Bearer ")) {
    return { token: null, reason: "invalid_authorization_scheme" };
  }
  return { token: header.slice(7) };
}

// Exige une session valide (cookie httpOnly `sc_session` en priorité, ou `Authorization: Bearer <token>`)
// et recharge l'utilisateur en base (un compte supprimé ou rétrogradé perd ses droits immédiatement).
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const rejectAuthentication = (reason: string, message?: string): never => {
      logger.warn("Authentication failed", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        reason,
      });
      throw unauthorized(message);
    };

    const { token, reason } = extractAuthToken(req);
    if (!token) return rejectAuthentication(reason ?? "missing_token");

    let userId: number;
    try {
      userId = Number(verifyToken(token).sub);
    } catch {
      return rejectAuthentication(
        "invalid_or_expired_token",
        "Session invalide ou expirée"
      );
    }
    if (!Number.isSafeInteger(userId) || userId <= 0)
      return rejectAuthentication(
        "invalid_token_subject",
        "Session invalide ou expirée"
      );

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user)
      return rejectAuthentication("user_not_found", "Compte introuvable");
    if (!user.active)
      return rejectAuthentication("user_disabled", "Ce compte est désactivé");

    req.user = {
      id: user.id,
      role: user.role,
      emailVerified: user.emailVerifiedAt !== null,
      email: user.email,
      name: user.nom,
    };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role))
      return next(forbidden("ACCES_REFUSE", "Droits insuffisants"));
    next();
  };

// Authentification facultative pour les endpoints publics qui doivent distinguer
// un visiteur anonyme du propriétaire connecté. Un jeton absent ou invalide reste anonyme.
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const { token } = extractAuthToken(req);
    if (!token) return next();

    try {
      const userId = Number(verifyToken(token).sub);
      if (!Number.isSafeInteger(userId) || userId <= 0) return next();

      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (user?.active) {
        req.user = {
          id: user.id,
          role: user.role,
          emailVerified: user.emailVerifiedAt !== null,
          email: user.email,
          name: user.nom,
        };
      }
    } catch {
      // L'endpoint reste public : un jeton expiré ne bloque pas la consultation.
    }
    next();
  } catch (error) {
    next(error);
  }
}
