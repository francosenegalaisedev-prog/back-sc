export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const formatGreeting = (name?: string | null): string => {
  const clean = name?.trim();
  return clean ? `Bonjour ${clean},` : "Bonjour,";
};

export const isPublicImageUrl = (url?: string | null): boolean => {
  if (!url) return false;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  // Évite d'embarquer une IP privée / locale inaccessible depuis Gmail/Outlook
  return !/^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(
    trimmed,
  );
};

export interface BaseEmailOptions {
  title: string;
  preheader: string;
  heading: string;
  greetingName?: string | null;
  bodyHtml: string;
  cta?: { label: string; url: string };
  notice?: string;
  logoUrl?: string;
  year?: string;
}

export function renderBaseEmail(options: BaseEmailOptions): string {
  const year = options.year ?? String(new Date().getFullYear());
  const safeTitle = escapeHtml(options.title);
  const safePreheader = escapeHtml(options.preheader);
  const safeHeading = escapeHtml(options.heading);
  const safeGreeting = escapeHtml(formatGreeting(options.greetingName));
  const showLogo = isPublicImageUrl(options.logoUrl);
  const safeLogo = showLogo ? escapeHtml(options.logoUrl!.trim()) : "";
  const safeCtaUrl = options.cta ? escapeHtml(options.cta.url) : "";
  const safeCtaLabel = options.cta ? escapeHtml(options.cta.label) : "";

  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${safeTitle} – LogCard</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;">
    ${safePreheader}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="height:6px;background-color:#b91c1c;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          ${
            showLogo
              ? `<tr>
            <td align="center" style="padding:28px 24px 8px 24px;background-color:#ffffff;">
              <img src="${safeLogo}" alt="LogCard" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0;outline:none;" />
            </td>
          </tr>`
              : `<tr>
            <td align="center" style="padding:24px 24px 4px 24px;font-family:Arial,Helvetica,sans-serif;">
              <span style="font-size:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#111111;">Log<span style="color:#b91c1c;">Card</span></span>
            </td>
          </tr>`
          }
          <tr>
            <td style="padding:20px 36px 8px 36px;font-family:Arial,Helvetica,sans-serif;color:#111111;">
              <h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;font-weight:700;color:#111111;">
                ${safeHeading}
              </h1>
              <p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#374151;">
                ${safeGreeting}
              </p>
              <div style="font-size:15px;line-height:24px;color:#374151;">
                ${options.bodyHtml}
              </div>
            </td>
          </tr>
          ${
            options.cta
              ? `<tr>
            <td align="center" style="padding:16px 36px 24px 36px;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${safeCtaUrl}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="15%" stroke="f" fillcolor="#b91c1c">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${safeCtaLabel}</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${safeCtaUrl}" target="_blank"
                 style="display:inline-block;background-color:#b91c1c;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;padding:0 32px;border-radius:8px;">
                ${safeCtaLabel}
              </a>
              <!--<![endif]-->
            </td>
          </tr>`
              : ""
          }
          ${
            options.notice
              ? `<tr>
            <td style="padding:8px 36px 28px 36px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">
                ${escapeHtml(options.notice)}
              </p>
            </td>
          </tr>`
              : `<tr><td style="height:20px;">&nbsp;</td></tr>`
          }
          <tr>
            <td align="center" style="background-color:#111111;padding:22px 36px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:3px;color:#ffffff;text-transform:uppercase;">
                Connecter <span style="color:#dc2626;">&bull;</span> Partager <span style="color:#dc2626;">&bull;</span> Simplifier
              </p>
              <p style="margin:0;font-size:12px;line-height:18px;color:#9ca3af;">
                &copy; ${escapeHtml(year)} LogCard. Tous droits réservés.<br />
                Cet e-mail a été envoyé automatiquement, merci de ne pas y répondre.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
