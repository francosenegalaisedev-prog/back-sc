import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Prisma } from "../database/prisma/generated/prisma/client";
import { HttpError } from "../lib/httpError";
import { logger } from "../lib/logger";
import { errorHandler, rateLimitHandler } from "./errorHandler";

const request = {
  method: "POST",
  path: "/api/fiches",
  user: { id: 17 },
} as Request;

function response(headersSent = false) {
  return {
    locals: { requestId: "request-123" },
    headersSent,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => vi.restoreAllMocks());

describe("errorHandler", () => {
  it("logs unknown technical errors and returns no internal details", () => {
    const log = vi.spyOn(logger, "error");
    const res = response();
    const error = new Error("postgres://internal-host/password");

    errorHandler(error, request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "ERREUR_SERVEUR",
        message: "Une erreur technique est survenue. Réessayez plus tard.",
      },
    });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(
      "internal-host",
    );
    expect(log).toHaveBeenCalledWith(
      "Unhandled request error",
      expect.objectContaining({
        requestId: "request-123",
        error: expect.objectContaining({
          message: "postgres://internal-host/password",
        }),
      }),
    );
  });

  it("masque aussi les HttpError de catégorie serveur", () => {
    const res = response();
    const log = vi.spyOn(logger, "error");

    errorHandler(
      new HttpError(503, "DB_INDISPONIBLE", "Connexion PostgreSQL refusée"),
      request,
      res,
      vi.fn() as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "ERREUR_SERVEUR",
        message: "Une erreur technique est survenue. Réessayez plus tard.",
      },
    });
    expect(log).toHaveBeenCalledWith(
      "Request failed with a server error",
      expect.objectContaining({ errorCode: "DB_INDISPONIBLE" }),
    );
  });

  it("conserve le message et les détails des erreurs métier contrôlées", () => {
    const res = response();

    errorHandler(
      new HttpError(422, "FICHE_INVALIDE", "Certains champs sont invalides", [
        { champ: "prenom", message: "Le prénom est obligatoire." },
      ]),
      request,
      res,
      vi.fn() as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "FICHE_INVALIDE",
        message: "Certains champs sont invalides",
        details: [{ champ: "prenom", message: "Le prénom est obligatoire." }],
      },
    });
  });

  it.each([
    ["entity.parse.failed", 400, "CORPS_REQUETE_INVALIDE"],
    ["entity.too.large", 413, "REQUETE_TROP_VOLUMINEUSE"],
  ])("normalise les erreurs de corps %s", (type, status, code) => {
    const res = response();
    const error = Object.assign(new Error("parser internals"), { type });

    errorHandler(error, request, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(status);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(
      "parser internals",
    );
    expect(res.json).toHaveBeenCalledWith({
      error: expect.objectContaining({ code }),
    });
  });

  it("transmet l'erreur à Express si la réponse a déjà commencé", () => {
    const next = vi.fn();
    const res = response(true);
    const error = new Error("stream failed");

    errorHandler(error, request, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("traduit les erreurs Zod en français clair et remonte le 1er message explicite", () => {
    const res = response();
    const schema = z.object({
      email: z.string().email(),
      nom: z.string().min(2),
    });
    const parsed = schema.safeParse({ email: "mauvais", nom: "A" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      errorHandler(parsed.error, request, res, vi.fn() as NextFunction);
    }

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "DONNEES_INVALIDES",
        message: "Veuillez saisir une adresse e-mail valide.",
        details: [
          { champ: "email", message: "Veuillez saisir une adresse e-mail valide." },
          { champ: "nom", message: "Veuillez saisir au moins 2 caractères." },
        ],
      },
    });
  });

  it("renvoie des messages clairs pour les erreurs Prisma P2002 et P2025 sans exposer de détails techniques", () => {
    const resDup = response();
    const dupErr = new Prisma.PrismaClientKnownRequestError("Unique failed", {
      code: "P2002",
      clientVersion: "7.0.0",
      meta: { target: ["email"] },
    });
    errorHandler(dupErr, request, resDup, vi.fn() as NextFunction);
    expect(resDup.status).toHaveBeenCalledWith(409);
    expect(resDup.json).toHaveBeenCalledWith({
      error: {
        code: "DEJA_UTILISE",
        message: "Cette adresse e-mail est déjà utilisée.",
      },
    });

    const resMissing = response();
    const missingErr = new Prisma.PrismaClientKnownRequestError("Not found", {
      code: "P2025",
      clientVersion: "7.0.0",
    });
    errorHandler(missingErr, request, resMissing, vi.fn() as NextFunction);
    expect(resMissing.status).toHaveBeenCalledWith(404);
    expect(resMissing.json).toHaveBeenCalledWith({
      error: {
        code: "INTROUVABLE",
        message: "Élément introuvable ou déjà supprimé.",
      },
    });
  });
});

describe("rateLimitHandler", () => {
  it("renvoie une réponse JSON claire et journalise la requête", () => {
    const log = vi.spyOn(logger, "warn");
    const res = response();

    rateLimitHandler(request, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "TROP_DE_REQUETES",
        message: "Trop de requêtes. Réessayez dans quelques instants.",
      },
    });
    expect(log).toHaveBeenCalledWith(
      "Request rate limit exceeded",
      expect.objectContaining({ requestId: "request-123" }),
    );
  });
});
