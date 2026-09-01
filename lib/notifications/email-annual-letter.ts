import 'server-only';

import { Resend } from 'resend';

import {
  escapeHtml,
  escapeLines,
  renderEmailFrame,
} from '@/lib/notifications/email-frame';
import { toPlainText } from '@/lib/rich-text';

// ⚠ `reason` IS RICH TEXT AND IS STRIPPED BEFORE IT IS ESCAPED. It comes from
// the "Reason for change" editor on the Final Grade control, so the column
// holds HTML; escaping alone would show administrators the tags. The seven
// values in the summary table are scalars (a student name, a subject code, the
// grade before and after) and are escaped exactly as before.

// Server-only. Sends a notification to all school_admin + superadmin users
// (excluding the actor) when annual_letter_grade is changed on a non-examinable
// subject. Best-effort: silently no-ops when RESEND_API_KEY is unset.

type AnnualLetterChangePayload = {
  studentName: string;
  subjectCode: string;
  sectionName: string;
  termLabel: string;
  before: string | null;
  after: string | null;
  reason: string;
  actorEmail: string;
};

function getTransport(): { resend: Resend; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[notify] skipping annual-letter email: RESEND_API_KEY unset');
    return null;
  }
  const from =
    process.env.RESEND_FROM_EMAIL ?? 'HFSE SIS <noreply@hfse.edu.sg>';
  return { resend: new Resend(apiKey), from };
}

async function sendAll(
  resend: Resend,
  from: string,
  recipients: string[],
  subject: string,
  html: string
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const devTo =
    process.env.NODE_ENV !== 'production' ? 'ace.vizserve@gmail.com' : null;
  for (const to of recipients) {
    try {
      const res = await resend.emails.send({
        from,
        to: devTo ?? to,
        subject,
        html,
      });
      if (res.error) {
        failed += 1;
        console.error('[notify] resend error for', to, res.error);
      } else {
        sent += 1;
      }
    } catch (e) {
      failed += 1;
      console.error('[notify] resend throw for', to, e);
    }
  }
  return { sent, failed };
}

export async function notifyAnnualLetterChanged(
  payload: AnnualLetterChangePayload,
  recipientEmails: string[]
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t || recipientEmails.length === 0) return { sent: 0, failed: 0 };

  const rows: Array<[string, string]> = [
    ['Student', payload.studentName],
    ['Subject', payload.subjectCode],
    ['Section', payload.sectionName],
    ['Term', payload.termLabel],
    ['Previous value', payload.before ?? '(none)'],
    ['New value', payload.after ?? '(cleared)'],
    ['Changed by', payload.actorEmail],
  ];

  const tableHtml = `
    <table style="width: 100%; border-collapse: collapse; margin: 12px 0 16px; font-size: 14px;">
      ${rows
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding: 6px 12px 6px 0; color: #64748B; width: 140px; vertical-align: top;">${label}</td>
          <td style="padding: 6px 0; color: #1d1c1d;">${escapeHtml(value)}</td>
        </tr>`
        )
        .join('')}
    </table>
  `;

  const subject = `Final grade changed — ${payload.studentName} · ${payload.subjectCode}`;
  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      The year-end Final Grade for a non-examinable subject has been updated.
    </p>
    ${tableHtml}
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      <strong>Reason given:</strong><br/>
      <span style="color:#475569;">${escapeLines(toPlainText(payload.reason))}</span>
    </p>
    <p style="font-size:13px;line-height:20px;color:#94A3B8;margin:0;">
      This notification was sent to all school administrators. This change is logged in the Markbook audit log.
    </p>
  `;

  const html = renderEmailFrame({
    headline: 'Final grade updated',
    bodyHtml,
    ctas: [],
  });

  return sendAll(t.resend, t.from, recipientEmails, subject, html);
}
