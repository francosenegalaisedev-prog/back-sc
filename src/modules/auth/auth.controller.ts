import type { Request, Response } from "express";
import { prisma } from "../../database/prisma/prisma-client";
import { asyncHandler } from "../../lib/asyncHandler";
import { clearSessionCookie, setSessionCookie } from "../../lib/sessionCookie";
import { twoFaService } from "../twoFa/twoFa.service";
import {
  cancelSelfDeletion,
  requestSelfDeletion,
} from "./accountDeletion.service";
import { AuthService as auth, publicUser } from "./auth.service";

export const AuthController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await auth.register(req.body);
    setSessionCookie(res, result.token);
    return res.status(201).json({ status: "ok", data: result });
  }),

  // Connexion classique conservée pour compatibilité avec les clients existants.
  login: asyncHandler(async (req: Request, res: Response) => {
    const result = await auth.login(req.body);
    if (!("requires2fa" in result)) {
      setSessionCookie(res, result.token);
    }
    res.json(result);
  }),

  // Connexion dédiée à l’espace client : seuls les comptes CLIENT sont acceptés.
  googleLogin: asyncHandler(async (req: Request, res: Response) => {
    const result = await auth.loginWithGoogle(req.body.credential);
    if (!("requires2fa" in result)) {
      setSessionCookie(res, result.token);
    }
    res.json(result);
  }),

  // Connexion dédiée à l’espace client : seuls les comptes CLIENT sont acceptés.
  clientLogin: asyncHandler(async (req: Request, res: Response) => {
    const result = await auth.login(req.body, "CLIENT");
    if (!("requires2fa" in result)) {
      setSessionCookie(res, result.token);
    }
    res.json(result);
  }),

  // Connexion dédiée à l’espace administration : seuls les comptes ADMIN sont acceptés.
  adminLogin: asyncHandler(async (req: Request, res: Response) => {
    const result = await auth.login(req.body, "ADMIN");
    if (!("requires2fa" in result)) {
      setSessionCookie(res, result.token);
    }
    res.json(result);
  }),

  logout: asyncHandler(async (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  }),

  verifyEmail: asyncHandler(async (req: Request, res: Response) => {
    await auth.verifyEmail(req.body.token);
    res.json({ ok: true });
  }),

  resendVerificationEmail: asyncHandler(async (req: Request, res: Response) => {
    await auth.resendVerification(req.user!.id);
    res.json({ ok: true });
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    await auth.forgotPassword(req.body.email);
    res.json({ ok: true }); // toujours la même réponse
  }),

  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    await auth.resetPassword(req.body.token, req.body.password);
    res.json({ ok: true });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
    });
    res.json({ user: publicUser(user) });
  }),

  updateProfile: asyncHandler(async (req: Request, res: Response) => {
    const user = await auth.updateProfile(req.user!.id, req.body);
    res.json({ user });
  }),

  changePassword: asyncHandler(async (req: Request, res: Response) => {
    await auth.changePassword(req.user!.id, req.body);
    res.json({ ok: true });
  }),

  requestAccountDeletion: asyncHandler(async (req: Request, res: Response) => {
    const result = await requestSelfDeletion(req.user!.id, req.body);
    clearSessionCookie(res);
    res.json({ ok: true, ...result });
  }),

  cancelAccountDeletion: asyncHandler(async (req: Request, res: Response) => {
    const result = await cancelSelfDeletion(req.body);
    setSessionCookie(res, result.token);
    res.json(result);
  }),

  enableTwoFactorAuth: asyncHandler(async (req: Request, res: Response) => {
    const result = await twoFaService.setup2fa(
      req.user!.id,
      req.user!.email as string,
    );
    res.json(result);
  }),

  verifyTwoFactorAuth: asyncHandler(async (req: Request, res: Response) => {
    const { otpCode } = req.body;
    const result = await twoFaService.confirmAndEnable2FA(
      req.user!.id,
      otpCode,
    );
    res.json(result);
  }),

  disableTwoFactorAuth: asyncHandler(async (req: Request, res: Response) => {
    const result = await twoFaService.disable2FA(req.user!.id, req.body);
    res.json(result);
  }),

  completeTwoFaLogin: asyncHandler(async (req: Request, res: Response) => {
    const result = await auth.completeTwoFaLogin(
      req.body.tempToken,
      req.body.code,
    );
    setSessionCookie(res, result.token);
    res.json(result);
  }),
};
