import "dotenv/config";
import { z } from "zod";
import { logger } from "../lib/logger";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET doit faire au moins 32 caractères"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  CORS_ORIGIN: z.string(),
  PUBLIC_SITE_URL: z.string(),
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  MAX_FICHES_PER_USER: z.coerce.number().int().positive().default(3),
  MAILTRAP_SMTP_HOST: z
    .string()
    .trim()
    .min(1, "MAILTRAP_SMTP_HOST est requis")
    .refine(v => !/[\s,"']/.test(v), "MAILTRAP_SMTP_HOST contient des caractères invalides"),
  MAILTRAP_SMTP_PORT: z.string().trim().min(1, "MAILTRAP_SMTP_PORT est requis"),
  MAILTRAP_SMTP_USER: z.string().trim().min(1, "MAILTRAP_SMTP_USER est requis"),
  MAILTRAP_SMTP_PASSWORD: z
    .string()
    .trim()
    .min(1, "MAILTRAP_SMTP_PASSWORD est requis"),
  MAILTRAP_API_TOKEN: z.string().optional(),
  MAIL_FROM_ADDRESS: z
    .string()
    .trim()
    .email("MAIL_FROM_ADDRESS doit être une adresse e-mail valide")
    .default("no-reply@support-connecte.com"),
  MAIL_FROM_NAME: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .default("Support Connecté"),
  SERVER: z.string(),
  S3_ENDPOINT: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_REGION: z.string(),
  S3_BUCKET: z.string().default("ficheImage"),
  FFMPEG_PATH: z.string().default("/usr/bin/ffmpeg"),
  TWO_FA_ENCRYPTION_KEY: z
    .string()
    .regex(
      /^[0-9a-fA-F]{64}$/,
      "TWO_FA_ENCRYPTION_KEY doit être une clé hexadécimale de 64 caractères (32 octets)",
    ),

  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID est requis"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET est requis"),

  // URL publique du logo affiché dans les e-mails (optionnelle)
  LOGO_PATH: z
    .string()
    .default(
      process.env.PUBLIC_SITE_URL
        ? `${process.env.PUBLIC_SITE_URL.replace(/\/$/, "")}/images/Logo.png`
        : "",
    ),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  logger.error("Invalid environment configuration", {
    fieldErrors: parsed.error.flatten().fieldErrors,
  });
  process.exit(1);
}
export const env = parsed.data;
