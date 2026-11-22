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
  MAILTRAP_SMTP_HOST: z.string().min(1, "MAILTRAP_SMTP_HOST est requis"),
  MAILTRAP_SMTP_PORT: z.string().min(1, "MAILTRAP_SMTP_PORT est requis"),
  MAILTRAP_SMTP_USER: z.string().min(1, "MAILTRAP_SMTP_USER est requis"),
  MAILTRAP_SMTP_PASSWORD: z
    .string()
    .min(1, "MAILTRAP_SMTP_PASSWORD est requis"),
  MAILTRAP_API_TOKEN: z.string().min(1, "MAILTRAP_API_TOKEN est requis"),
  SERVER: z.string(),
  S3_ENDPOINT: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_REGION: z.string(),
  S3_BUCKET: z.string().default("ficheImage"),
  FFMPEG_PATH: z.string().default("/usr/bin/ffmpeg"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID est requis"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET est requis"),

  // lOGO PATH
  LOGO_PATH: z.string().default(`${process.env.SERVER}/logo.png`),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  logger.error("Invalid environment configuration", {
    fieldErrors: parsed.error.flatten().fieldErrors,
  });
  process.exit(1);
}
export const env = parsed.data;
