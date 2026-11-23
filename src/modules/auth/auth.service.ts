import type { User } from "../../database/prisma/generated/prisma/client";
import { prisma } from "../../database/prisma/prisma-client";
import { consumeAuthToken } from "../../lib/authTokens";
import { verifyGoogleIdToken } from "../../lib/googleAuth";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unauthorized,
  unprocessable,
} from "../../lib/httpError";
import { signToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";
import {
  sendForgotPasswordMail,
  sendVerificationEmail,
} from "../../lib/mailer";
import { hashPassword, verifyPassword } from "../../lib/password";

export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  nom: u.nom,
  role: u.role,
  emailVerified: u.emailVerifiedAt !== null,
  hasPassword: u.passwordHash !== null,
});

// Hash factice : on compare toujours un mot de passe, même si l'e-mail n'existe pas (limite l'énumération par le temps de réponse).
const DUMMY_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5vLq6o3k1p6n4wP6b4v0Y0o0o0o0o0o";

export const AuthService = {
  // ? Register
  register: async (input: {
    email: string;
    password: string;
    nom?: string;
  }) => {
    const exists = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (exists)
      throw conflict(
        "EMAIL_DEJA_UTILISE",
        "Un compte existe déjà avec cet e-mail",
      );

    // Le rôle n'est JAMAIS pris dans la requête : toute inscription = CLIENT.
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash: await hashPassword(input.password),
        nom: input.nom,
        role: "CLIENT",
      },
    });

    logger.info("User registered", { userId: user.id });
    await sendVerificationEmail(user);
    return { user: publicUser(user), token: signToken(user.id) };
  },

  // Login
  login: async (
    input: { email: string; password: string },
    expectedRole?: "CLIENT" | "ADMIN",
  ) => {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });
    const ok = await verifyPassword(
      input.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    if (!user || !ok) {
      logger.warn("Authentication failed", { reason: "invalid_credentials" });
      throw unauthorized("E-mail ou mot de passe incorrect");
    }
    if (!user.active) {
      if (
        user.deletionScheduledAt &&
        user.deletionRequestedBy === "USER" &&
        user.deletionScheduledAt > new Date()
      ) {
        const formatted = new Intl.DateTimeFormat("fr-FR", {
          dateStyle: "long",
        }).format(user.deletionScheduledAt);
        throw forbidden(
          "COMPTE_EN_COURS_DE_SUPPRESSION",
          `Votre compte est programmé pour suppression définitive le ${formatted}. Vous pouvez annuler cette demande pour le réactiver.`,
          {
            deletionScheduledAt: user.deletionScheduledAt.toISOString(),
            canCancel: true,
          },
        );
      }
      logger.warn("Authentication failed", {
        reason: "account_disabled",
        userId: user.id,
      });
      throw unauthorized("E-mail ou mot de passe incorrect");
    }
    // Un espace ne peut accepter que le rôle prévu : un client ne peut pas entrer dans /admin.
    if (expectedRole && user.role !== expectedRole) {
      logger.warn("Authentication failed", {
        reason: "wrong_role_for_space",
        userId: user.id,
        expectedRole,
      });
      throw unauthorized("Identifiants invalides");
    }
    logger.info("User authenticated", { userId: user.id });
    return { user: publicUser(user), token: signToken(user.id) };
  },

  // Login with Google
  loginWithGoogle: async (credential: string) => {
    const identity = await verifyGoogleIdToken(credential);

    // 1. Recherche prioritaire par googleId (immuable)
    let user = await prisma.user.findUnique({
      where: { googleId: identity.googleId },
    });

    // 2. Sinon recherche par e-mail pour lier un compte existant
    if (!user) {
      const byEmail = await prisma.user.findUnique({
        where: { email: identity.email },
      });
      if (byEmail) {
        if (byEmail.role !== "CLIENT") {
          logger.warn("Google auth rejected for non-client role", {
            userId: byEmail.id,
          });
          throw unauthorized("Connexion Google non autorisée pour ce compte.");
        }
        if (byEmail.googleId && byEmail.googleId !== identity.googleId) {
          throw conflict(
            "COMPTE_GOOGLE_DEJA_LIE",
            "Cet e-mail est déjà associé à un autre compte Google.",
          );
        }
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: identity.googleId,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
            nom: byEmail.nom || identity.nom || null,
          },
        });
      } else {
        // 3. Nouveau compte CLIENT (rôle forcé côté serveur, e-mail déjà vérifié par Google)
        user = await prisma.user.create({
          data: {
            email: identity.email,
            googleId: identity.googleId,
            passwordHash: null,
            nom: identity.nom || null,
            role: "CLIENT",
            emailVerifiedAt: new Date(),
          },
        });
        logger.info("User registered via Google", { userId: user.id });
      }
    }

    if (!user.active) {
      if (
        user.deletionScheduledAt &&
        user.deletionRequestedBy === "USER" &&
        user.deletionScheduledAt > new Date()
      ) {
        const formatted = new Intl.DateTimeFormat("fr-FR", {
          dateStyle: "long",
        }).format(user.deletionScheduledAt);
        throw forbidden(
          "COMPTE_EN_COURS_DE_SUPPRESSION",
          `Votre compte est programmé pour suppression définitive le ${formatted}. Vous pouvez annuler cette demande pour le réactiver.`,
          {
            deletionScheduledAt: user.deletionScheduledAt.toISOString(),
            canCancel: true,
          },
        );
      }
      throw unauthorized("Ce compte est désactivé.");
    }
    if (user.role !== "CLIENT") {
      throw unauthorized("Connexion Google non autorisée pour ce compte.");
    }

    logger.info("User authenticated via Google", { userId: user.id });
    return { user: publicUser(user), token: signToken(user.id) };
  },

  verifyEmail: async (token: string) => {
    const userId = await consumeAuthToken(token, "verify_email");
    if (!userId) throw badRequest("TOKEN_INVALIDE", "Lien invalide ou expiré");
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    logger.info("User email verified", { userId });
  },

  // ==========================================
  resendVerification: async (userId: number) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) {
      logger.info("Verification email request skipped", {
        userId,
        reason: "email_already_verified",
      });
      return;
    }
    await sendVerificationEmail(user);
    logger.info("Verification email resent", { userId });
  },

  updateProfile: async (
    userId: number,
    input: { nom: string; email: string },
  ) => {
    const current = await prisma.user.findUnique({ where: { id: userId } });
    if (!current) throw notFound("Compte introuvable");
    const emailChanged = current.email !== input.email;
    if (emailChanged) {
      const emailOwner = await prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (emailOwner && emailOwner.id !== userId) {
        throw conflict(
          "EMAIL_DEJA_UTILISE",
          "Cette adresse e-mail est déjà associée à un compte.",
        );
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        nom: input.nom,
        ...(emailChanged ? { email: input.email, emailVerifiedAt: null } : {}),
      },
    });
    if (emailChanged) await sendVerificationEmail(user);
    return publicUser(user);
  },

  changePassword: async (
    userId: number,
    input: { currentPassword: string; password: string },
  ) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("Compte introuvable");

    // Si le compte est un compte Google, il n'a pas de mot de passe. On ne peut donc pas changer le mot de passe directement.
    if (!user.passwordHash) {
      logger.warn("Password change failed", {
        reason: "google_account_no_password",
        userId,
      });

      throw unprocessable(
        "COMPTE_GOOGLE_SANS_MOT_DE_PASSE",
        "Ce compte utilise la connexion Google. Utilisez « Mot de passe oublié » pour définir un mot de passe.",
      );
    }

    if (
      !(await verifyPassword(
        input.currentPassword,
        user.passwordHash as string,
      ))
    ) {
      throw unprocessable(
        "MOT_DE_PASSE_INCORRECT",
        "Le mot de passe actuel est incorrect.",
      );
    }
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.password) },
    });
    logger.info("User password changed", { userId });
  },

  forgotPassword: async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }
    await sendForgotPasswordMail(user);
    logger.info("Password reset email requested", { userId: user.id });
  },

  resetPassword: async (token: string, password: string) => {
    const userId = await consumeAuthToken(token, "reset_password");
    if (!userId) throw badRequest("TOKEN_INVALIDE", "Lien invalide ou expiré");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(password),
        ...(user.role === "ADMIN" ? { emailVerifiedAt: new Date() } : {}),
      },
    });
    logger.info("User password reset", { userId });
  },
};
