# Documentation — Système d'e-mails (`server/src/lib/mailer.ts`)

## 1. Architecture

Le module d'envoi d'e-mails repose sur **Nodemailer (SMTP)** avec :

- **Transport lazy singleton** ([mailer.ts](../src/lib/mailer.ts)) :
  - `secure: port === 465` (TLS implicite sur le port 465, STARTTLS sur 587/2525).
  - Timeouts configurés (`connectionTimeout: 10s`, `greetingTimeout: 10s`, `socketTimeout: 15s`) pour éviter tout blocage de requête HTTP si le serveur SMTP ne répond pas.
  - Vérification non bloquante au démarrage via `verifyMailTransport()` dans [server.ts](../src/server.ts).
- **Layout HTML unifié** ([base-layout.ts](../src/lib/mailer/base-layout.ts)) :
  - Charte responsive LogCard + version texte brut (`text`) systématique.
  - Échappement HTML (`escapeHtml`) sur toutes les données dynamiques (protection XSS).
  - Salutation propre via `formatGreeting(name)` (`"Bonjour Awa,"` ou `"Bonjour,"`).
  - Logo affiché uniquement si `LOGO_PATH` est une URL publique `http(s)://` (les IP locales/Docker sont automatiquement ignorées afin d'éviter les images cassées dans Gmail/Outlook).

---

## 2. Variables d'environnement

Configurées et validées au démarrage dans [env.ts](../src/config/env.ts) (exemple dans [.env.example](../.env.example)) :

| Variable | Obligatoire | Valeur par défaut | Description |
| --- | :---: | --- | --- |
| `MAILTRAP_SMTP_HOST` | Oui | — | Hôte SMTP (ex. `sandbox.smtp.mailtrap.io` en dev, `smtp-relay.brevo.com` ou `smtp.resend.com` en prod) |
| `MAILTRAP_SMTP_PORT` | Oui | — | Port SMTP (`2525` Mailtrap, `587` STARTTLS, `465` SMTPS) |
| `MAILTRAP_SMTP_USER` | Oui | — | Identifiant SMTP |
| `MAILTRAP_SMTP_PASSWORD` | Oui | — | Mot de passe / clé API SMTP |
| `MAIL_FROM_ADDRESS` | Non | `no-reply@logcard.io` | Adresse d'expédition (`From`) |
| `MAIL_FROM_NAME` | Non | `LogCard` | Nom d'expéditeur affiché |
| `PUBLIC_SITE_URL` | Oui | — | Base publique pour les liens (vérification, reset, suivi carte, prospects) |
| `LOGO_PATH` | Non | `${PUBLIC_SITE_URL}/images/Logo.png` | URL publique HTTPS du logo dans les e-mails |

---

## 3. Politique d'erreur : Strict vs Best-Effort

`sendMail(payload, { bestEffort })` distingue deux comportements :

1. **Mode strict (`bestEffort: false`, par défaut)** :
   - Utilisé lorsque l'e-mail **est l'action principale demandée** (mot de passe oublié, renvoi de vérification, invitation administrateur).
   - En cas d'échec SMTP, loggue `ERROR` (`errorName`, `errorCode`, `errorMessage`) et lève **`502 Bad Gateway` (`EMAIL_DELIVERY_FAILED`)**.
2. **Mode best-effort (`bestEffort: true`)** :
   - Utilisé pour les **notifications secondaires** (inscription, nouveau prospect, commande de carte, alerte sécurité, confirmation d'abonnement, suppression de compte, sticker activé).
   - En cas d'échec SMTP, loggue `WARN` sans faire échouer l'opération métier déjà persistée en base.

---

## 4. Catalogue des e-mails envoyés

| # | Fonction | Déclencheur | Mode |
| --- | --- | --- | --- |
| 1 | `sendVerificationEmail` | Inscription (`register` en best-effort), renvoi manuel (`resendVerification` en strict), changement d'e-mail (`updateProfile`) | Best-effort / Strict |
| 2 | `sendForgotPasswordMail` | Demande de réinitialisation (`POST /api/auth/forgot-password`, lien 30 min) | Strict (`502`) |
| 3 | `sendAdminInvitationEmail` | Création ou renvoi d'invitation administrateur (lien 24 h) | Strict (`502`) |
| 4 | `sendCallbackRequestEmail` | Nouveau prospect « Échangez contact » sur une fiche publique | Best-effort |
| 5 | `sendAccountDeletionScheduledEmail` | Demande de suppression de compte (délai de grâce 30 jours) | Best-effort |
| 6 | `sendAccountDeletedByAdminEmail` | Suppression définitive d'un compte par un administrateur | Best-effort |
| 7 | `sendSectionStickerActivatedEmail` | Génération/activation d'un sticker de section par l'admin | Best-effort |
| 8 | `sendCardOrderEmail` | Commande de carte NFC (`envoyee`) + mise à jour admin (`traitee`, `livree`) | Best-effort |
| 9 | `sendSecurityAlertEmail` | Changement de mot de passe, activation 2FA, désactivation 2FA | Best-effort |
| 10 | `sendSubscriptionConfirmedEmail` | Confirmation de paiement / activation d'une formule | Best-effort |

---

## 5. Checklist mise en production

1. Remplacer les identifiants Mailtrap sandbox par un fournisseur SMTP transactionnel (Brevo, Resend, Postmark, SES…).
2. Configurer les enregistrements DNS **SPF**, **DKIM** et **DMARC** sur le domaine de `MAIL_FROM_ADDRESS`.
3. Vérifier que `PUBLIC_SITE_URL` et `LOGO_PATH` pointent vers le domaine HTTPS public.
4. Vérifier dans les logs de démarrage la présence de `SMTP transport verified`.
