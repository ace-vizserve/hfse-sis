import 'server-only';

// HFSE corporate-branded email frame. Used by every transactional email
// template in lib/notifications/. Mirrors the parent-portal account-
// confirmation template (same logo URL, system-font stack, #004aad navy
// button, school address + PEI registration footer) so SIS emails read
// as part of the same brand family.
//
// Emails MUST stay table-based and inline-CSS — most email clients (Outlook
// in particular) ignore <link>, <style>, flexbox, gap, and CSS variables.
// Don't refactor toward semantic HTML / Tailwind / CSS-in-JS here.

const LOGO_URL =
  'https://vnhklhppftebbcuupfjw.supabase.co/storage/v1/object/public/parent-portal//hfse-logo.png';

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif";

const COLOR_INK = '#1d1c1d';
const COLOR_PRIMARY = '#004aad';
const COLOR_DESTRUCTIVE = '#dc2626';
const COLOR_FOOTER = '#6b6b6b';
const COLOR_HAIRLINE = '#eaeaea';

export type EmailCta = {
  label: string;
  href: string;
  /** Defaults to `'primary'` when omitted. `'primary'` and `'destructive'`
   *  render as buttons (side-by-side when more than one); `'secondary-text'`
   *  renders as a centered text link below the button row. */
  variant?: 'primary' | 'destructive' | 'secondary-text';
};

export type EmailFrameInput = {
  /** The big serif-style headline shown above the body. */
  headline: string;
  /** Inline HTML for the body. Caller is responsible for escaping any
   *  user-controlled values via escapeHtml() before composing this string. */
  bodyHtml: string;
  /** Zero or more CTAs. Buttons render side-by-side; secondary-text renders
   *  as a centered text link below the buttons. */
  ctas?: EmailCta[];
  /** Optional "if the button doesn't work, copy this link" paragraph below
   *  the CTAs. Caller passes the already-rendered HTML. */
  reviewLinkHtml?: string;
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape text that came out of a formatting editor, keeping its line breaks.
 *
 * These fields are written in a rich-text box and stripped to plain text with
 * `toPlainText` before they reach an email. That leaves the paragraphs and
 * bullets as `\n`-separated lines — and a newline in HTML source collapses to
 * a single space, so a three-bullet rejection reason would arrive at a parent
 * as one run-on sentence.
 *
 * Pass ALREADY-STRIPPED text. Escaping happens here, so the `<br />` this adds
 * is the only markup that survives.
 */
export function escapeLines(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br />');
}

// Encode the two characters that matter inside an HTML attribute value.
// HTML spec requires `&` to be `&amp;` in attribute values; Outlook's
// strict parser misparses query-string ampersands without it. We also
// encode `"` so a stray quote in the URL can't close the attribute.
function safeHref(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function renderButton(cta: EmailCta): string {
  const bg = cta.variant === 'destructive' ? COLOR_DESTRUCTIVE : COLOR_PRIMARY;
  return `
    <a href="${safeHref(cta.href)}" style="background:${bg};color:white;padding:14px 24px;border-radius:6px;text-decoration:none;font-size:16px;font-weight:600;display:inline-block;">
      ${escapeHtml(cta.label)}
    </a>
  `;
}

function renderCtas(ctas: EmailCta[]): string {
  if (ctas.length === 0) return '';

  const buttons = ctas.filter((c) => c.variant !== 'secondary-text');
  const textLinks = ctas.filter((c) => c.variant === 'secondary-text');

  let buttonRow = '';
  if (buttons.length === 1) {
    buttonRow = `
      <table align="center" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td align="center">${renderButton(buttons[0])}</td>
        </tr>
      </table>
    `;
  } else if (buttons.length >= 2) {
    // Side-by-side via a 2-cell inner table (email-safe; no flex).
    buttonRow = `
      <table align="center" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 24px;">
        <tr>
          ${buttons
            .map(
              (b) =>
                `<td align="center" style="padding:0 6px;">${renderButton(b)}</td>`
            )
            .join('')}
        </tr>
      </table>
    `;
  }

  const textLinkRow = textLinks
    .map(
      (t) => `
        <p style="text-align:center;font-size:14px;line-height:24px;margin:0 0 16px;">
          <a href="${safeHref(t.href)}" style="color:${COLOR_PRIMARY};text-decoration:underline;">
            ${escapeHtml(t.label)}
          </a>
        </p>
      `
    )
    .join('');

  return buttonRow + textLinkRow;
}

export function renderEmailFrame(input: EmailFrameInput): string {
  const ctasHtml = renderCtas(input.ctas ?? []);
  const reviewHtml = input.reviewLinkHtml ?? '';
  const year = new Date().getFullYear();

  return `<html dir="ltr" lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(input.headline)}</title>
  </head>
  <body style="background-color:#ffffff;margin:0 auto;font-family:${FONT_STACK};">
    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:37.5em;margin:0 auto;padding:0 20px;">
      <tbody>
        <tr style="width:100%">
          <td>

            <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:32px;">
              <tbody>
                <tr>
                  <td>
                    <img alt="HFSE International School" height="auto" src="${LOGO_URL}" style="display:block;outline:none;border:none;text-decoration:none" width="160" />
                  </td>
                </tr>
              </tbody>
            </table>

            <h1 style="color:${COLOR_INK};font-size:28px;font-weight:700;margin:30px 0 16px;padding:0;line-height:36px;">
              ${escapeHtml(input.headline)}
            </h1>

            ${input.bodyHtml}

            ${ctasHtml}

            ${reviewHtml}

            <hr style="margin:32px 0;border:none;border-top:1px solid ${COLOR_HAIRLINE};" />

            <p style="font-size:12px;line-height:20px;color:${COLOR_FOOTER};text-align:left;margin-bottom:4px;">
              +65 6451 0080<br />
              223 Mountbatten Road, #01-08, Singapore 398008
            </p>

            <p style="font-size:12px;line-height:20px;color:${COLOR_FOOTER};text-align:left;margin-bottom:4px;">
              PEI Registration No.: 201541283N<br />
              Valid: 26 March 2025 – 25 March 2029
            </p>

            <p style="font-size:12px;line-height:20px;color:${COLOR_FOOTER};text-align:left;">
              © ${year} HFSE International School. All rights reserved.
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
}
