import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { prisma } from "../../database/prisma/prisma-client";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
} from "../../lib/crypto.lib";
import { conflict, notFound, unprocessable } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { verifyPassword } from "../../lib/password";

const issuer = "LogCard"; // The issuer name for the 2FA setup, typically the name of your application or service.

export const twoFaService = {
  // Initialisation du 2FA pour un utilisateur
  setup2fa: async (userId: number, userEmail: string) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw notFound("Compte introuvable");
    }

    if (user.two_fa_enabled) {
      logger.warn("Enable 2fa forbidden, 2fa already enabled", { userId });
      throw conflict(
        "TWO_FA_DEJA_ACTIVE",
        "La double authentification est déjà activée. Désactivez-la d'abord pour la reconfigurer.",
      );
    }

    const secret = generateSecret();
    const otpauthUrl = generateURI({
      issuer,
      secret,
      label: userEmail,
      digits: 6,
      period: 30,
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        two_fa_secret: encryptSecret(secret),
        two_fa_enabled: false,
      },
    });

    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    return { qrCode: qrCodeDataUrl, manualKey: secret };
  },

  // Confirmation (QR code scanné et premier code à 6 chiffres saisi)
  confirmAndEnable2FA: async (userId: number, otpCode: string) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw notFound("Compte introuvable");
    }
    if (user.two_fa_enabled) {
      throw conflict(
        "TWO_FA_DEJA_ACTIVE",
        "La double authentification est déjà activée.",
      );
    }
    if (!user.two_fa_secret) {
      logger.warn("Configuration 2FA non initialisée", { userId });
      throw unprocessable(
        "TWO_FA_NON_INITIALISE",
        "Configuration 2FA non initialisée. Lancez d'abord l'activation de la double authentification.",
      );
    }

    const secret = decryptSecret(user.two_fa_secret);
    const { valid } = await verify({ token: otpCode.trim(), secret });

    if (!valid) {
      throw unprocessable(
        "OTP_INVALIDE",
        "Code OTP invalide. Vérifiez le code affiché et l'heure de votre téléphone.",
      );
    }

    const { plainCodes, hashedCodes } = await generateRecoveryCodes(8);

    await prisma.user.update({
      where: { id: userId },
      data: {
        two_fa_enabled: true,
        two_fa_recovery_codes: hashedCodes,
        two_fa_last_used_at: new Date(),
      },
    });

    logger.info("2FA enabled for user", { userId });

    // Renvoyer les codes en clair UNE SEULE FOIS à l'utilisateur
    return { recoveryCodes: plainCodes };
  },

  verifyLogin2FA: async (userId: number, rawCode: string): Promise<boolean> => {
    const code = rawCode.trim();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.two_fa_enabled || !user.two_fa_secret) return false;

    // Cas A : Code OTP à 6 chiffres
    if (/^\d{6}$/.test(code)) {
      // Anti-rejeu : empêcher la réutilisation d'un code dans la même fenêtre de 30s
      if (
        user.two_fa_last_used_at &&
        Date.now() - user.two_fa_last_used_at.getTime() < 30_000
      ) {
        throw conflict(
          "OTP_DEJA_UTILISE",
          "Ce code a déjà été utilisé. Attendez le prochain code.",
        );
      }

      const secret = decryptSecret(user.two_fa_secret);
      const { valid } = await verify({ token: code, secret });

      if (valid) {
        await prisma.user.update({
          where: { id: userId },
          data: { two_fa_last_used_at: new Date() },
        });
        return true;
      }
      return false;
    }

    // Cas B : Code de secours (ex: "A8F2-9K1L")
    const normalizedCode = code.toUpperCase();
    for (let i = 0; i < user.two_fa_recovery_codes.length; i++) {
      const match = await bcrypt.compare(
        normalizedCode,
        user.two_fa_recovery_codes[i],
      );
      if (match) {
        // Supprimer le code utilisé (usage unique)
        const remainingCodes = user.two_fa_recovery_codes.filter(
          (_, idx) => idx !== i,
        );
        await prisma.user.update({
          where: { id: userId },
          data: { two_fa_recovery_codes: remainingCodes },
        });
        return true;
      }
    }
    return false;
  },

  disable2FA: async (
    userId: number,
    input: { password?: string; code?: string },
  ) => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw notFound("Compte introuvable");
    }
    if (!user.two_fa_enabled) {
      throw conflict(
        "TWO_FA_NON_ACTIVE",
        "La double authentification n'est pas activée.",
      );
    }

    if (user.passwordHash) {
      if (!input.password) {
        throw unprocessable(
          "MOT_DE_PASSE_REQUIS",
          "Votre mot de passe actuel est requis pour désactiver la double authentification.",
        );
      }
      const passwordValid = await verifyPassword(
        input.password,
        user.passwordHash,
      );
      if (!passwordValid) {
        throw unprocessable(
          "MOT_DE_PASSE_INCORRECT",
          "Le mot de passe actuel est incorrect.",
        );
      }
    } else {
      if (!input.code) {
        throw unprocessable(
          "CODE_2FA_REQUIS",
          "Un code d'authentification ou un code de secours est requis pour désactiver la double authentification.",
        );
      }
      const valid = await twoFaService.verifyLogin2FA(userId, input.code);
      if (!valid) {
        throw unprocessable(
          "CODE_2FA_INVALIDE",
          "Code de vérification invalide.",
        );
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        two_fa_enabled: false,
        two_fa_secret: null,
        two_fa_recovery_codes: [],
        two_fa_last_used_at: null,
      },
    });

    logger.info("2FA disabled for user", { userId });
    return { ok: true };
  },
};
