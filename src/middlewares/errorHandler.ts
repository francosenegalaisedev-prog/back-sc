import { Prisma } from "../database/prisma/generated/prisma/client";

import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodIssue } from "zod";
import { HttpError } from "../lib/httpError";
import { logger } from "../lib/logger";

const INTERNAL_ERROR_MESSAGE =
  "Une erreur technique est survenue. Réessayez plus tard.";
const INVALID_BODY_MESSAGE =
  "La requête est invalide. Vérifiez les données envoyées.";
const BODY_TOO_LARGE_MESSAGE =
  "La requête ou le fichier est trop volumineux.";
const RATE_LIMIT_MESSAGE =
  "Trop de requêtes. Réessayez dans quelques instants.";

/** Traduit en français clair les messages par défaut de Zod s'ils n'ont pas été personnalisés. */
function localizeZodIssue(issue: ZodIssue): string {
  const msg = issue.message;
  if (msg === "Required") return "Ce champ est requis.";
  if (msg === "Invalid email") return "Veuillez saisir une adresse e-mail valide.";
  if (msg === "Invalid url")
    return "URL invalide : elle doit commencer par https://.";
  if (/^Invalid (datetime|date)/i.test(msg)) return "Format de date invalide.";
  if (/^Invalid enum value/i.test(msg)) return "Valeur non autorisée.";
  if (/^Expected integer/i.test(msg)) return "Veuillez saisir un nombre entier.";
  if (/^Expected number/i.test(msg)) return "Veuillez saisir un nombre valide.";
  if (/^Expected string/i.test(msg)) return "Veuillez saisir un texte valide.";
  if (/^Expected boolean/i.test(msg)) return "Valeur booléenne attendue.";

  const minStr = msg.match(/^String must contain at least (\d+) character/i);
  if (minStr) {
    const n = Number(minStr[1]);
    return n <= 1
      ? "Ce champ est requis."
      : `Veuillez saisir au moins ${n} caractères.`;
  }
  const maxStr = msg.match(/^String must contain at most (\d+) character/i);
  if (maxStr) return `${maxStr[1]} caractères maximum.`;

  const minNum = msg.match(/^Number must be greater than or equal to (-?\d+)/i);
  if (minNum) return `La valeur doit être supérieure ou égale à ${minNum[1]}.`;
  const maxNum = msg.match(/^Number must be less than or equal to (-?\d+)/i);
  if (maxNum) return `La valeur doit être inférieure ou égale à ${maxNum[1]}.`;

  const maxArr = msg.match(/^Array must contain at most (\d+) element/i);
  if (maxArr) return `${maxArr[1]} éléments maximum.`;

  return msg;
}

function prismaUniqueMessage(target: unknown): string {
  const fields = Array.isArray(target)
    ? target.map(String).join(",").toLowerCase()
    : String(target ?? "").toLowerCase();
  if (fields.includes("email")) return "Cette adresse e-mail est déjà utilisée.";
  if (fields.includes("slug")) return "Ce lien de fiche est déjà utilisé.";
  return "Cette valeur est déjà utilisée.";
}

type RequestBodyError = Error & { type?: string };

function requestBodyError(err: unknown) {
  if (!(err instanceof Error)) return null;
  const type = (err as RequestBodyError).type;
  if (type === "entity.parse.failed")
    return {
      status: 400,
      code: "CORPS_REQUETE_INVALIDE",
      message: INVALID_BODY_MESSAGE,
    };
  if (type === "entity.too.large")
    return {
      status: 413,
      code: "REQUETE_TROP_VOLUMINEUSE",
      message: BODY_TOO_LARGE_MESSAGE,
    };
  return null;
}

export function notFoundHandler(_req: Request, res: Response) {
  res
    .status(404)
    .json({
      error: { code: "ROUTE_INTROUVABLE", message: "Route introuvable" },
    });
}

export function rateLimitHandler(req: Request, res: Response) {
  logger.warn("Request rate limit exceeded", {
    requestId: res.locals.requestId,
    method: req.method,
    path: req.path,
    statusCode: 429,
    userId: req.user?.id,
  });
  return res.status(429).json({
    error: { code: "TROP_DE_REQUETES", message: RATE_LIMIT_MESSAGE },
  });
}

// Format d'erreur unique : { error: { code, message, details? } }
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    if (err.status >= 500) {
      logger.error("Request failed with a server error", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        statusCode: err.status,
        errorCode: err.code,
        userId: req.user?.id,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      return res.status(err.status).json({
        error: {
          code: "ERREUR_SERVEUR",
          message: INTERNAL_ERROR_MESSAGE,
        },
      });
    }
    logger.warn("Request rejected", {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.path,
      statusCode: err.status,
      errorCode: err.code,
      userId: req.user?.id,
    });
    return res
      .status(err.status)
      .json({
        error: { code: err.code, message: err.message, details: err.details },
      });
  }
  const bodyError = requestBodyError(err);
  if (bodyError) {
    logger.warn("Request body rejected", {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.path,
      statusCode: bodyError.status,
      errorCode: bodyError.code,
      userId: req.user?.id,
    });
    return res.status(bodyError.status).json({
      error: { code: bodyError.code, message: bodyError.message },
    });
  }
  if (err instanceof ZodError) {
    const details = err.issues.map(i => ({
      champ: i.path.join("."),
      message: localizeZodIssue(i),
    }));
    logger.warn("Request validation failed", {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.path,
      statusCode: 400,
      userId: req.user?.id,
      issues: details,
    });
    return res.status(400).json({
      error: {
        code: "DONNEES_INVALIDES",
        message:
          details[0]?.message ??
          "Certaines informations saisies sont invalides.",
        details,
      },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      logger.warn("Request rejected due to duplicate value", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        statusCode: 409,
        errorCode: "DEJA_UTILISE",
        prismaCode: err.code,
        target: err.meta?.target,
        userId: req.user?.id,
      });
      return res.status(409).json({
        error: {
          code: "DEJA_UTILISE",
          message: prismaUniqueMessage(err.meta?.target),
        },
      });
    }
    if (err.code === "P2025") {
      logger.warn("Requested record not found", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        statusCode: 404,
        prismaCode: err.code,
        userId: req.user?.id,
      });
      return res.status(404).json({
        error: {
          code: "INTROUVABLE",
          message: "Élément introuvable ou déjà supprimé.",
        },
      });
    }
    if (err.code === "P2003") {
      logger.warn("Request rejected due to foreign key constraint", {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.path,
        statusCode: 409,
        prismaCode: err.code,
        userId: req.user?.id,
      });
      return res.status(409).json({
        error: {
          code: "REFERENCE_INVALIDE",
          message:
            "Impossible d'effectuer cette action car cet élément est lié à d'autres données.",
        },
      });
    }
  }
  logger.error("Unhandled request error", {
    requestId: res.locals.requestId,
    method: req.method,
    path: req.path,
    userId: req.user?.id,
    error:
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : String(err),
  });
  res.status(500).json({
    error: {
      code: "ERREUR_SERVEUR",
      message: INTERNAL_ERROR_MESSAGE,
    },
  });
}
