import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export type JwtPayload = { sub: string }; // id de l'utilisateur ; le rôle est relu en base à chaque requête

export type TwoFaTokenPayload = {
  sub: string;
  purpose: "2fa_pending";
  expectedRole?: "CLIENT" | "ADMIN";
};

export const signToken = (userId: number) =>
  jwt.sign({ sub: String(userId) } satisfies JwtPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });

export const verifyToken = (token: string): JwtPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (
    typeof decoded === "string" ||
    typeof decoded.sub !== "string" ||
    "purpose" in decoded
  )
    throw new Error("Token invalide");
  return { sub: decoded.sub };
};

export const signTwoFaToken = (
  userId: number,
  expectedRole?: "CLIENT" | "ADMIN",
) =>
  jwt.sign(
    {
      sub: String(userId),
      purpose: "2fa_pending",
      ...(expectedRole ? { expectedRole } : {}),
    } satisfies TwoFaTokenPayload,
    env.JWT_SECRET,
    { expiresIn: "5m" },
  );

export const verifyTwoFaToken = (token: string): TwoFaTokenPayload => {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (
    typeof decoded === "string" ||
    typeof decoded.sub !== "string" ||
    decoded.purpose !== "2fa_pending"
  ) {
    throw new Error("Token 2FA invalide");
  }
  const expectedRole =
    decoded.expectedRole === "CLIENT" || decoded.expectedRole === "ADMIN"
      ? decoded.expectedRole
      : undefined;
  return { sub: decoded.sub, purpose: "2fa_pending", expectedRole };
};
