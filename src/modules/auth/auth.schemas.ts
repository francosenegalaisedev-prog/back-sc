import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, "Au moins 8 caractères").max(128),
  nom: z.string().trim().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export const tokenSchema = z.object({ token: z.string().min(20).max(200) });

export const emailOnlySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(128),
});

export const updateProfileSchema = z
  .object({
    nom: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: z.string().min(8).max(128),
  })
  .strict();

export const googleLoginSchema = z.object({
  credential: z.string().trim().min(20, "Jeton Google invalide.").max(4096),
});

export const deleteAccountRequestSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    confirmEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const cancelDeletionSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    password: z.string().min(1).max(128).optional(),
    credential: z.string().trim().min(20).max(4096).optional(),
  })
  .strict()
  .refine(
    data => Boolean(data.credential) || Boolean(data.email && data.password),
    "Fournissez vos identifiants ou votre connexion Google."
  );