// Envoi d'e-mails : à brancher sur ton fournisseur (Resend, Brevo, SMTP…).
// En développement, les messages utilisent le transport SMTP de test.

import nodemailer from "nodemailer";
import { env } from "../config/env";
import { User } from "../database/prisma/generated/prisma/client";
import { createAuthToken } from "./authTokens";
import { badGateway } from "./httpError";
import { logger } from "./logger";
import { resetPasswordEmailTemplate } from "./mailer/reset-password-template";
import { verificationEmailTemplate } from "./mailer/verification-template";

type SendParams = {
  to: string;
  subject: string;
  html: any;
  text: string;
};

const LOGO_URL = "";

const transport = selectTransport();

const sender = {
  address: "no-replay@support-connecte.com",
  name: "Mailtrap Test",
};

export const sendVerificationEmail = async (user: User) => {
  const token = await createAuthToken(user.id, "verify_email", 60 * 24);
  const verifyUrl = `${env.PUBLIC_SITE_URL}/verify-email?token=${token}`;
  const verificationPayload: SendParams = {
    to: user.email,
    subject: "Confirme ton adresse e-mail",
    html: verificationEmailTemplate(
      LOGO_URL,
      user.nom ?? "",
      verifyUrl,
      "24 heures"
    ),
    text: `Bonjour ${user.nom ?? ""}, confirmez votre e-mail : ${verifyUrl}`,
  };
  await sendMail(verificationPayload);
};

// ? send forgot password email
export const sendForgotPasswordMail = async (user: User) => {
  const token = await createAuthToken(user.id, "reset_password", 30);
  const verifyUrl = `${env.PUBLIC_SITE_URL}/reset-password?token=${token}`;

  const forgotPayload: SendParams = {
    to: user.email,
    subject: "Réinitialisation du mot de passe",
    html: resetPasswordEmailTemplate(
      LOGO_URL,
      user.nom ?? "",
      verifyUrl,
      "30 minutes"
    ),
    text: `Bonjour ${user.nom ?? ""}, utilisez ce lien pour réinitialiser votre mot de passe dans les 30 minutes : ${verifyUrl}`,
  };

  await sendMail(forgotPayload);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const sendCallbackRequestEmail = async (params: {
  to: string;
  ownerName?: string | null;
  ficheName: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail?: string | null;
  visitorCompany?: string | null;
}) => {
  const dashboardUrl = `${env.PUBLIC_SITE_URL.replace(/\/$/, "")}/espace-client/prospects`;
  const owner = params.ownerName?.trim() || "Bonjour";
  const safeFiche = escapeHtml(params.ficheName);
  const safeVisitor = escapeHtml(params.visitorName);
  const safePhone = escapeHtml(params.visitorPhone);
  const safeEmail = params.visitorEmail ? escapeHtml(params.visitorEmail) : "";
  const safeCompany = params.visitorCompany
    ? escapeHtml(params.visitorCompany)
    : "";

  const extraHtml = [
    safeEmail
      ? `  <li><strong>E-mail :</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></li>`
      : "",
    safeCompany ? `  <li><strong>Société :</strong> ${safeCompany}</li>` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const extraText = [
    params.visitorEmail ? `- E-mail : ${params.visitorEmail}` : "",
    params.visitorCompany ? `- Société : ${params.visitorCompany}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await sendMail({
    to: params.to,
    subject: `Nouveau prospect — ${params.ficheName}`,
    html: `<p>Bonjour ${escapeHtml(owner)},</p>
<p>Un visiteur a partagé ses coordonnées via « Échangez contact » sur votre fiche <strong>${safeFiche}</strong> :</p>
<ul>
  <li><strong>Nom :</strong> ${safeVisitor}</li>
  <li><strong>Téléphone :</strong> <a href="tel:${safePhone}">${safePhone}</a></li>${extraHtml ? `\n${extraHtml}` : ""}
</ul>
<p><a href="${dashboardUrl}">Voir tous vos prospects</a></p>`,
    text: `Bonjour ${owner},\n\nNouveau prospect depuis votre fiche ${params.ficheName} :\n- Nom : ${params.visitorName}\n- Téléphone : ${params.visitorPhone}${extraText ? `\n${extraText}` : ""}\n\nConsulter vos prospects : ${dashboardUrl}`,
  });
};

export const sendAdminInvitationEmail = async (user: User) => {
  const token = await createAuthToken(user.id, "reset_password", 24 * 60);
  const setupUrl = `${env.PUBLIC_SITE_URL}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Votre accès administrateur Support Connecté",
    html: resetPasswordEmailTemplate(
      LOGO_URL,
      user.nom ?? "",
      setupUrl,
      "24 heures",
      String(new Date().getFullYear()),
      "admin-invitation"
    ),
    text: `Bonjour ${user.nom ?? ""}, un accès administrateur Support Connecté a été créé pour vous. Définissez votre mot de passe dans les 24 heures : ${setupUrl}`,
  });
};

export const sendAccountDeletionScheduledEmail = async (params: {
  to: string;
  name?: string | null;
  scheduledAt: Date;
  graceDays: number;
}) => {
  const loginUrl = `${env.PUBLIC_SITE_URL.replace(/\/$/, "")}/login`;
  const owner = params.name?.trim() || "Bonjour";
  const formattedDate = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
  }).format(params.scheduledAt);

  await sendMail({
    to: params.to,
    subject: "Demande de suppression de votre compte Support Connecté",
    html: `<p>Bonjour ${escapeHtml(owner)},</p>
<p>Nous avons bien enregistré votre demande de suppression de compte. Votre compte est désormais désactivé et vos fiches ne sont plus accessibles en ligne.</p>
<p><strong>Suppression définitive prévue le ${escapeHtml(formattedDate)}</strong> (délai de grâce de ${params.graceDays} jours).</p>
<p>Si vous changez d’avis ou si vous n’êtes pas à l’origine de cette demande, reconnectez-vous simplement avant cette date pour annuler la suppression et restaurer votre compte :</p>
<p><a href="${loginUrl}">Annuler la suppression en me reconnectant</a></p>
<p>Passé ce délai, votre compte, vos fiches, médias et prospects seront définitivement effacés. Les justificatifs de paiement seront conservés de façon anonymisée pour nos obligations comptables.</p>`,
    text: `Bonjour ${owner},\n\nVotre demande de suppression de compte est enregistrée. Votre compte est désactivé et vos fiches sont suspendues.\nSuppression définitive prévue le ${formattedDate} (délai de grâce de ${params.graceDays} jours).\nPour annuler avant cette date, reconnectez-vous sur : ${loginUrl}\n\nPassé ce délai, vos données personnelles et fiches seront supprimées définitivement (seul l'historique comptable anonymisé est conservé).`,
  });
};

export const sendAccountDeletedByAdminEmail = async (params: {
  to: string;
  name?: string | null;
  reason?: string | null;
}) => {
  const owner = params.name?.trim() || "Bonjour";
  const safeReason = params.reason?.trim()
    ? escapeHtml(params.reason.trim())
    : "";

  await sendMail({
    to: params.to,
    subject: "Suppression définitive de votre compte Support Connecté",
    html: `<p>Bonjour ${escapeHtml(owner)},</p>
<p>Votre compte Support Connecté ainsi que les fiches associées ont été supprimés définitivement par un administrateur.</p>${
      safeReason ? `\n<p><strong>Motif :</strong> ${safeReason}</p>` : ""
    }
<p>Conformément aux obligations comptables, l’historique de facturation est conservé de manière anonymisée.</p>`,
    text: `Bonjour ${owner},\n\nVotre compte Support Connecté et ses fiches associées ont été supprimés définitivement par un administrateur.${
      params.reason?.trim() ? `\nMotif : ${params.reason.trim()}` : ""
    }\nL'historique comptable est conservé de manière anonymisée.`,
  });
};

// ? dynamic send email function
export const sendMail = async (data: {
  to: string;
  subject: string;
  html: any;
  text: string;
}) => {
  try {
    await transport.sendMail({
      from: sender,
      to: data.to,
      html: data.html,
      text: data.text,
      subject: data.subject,
    });
    logger.info("Email sent", { subject: data.subject });
  } catch (e) {
    logger.error("Email delivery failed", {
      subject: data.subject,
      errorName: e instanceof Error ? e.name : "UnknownError",
    });
    badGateway("EMAIL_DELIVERY_FAILED", "Échec de l'envoi de l'e-mail");
    return;
    // throw e;
  }
};

// ? Selected trasport depending on environment
function selectTransport() {
  return nodemailer.createTransport({
    host: env.MAILTRAP_SMTP_HOST,
    port: parseInt(env.MAILTRAP_SMTP_PORT, 10),
    auth: {
      user: env.MAILTRAP_SMTP_USER,
      pass: env.MAILTRAP_SMTP_PASSWORD,
    },
  });
}
