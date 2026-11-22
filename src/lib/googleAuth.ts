    import { OAuth2Client } from "google-auth-library";
    import { env } from "../config/env";
    import { unauthorized } from "./httpError";
import { logger } from "./logger";

    let client: OAuth2Client | undefined;

    export interface GoogleIdentity {
      googleId: string;
      email: string;
      nom: string;
    }

    export async function verifyGoogleIdToken(
      credential: string
    ): Promise<GoogleIdentity> {
      if (!env.GOOGLE_CLIENT_ID) {
        logger.error("GOOGLE_CLIENT_ID is not set in the environment variables.");
        throw unauthorized("Erreur de connexion avec Google.");
      }

      client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);

      let ticket;
      try {
        ticket = await client.verifyIdToken({
          idToken: credential,
          audience: env.GOOGLE_CLIENT_ID,
        });
      } catch {
        logger.error("Failed to verify Google ID token.");
        throw unauthorized("Jeton Google invalide ou expiré.");
      }

      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        logger.error("Incomplete Google ID token.");
        throw unauthorized("Erreur de jeton Google.");
      }

      if (payload.email_verified !== true) {
        logger.error("Google email not verified.");
        throw unauthorized("Erreur de vérification de l'adresse e-mail Google.");
      }

      return {
        googleId: payload.sub, // Google user ID it's immuable
        email: payload.email.trim().toLowerCase(),
        nom: (payload.name ?? payload.given_name ?? "").trim(),
      };
    }