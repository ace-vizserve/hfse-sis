import 'server-only';

import { Resend } from 'resend';

import { escapeHtml, renderEmailFrame } from '@/lib/notifications/email-frame';

// Server-only. Asks a family to finish an enrolment record through a recovery
// link. Subject and message are the portal's (`_shared/recovery-email.ts`), so a
// family gets the same email whichever app sends it.
//
// Never throws. By the time this runs the link exists and works, so a failed
// send must not lose it: the caller shows the link to copy and send by hand.

export const RECOVERY_EMAIL_SUBJECT =
  'Action Required: Complete Your Enrollment Information';

export type RecoveryEmailResult = { ok: true } | { ok: false; error: string };

const PARAGRAPH =
  'font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;';

function bodyHtml(): string {
  return [
    'Dear Parent,',
    'Good day!',
    "We hope this message finds you well. We're reaching out regarding your child's enrollment application — due to a technical issue on our end, some of the enrollment details you previously submitted were not fully saved in our system.",
    "We sincerely apologize for the inconvenience this may cause. To ensure your child's enrollment record is complete and accurate, we kindly ask you to re-enter the affected information using the link below:",
  ]
    .map((text) => `<p style="${PARAGRAPH}">${escapeHtml(text)}</p>`)
    .join('\n');
}

function afterButtonHtml(url: string): string {
  const closing = [
    'The form should only take a few minutes to complete. Once submitted, your enrollment record will be updated accordingly.',
    "If you have any questions or experience any issues while completing the form, please feel free to reply to this email and we'll be happy to assist you.",
    'Thank you for your understanding and cooperation.',
  ]
    .map((text) => `<p style="${PARAGRAPH}">${escapeHtml(text)}</p>`)
    .join('\n');

  return `
    <p style="font-size:14px;line-height:24px;color:#1d1c1d;margin:0 0 16px;">
      If the button above doesn't work, copy and paste this link into your browser:
      <br />
      <span style="color:#004aad;word-break:break-all;">${escapeHtml(url)}</span>
    </p>
    ${closing}
  `;
}

export async function sendRecoveryLinkEmail(
  recipients: string[],
  url: string
): Promise<RecoveryEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[notify] skipping recovery email: RESEND_API_KEY unset');
    return { ok: false, error: 'Email is not set up on this server.' };
  }

  const from =
    process.env.RESEND_FROM_EMAIL ?? 'HFSE SIS <noreply@hfse.edu.sg>';
  const devTo =
    process.env.NODE_ENV !== 'production' ? 'ace.vizserve@gmail.com' : null;
  const html = renderEmailFrame({
    headline: 'Complete Your Enrollment Information',
    bodyHtml: bodyHtml(),
    ctas: [{ label: 'Complete Enrollment Information', href: url }],
    reviewLinkHtml: afterButtonHtml(url),
  });

  try {
    const res = await new Resend(apiKey).emails.send({
      from,
      // The message invites a reply; the SIS sender may be a no-reply address.
      replyTo: 'team@enrol.hfse.edu.sg',
      // One email to all of them, as on the portal: both parents see who else
      // was asked.
      to: devTo ?? recipients,
      subject: RECOVERY_EMAIL_SUBJECT,
      html,
    });
    if (res.error) {
      console.error('[notify] recovery email resend error', res.error.message);
      return {
        ok: false,
        error: `The email could not be sent: ${res.error.message}`,
      };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[notify] recovery email resend throw', message);
    return { ok: false, error: `The email could not be sent: ${message}` };
  }
}
