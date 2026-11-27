// Service central d'envoi d'e-mails (Nodemailer SMTP).
// Documentation complète : server/docs/EMAILS.md

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";
import type { User } from "../database/prisma/generated/prisma/client";
import { createAuthToken } from "./authTokens";
import { badGateway } from "./httpError";
import { logger } from "./logger";
import {
  escapeHtml,
  formatGreeting,
  renderBaseEmail,
} from "./mailer/base-layout";
import { resetPasswordEmailTemplate } from "./mailer/reset-password-template";
import { verificationEmailTemplate } from "./mailer/verification-template";

export type SendParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendMailOptions = {
  /**
   * Si true, un échec SMTP est loggué en warning sans faire échouer l'action métier
   * (notifications, reçus, alertes). Par défaut false : lève une erreur 502.
   */
  bestEffort?: boolean;
};

const siteBase = () => env.PUBLIC_SITE_URL.replace(/\/$/, "");
const logoUrl = () => env.LOGO_PATH || "";

const getSender = () => ({
  address: env.MAIL_FROM_ADDRESS,
  name: env.MAIL_FROM_NAME,
});

let cachedTransport: Transporter | null = null;

export function getMailTransport(): Transporter {
  if (!cachedTransport) {
    const port = parseInt(env.MAILTRAP_SMTP_PORT, 10) || 587;
    cachedTransport = nodemailer.createTransport({
      host: env.MAILTRAP_SMTP_HOST,
      port,
      secure: port === 587,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      auth: {
        user: env.MAILTRAP_SMTP_USER,
        pass: env.MAILTRAP_SMTP_PASSWORD,
      },
    });
  }
  return cachedTransport;
}

/** Réinitialise le transport en cache (utile pour les tests unitaires). */
export function resetMailTransportForTests(): void {
  cachedTransport = null;
}

/** Vérifie la joignabilité du serveur SMTP au démarrage (non bloquant). */
export async function verifyMailTransport(): Promise<boolean> {
  try {
    await getMailTransport().verify();
    logger.info("SMTP transport verified", {
      host: env.MAILTRAP_SMTP_HOST,
      port: env.MAILTRAP_SMTP_PORT,
    });
    return true;
  } catch (e) {
    logger.warn("SMTP transport verification failed", {
      host: env.MAILTRAP_SMTP_HOST,
      port: env.MAILTRAP_SMTP_PORT,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export const sendMail = async (
  data: SendParams,
  options: SendMailOptions = {},
): Promise<boolean> => {
  try {
    await getMailTransport().sendMail({
      from: getSender(),
      to: data.to,
      html: data.html,
      text: data.text,
      subject: data.subject,
    });
    logger.info("Email sent", { subject: data.subject });
    return true;
  } catch (e) {
    const err = e as { name?: string; code?: string; message?: string };
    const meta = {
      subject: data.subject,
      errorName: err?.name ?? "UnknownError",
      errorCode: err?.code,
      errorMessage: err?.message ?? String(e),
    };
    if (options.bestEffort) {
      logger.warn("Non-blocking email delivery failed", meta);
      return false;
    }
    logger.error("Email delivery failed", meta);
    throw badGateway(
      "EMAIL_DELIVERY_FAILED",
      "Impossible d'envoyer l'e-mail pour le moment. Réessayez dans quelques instants.",
    );
  }
};

// ───────── 1. Vérification d'adresse e-mail ─────────
export const sendVerificationEmail = async (
  user: Pick<User, "id" | "email" | "nom">,
  options: SendMailOptions = {},
) => {
  const token = await createAuthToken(user.id, "verify_email", 60 * 24);
  const verifyUrl = `${siteBase()}/verify-email?token=${token}`;
  const greeting = formatGreeting(user.nom);
  await sendMail(
    {
      to: user.email,
      subject: "Confirmez votre adresse e-mail — LogCard",
      html: verificationEmailTemplate(
        logoUrl(),
        user.nom ?? "",
        verifyUrl,
        "24 heures",
      ),
      text: `${greeting}\n\nConfirmez votre adresse e-mail (lien valable 24 heures) : ${verifyUrl}`,
    },
    options,
  );
};

// ───────── 2. Réinitialisation de mot de passe ─────────
export const sendForgotPasswordMail = async (
  user: Pick<User, "id" | "email" | "nom">,
) => {
  const token = await createAuthToken(user.id, "reset_password", 30);
  const resetUrl = `${siteBase()}/reset-password?token=${token}`;
  const greeting = formatGreeting(user.nom);
  await sendMail({
    to: user.email,
    subject: "Réinitialisation de votre mot de passe — LogCard",
    html: resetPasswordEmailTemplate(
      logoUrl(),
      user.nom ?? "",
      resetUrl,
      "30 minutes",
    ),
    text: `${greeting}\n\nUtilisez ce lien pour réinitialiser votre mot de passe dans les 30 minutes : ${resetUrl}`,
  });
};

// ───────── 3. Invitation administrateur ─────────
export const sendAdminInvitationEmail = async (
  user: Pick<User, "id" | "email" | "nom">,
) => {
  const token = await createAuthToken(user.id, "reset_password", 24 * 60);
  const setupUrl = `${siteBase()}/reset-password?token=${token}`;
  const greeting = formatGreeting(user.nom);
  await sendMail({
    to: user.email,
    subject: "Votre accès administrateur — LogCard",
    html: resetPasswordEmailTemplate(
      logoUrl(),
      user.nom ?? "",
      setupUrl,
      "24 heures",
      String(new Date().getFullYear()),
      "admin-invitation",
    ),
    text: `${greeting}\n\nUn accès administrateur LogCard a été créé pour vous. Définissez votre mot de passe dans les 24 heures : ${setupUrl}`,
  });
};

// ───────── 4. Nouveau prospect (« Échangez contact ») ─────────
export const sendCallbackRequestEmail = async (params: {
  to: string;
  ownerName?: string | null;
  ficheName: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail?: string | null;
  visitorCompany?: string | null;
}) => {
  const dashboardUrl = `${siteBase()}/espace-client/prospects`;
  const greeting = formatGreeting(params.ownerName);
  const safeFiche = escapeHtml(params.ficheName);
  const safeVisitor = escapeHtml(params.visitorName);
  const safePhone = escapeHtml(params.visitorPhone);
  const safeEmail = params.visitorEmail ? escapeHtml(params.visitorEmail) : "";
  const safeCompany = params.visitorCompany
    ? escapeHtml(params.visitorCompany)
    : "";

  const extraHtml = [
    safeEmail
      ? `<li><strong>E-mail :</strong> <a href="mailto:${safeEmail}" style="color:#b91c1c;">${safeEmail}</a></li>`
      : "",
    safeCompany ? `<li><strong>Société :</strong> ${safeCompany}</li>` : "",
  ]
    .filter(Boolean)
    .join("");

  const extraText = [
    params.visitorEmail ? `- E-mail : ${params.visitorEmail}` : "",
    params.visitorCompany ? `- Société : ${params.visitorCompany}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyHtml = `<p style="margin:0 0 14px 0;">Un visiteur a partagé ses coordonnées via « Échangez contact » sur votre fiche <strong>${safeFiche}</strong> :</p>
<ul style="margin:0 0 16px 0;padding-left:20px;">
  <li><strong>Nom :</strong> ${safeVisitor}</li>
  <li><strong>Téléphone :</strong> <a href="tel:${safePhone}" style="color:#b91c1c;">${safePhone}</a></li>
  ${extraHtml}
</ul>`;

  await sendMail(
    {
      to: params.to,
      subject: `Nouveau prospect — ${params.ficheName}`,
      html: renderBaseEmail({
        title: `Nouveau prospect — ${params.ficheName}`,
        preheader: `${params.visitorName} vous a laissé ses coordonnées sur ${params.ficheName}.`,
        heading: "Nouveau prospect reçu",
        greetingName: params.ownerName,
        bodyHtml,
        cta: { label: "Voir mes prospects", url: dashboardUrl },
        logoUrl: logoUrl(),
      }),
      text: `${greeting}\n\nNouveau prospect depuis votre fiche ${params.ficheName} :\n- Nom : ${params.visitorName}\n- Téléphone : ${params.visitorPhone}${extraText ? `\n${extraText}` : ""}\n\nConsulter vos prospects : ${dashboardUrl}`,
    },
    { bestEffort: true },
  );
};

// ───────── 5. Suppression de compte programmée (délai 30 jours) ─────────
export const sendAccountDeletionScheduledEmail = async (params: {
  to: string;
  name?: string | null;
  scheduledAt: Date;
  graceDays: number;
}) => {
  const loginUrl = `${siteBase()}/login`;
  const greeting = formatGreeting(params.name);
  const formattedDate = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
  }).format(params.scheduledAt);

  const bodyHtml = `<p style="margin:0 0 14px 0;">Nous avons bien enregistré votre demande de suppression de compte. Votre compte est désormais désactivé et vos fiches ne sont plus accessibles en ligne.</p>
<p style="margin:0 0 14px 0;"><strong>Suppression définitive prévue le ${escapeHtml(formattedDate)}</strong> (délai de grâce de ${params.graceDays} jours).</p>
<p style="margin:0 0 14px 0;">Si vous changez d’avis ou si vous n’êtes pas à l’origine de cette demande, reconnectez-vous simplement avant cette date pour annuler la suppression et restaurer votre compte.</p>`;

  await sendMail(
    {
      to: params.to,
      subject: "Demande de suppression de votre compte — LogCard",
      html: renderBaseEmail({
        title: "Suppression de compte programmée",
        preheader: `Suppression définitive prévue le ${formattedDate}.`,
        heading: "Suppression de compte programmée",
        greetingName: params.name,
        bodyHtml,
        cta: { label: "Annuler la suppression", url: loginUrl },
        notice:
          "Passé ce délai, votre compte, vos fiches, médias et prospects seront définitivement effacés. L’historique comptable est conservé de façon anonymisée.",
        logoUrl: logoUrl(),
      }),
      text: `${greeting}\n\nVotre demande de suppression de compte est enregistrée.\nSuppression définitive prévue le ${formattedDate} (délai de grâce de ${params.graceDays} jours).\nPour annuler avant cette date, reconnectez-vous sur : ${loginUrl}`,
    },
    { bestEffort: true },
  );
};

// ───────── 6. Suppression définitive par administrateur ─────────
export const sendAccountDeletedByAdminEmail = async (params: {
  to: string;
  name?: string | null;
  reason?: string | null;
}) => {
  const greeting = formatGreeting(params.name);
  const safeReason = params.reason?.trim()
    ? escapeHtml(params.reason.trim())
    : "";

  const bodyHtml = `<p style="margin:0 0 14px 0;">Votre compte LogCard ainsi que les fiches associées ont été supprimés définitivement par un administrateur.</p>
${safeReason ? `<p style="margin:0 0 14px 0;"><strong>Motif :</strong> ${safeReason}</p>` : ""}
<p style="margin:0;">Conformément aux obligations comptables, l’historique de facturation est conservé de manière anonymisée.</p>`;

  await sendMail(
    {
      to: params.to,
      subject: "Suppression définitive de votre compte — LogCard",
      html: renderBaseEmail({
        title: "Suppression définitive de votre compte",
        preheader: "Votre compte LogCard a été supprimé.",
        heading: "Compte supprimé définitivement",
        greetingName: params.name,
        bodyHtml,
        logoUrl: logoUrl(),
      }),
      text: `${greeting}\n\nVotre compte LogCard et ses fiches associées ont été supprimés définitivement par un administrateur.${
        params.reason?.trim() ? `\nMotif : ${params.reason.trim()}` : ""
      }\nL'historique comptable est conservé de manière anonymisée.`,
    },
    { bestEffort: true },
  );
};

// ───────── 7. Sticker par section activé ─────────
export const sendSectionStickerActivatedEmail = async (params: {
  to: string;
  ownerName?: string | null;
  ficheName: string;
  sectionLabel: string;
  stickerUrl: string;
}) => {
  const greeting = formatGreeting(params.ownerName);
  const safeFiche = escapeHtml(params.ficheName);
  const safeSection = escapeHtml(params.sectionLabel);

  const bodyHtml = `<p style="margin:0 0 14px 0;">Notre équipe a généré et activé le sticker de la section <strong>${safeSection}</strong> pour votre fiche <strong>${safeFiche}</strong>.</p>
<p style="margin:0;">Votre lien direct et votre QR code sont désormais disponibles dans votre espace client.</p>`;

  await sendMail(
    {
      to: params.to,
      subject: `Votre sticker « ${params.sectionLabel} » est activé — ${params.ficheName}`,
      html: renderBaseEmail({
        title: `Sticker « ${params.sectionLabel} » activé`,
        preheader: `Votre sticker ${params.sectionLabel} pour ${params.ficheName} est actif.`,
        heading: `Sticker « ${params.sectionLabel} » activé`,
        greetingName: params.ownerName,
        bodyHtml,
        cta: { label: "Ouvrir le lien du sticker", url: params.stickerUrl },
        logoUrl: logoUrl(),
      }),
      text: `${greeting}\n\nLe sticker de la section « ${params.sectionLabel} » pour votre fiche ${params.ficheName} est désormais actif.\nLien direct : ${params.stickerUrl}`,
    },
    { bestEffort: true },
  );
};

// ───────── 8. Commande de carte NFC (Envoyée / Traitée / Livrée) ─────────
const CARD_STATUS_COPY = {
  envoyee: {
    subject: "Commande de carte NFC enregistrée",
    heading: "Votre demande de carte est envoyée",
    intro:
      "Nous avons bien reçu votre demande de carte NFC personnalisée. Notre équipe va la prendre en charge très prochainement.",
  },
  traitee: {
    subject: "Votre carte NFC est en cours de finalisation",
    heading: "Votre commande est traitée",
    intro:
      "Votre carte NFC personnalisée a été traitée par notre atelier et prépare son expédition / livraison.",
  },
  livree: {
    subject: "Votre carte NFC a été livrée",
    heading: "Votre carte NFC est livrée",
    intro:
      "Votre commande de carte NFC a été marquée comme livrée. Il ne vous reste plus qu'à la présenter pour partager votre fiche !",
  },
} as const;

export const sendCardOrderEmail = async (params: {
  to: string;
  ownerName?: string | null;
  ficheName: string;
  orderId: number;
  statut: "envoyee" | "traitee" | "livree";
  montantFcfa?: number | null;
  adresseLivraison?: string | null;
}) => {
  const copy = CARD_STATUS_COPY[params.statut];
  const cartesUrl = `${siteBase()}/espace-client/cartes`;
  const greeting = formatGreeting(params.ownerName);
  const safeFiche = escapeHtml(params.ficheName);
  const detailsHtml = [
    `<li><strong>Commande :</strong> #${params.orderId}</li>`,
    `<li><strong>Fiche associée :</strong> ${safeFiche}</li>`,
    params.montantFcfa != null
      ? `<li><strong>Montant (paiement à la livraison) :</strong> ${escapeHtml(params.montantFcfa.toLocaleString("fr-FR"))} FCFA</li>`
      : "",
    params.adresseLivraison
      ? `<li><strong>Adresse de livraison :</strong> ${escapeHtml(params.adresseLivraison)}</li>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const bodyHtml = `<p style="margin:0 0 14px 0;">${escapeHtml(copy.intro)}</p>
<ul style="margin:0 0 14px 0;padding-left:20px;">${detailsHtml}</ul>`;

  await sendMail(
    {
      to: params.to,
      subject: `${copy.subject} (#${params.orderId}) — LogCard`,
      html: renderBaseEmail({
        title: copy.subject,
        preheader: `${copy.heading} — Commande #${params.orderId}.`,
        heading: copy.heading,
        greetingName: params.ownerName,
        bodyHtml,
        cta: { label: "Suivre ma carte", url: cartesUrl },
        logoUrl: logoUrl(),
      }),
      text: `${greeting}\n\n${copy.intro}\nCommande #${params.orderId} (${params.ficheName}).\nSuivre ma carte : ${cartesUrl}`,
    },
    { bestEffort: true },
  );
};

// ───────── 9. Alertes sécurité (mot de passe / 2FA) ─────────
const SECURITY_EVENT_COPY = {
  password_changed: {
    subject: "Votre mot de passe a été modifié",
    heading: "Mot de passe modifié",
    body: "Le mot de passe de votre compte LogCard vient d’être modifié avec succès.",
  },
  "2fa_enabled": {
    subject: "Double authentification (2FA) activée",
    heading: "Double authentification activée",
    body: "La double authentification (2FA) est désormais active sur votre compte. Conservez précieusement vos codes de secours.",
  },
  "2fa_disabled": {
    subject: "Double authentification (2FA) désactivée",
    heading: "Double authentification désactivée",
    body: "La double authentification (2FA) vient d’être désactivée sur votre compte.",
  },
} as const;

export const sendSecurityAlertEmail = async (params: {
  to: string;
  name?: string | null;
  event: keyof typeof SECURITY_EVENT_COPY;
}) => {
  const copy = SECURITY_EVENT_COPY[params.event];
  const settingsUrl = `${siteBase()}/espace-client/parametres`;
  const greeting = formatGreeting(params.name);

  await sendMail(
    {
      to: params.to,
      subject: `${copy.subject} — LogCard`,
      html: renderBaseEmail({
        title: copy.subject,
        preheader: copy.body,
        heading: copy.heading,
        greetingName: params.name,
        bodyHtml: `<p style="margin:0 0 14px 0;">${escapeHtml(copy.body)}</p>`,
        cta: { label: "Gérer la sécurité du compte", url: settingsUrl },
        notice:
          "Si vous n’êtes pas à l’origine de cette action, réinitialisez immédiatement votre mot de passe et contactez notre support.",
        logoUrl: logoUrl(),
      }),
      text: `${greeting}\n\n${copy.body}\nSi vous n'êtes pas à l'origine de cette action, sécurisez votre compte immédiatement : ${settingsUrl}`,
    },
    { bestEffort: true },
  );
};

// ───────── 10. Confirmation d'abonnement / paiement ─────────
export const sendSubscriptionConfirmedEmail = async (params: {
  to: string;
  name?: string | null;
  ficheName: string;
  planName: string;
  amountFcfa: number;
  endsAt?: Date | null;
  reference?: string | null;
}) => {
  const subsUrl = `${siteBase()}/espace-client/abonnements`;
  const greeting = formatGreeting(params.name);
  const formattedEnd = params.endsAt
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(
        params.endsAt,
      )
    : null;

  const detailsHtml = [
    `<li><strong>Fiche :</strong> ${escapeHtml(params.ficheName)}</li>`,
    `<li><strong>Formule activée :</strong> ${escapeHtml(params.planName)}</li>`,
    `<li><strong>Montant :</strong> ${escapeHtml(params.amountFcfa.toLocaleString("fr-FR"))} FCFA</li>`,
    formattedEnd
      ? `<li><strong>Valable jusqu’au :</strong> ${escapeHtml(formattedEnd)}</li>`
      : "",
    params.reference
      ? `<li><strong>Référence :</strong> ${escapeHtml(params.reference)}</li>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const bodyHtml = `<p style="margin:0 0 14px 0;">Votre paiement a bien été confirmé et votre formule <strong>${escapeHtml(params.planName)}</strong> est désormais active.</p>
<ul style="margin:0 0 14px 0;padding-left:20px;">${detailsHtml}</ul>`;

  await sendMail(
    {
      to: params.to,
      subject: `Formule ${params.planName} activée — LogCard`,
      html: renderBaseEmail({
        title: `Formule ${params.planName} activée`,
        preheader: `Votre formule ${params.planName} pour ${params.ficheName} est active.`,
        heading: `Formule ${params.planName} activée`,
        greetingName: params.name,
        bodyHtml,
        cta: { label: "Voir mes abonnements", url: subsUrl },
        logoUrl: logoUrl(),
      }),
      text: `${greeting}\n\nVotre formule ${params.planName} pour la fiche ${params.ficheName} est activée (${params.amountFcfa.toLocaleString("fr-FR")} FCFA).${
        formattedEnd ? `\nValable jusqu'au : ${formattedEnd}.` : ""
      }\nConsulter vos abonnements : ${subsUrl}`,
    },
    { bestEffort: true },
  );
};
