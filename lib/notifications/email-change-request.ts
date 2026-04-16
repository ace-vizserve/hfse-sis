import { Resend } from 'resend';

// Server-only. Four email notifications for the change-request workflow.
// All functions are best-effort: they silently no-op when RESEND_API_KEY is
// unset, and per-recipient errors are logged but never thrown. The workflow
// state machine is the source of truth; email is a courtesy nudge.
//
// Templates are kept simple on purpose — Chandana and teachers already see
// full context in-app, the email just tells them "go look at the app."

type RequestSummary = {
  id: string;
  grading_sheet_id: string;
  field_changed: string;
  current_value: string | null;
  proposed_value: string;
  reason_category: string;
  justification: string;
  requested_by_email: string;
  requested_at: string;
  reviewed_by_email?: string | null;
  decision_note?: string | null;
  student_label?: string | null;
  sheet_label?: string | null;
};

function getTransport(): { resend: Resend; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[notify] skipping change-request email: RESEND_API_KEY unset');
    return null;
  }
  const from =
    process.env.RESEND_FROM_EMAIL ?? 'HFSE Markbook <noreply@hfse.edu.sg>';
  return { resend: new Resend(apiKey), from };
}

async function sendAll(
  resend: Resend,
  from: string,
  recipients: string[],
  subject: string,
  html: string,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const devTo = process.env.NODE_ENV !== 'production' ? 'ace.vizserve@gmail.com' : null;
  for (const to of recipients) {
    try {
      const res = await resend.emails.send({ from, to: devTo ?? to, subject, html });
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

function baseFrame(title: string, bodyHtml: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0F172A;">
      <p style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #64748B; margin: 0 0 12px;">
        HFSE International School · Markbook
      </p>
      <h1 style="font-size: 20px; margin: 0 0 16px; color: #0F172A;">${title}</h1>
      ${bodyHtml}
      <p style="line-height: 1.6; font-size: 12px; color: #64748B; margin: 24px 0 0;">
        This is an automated notification from the HFSE Markbook.
      </p>
    </div>
  `;
}

function summaryTable(req: RequestSummary): string {
  const rows: Array<[string, string]> = [
    ['Sheet', req.sheet_label ?? '(sheet)'],
    ['Student', req.student_label ?? '(student)'],
    ['Field', req.field_changed],
    ['Current value', req.current_value ?? '(blank)'],
    ['Proposed value', req.proposed_value],
    ['Reason category', req.reason_category.replace(/_/g, ' ')],
    ['Teacher', req.requested_by_email],
  ];
  return `
    <table style="width: 100%; border-collapse: collapse; margin: 12px 0 16px; font-size: 14px;">
      ${rows
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding: 6px 12px 6px 0; color: #64748B; width: 140px; vertical-align: top;">${label}</td>
          <td style="padding: 6px 0; color: #0F172A;">${escapeHtml(value)}</td>
        </tr>`,
        )
        .join('')}
    </table>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Fired on: POST /api/change-requests (teacher files a request)
// Recipients: all admin users (Chandana + superadmins).
export async function notifyRequestFiled(
  req: RequestSummary,
  approverEmails: string[],
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t || approverEmails.length === 0) return { sent: 0, failed: 0 };

  const subject = `New grade change request — ${req.student_label ?? 'student'}`;
  const html = baseFrame(
    'New grade change request',
    `
      <p style="line-height: 1.6; margin: 0 0 8px;">
        A teacher has filed a request to edit a locked grading sheet. Please review it in the Markbook.
      </p>
      ${summaryTable(req)}
      <p style="line-height: 1.6; margin: 0 0 8px;">
        <strong>Justification:</strong><br/>
        <span style="color: #475569;">${escapeHtml(req.justification)}</span>
      </p>
    `,
  );
  return sendAll(t.resend, t.from, approverEmails, subject, html);
}

// Fired on: PATCH approve
// Recipients: the teacher who filed it + all registrar users (Joann).
export async function notifyRequestApproved(
  req: RequestSummary,
  teacherEmail: string,
  applierEmails: string[],
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t) return { sent: 0, failed: 0 };

  const recipients = Array.from(new Set([teacherEmail, ...applierEmails])).filter(Boolean);
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const subject = `Grade change approved — ${req.student_label ?? 'student'}`;
  const html = baseFrame(
    'Grade change request approved',
    `
      <p style="line-height: 1.6; margin: 0 0 8px;">
        Your grade change request has been approved by
        <strong>${escapeHtml(req.reviewed_by_email ?? 'an administrator')}</strong>.
        The registrar will apply it shortly.
      </p>
      ${summaryTable(req)}
      ${
        req.decision_note
          ? `<p style="line-height: 1.6; margin: 0 0 8px;"><strong>Note:</strong> ${escapeHtml(req.decision_note)}</p>`
          : ''
      }
    `,
  );
  return sendAll(t.resend, t.from, recipients, subject, html);
}

// Fired on: PATCH reject
// Recipients: the teacher who filed it.
export async function notifyRequestRejected(
  req: RequestSummary,
  teacherEmail: string,
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t || !teacherEmail) return { sent: 0, failed: 0 };

  const subject = `Grade change request declined — ${req.student_label ?? 'student'}`;
  const html = baseFrame(
    'Grade change request declined',
    `
      <p style="line-height: 1.6; margin: 0 0 8px;">
        Your grade change request was declined by
        <strong>${escapeHtml(req.reviewed_by_email ?? 'an administrator')}</strong>.
      </p>
      ${summaryTable(req)}
      <p style="line-height: 1.6; margin: 0 0 8px;">
        <strong>Reason given:</strong><br/>
        <span style="color: #475569;">${escapeHtml(req.decision_note ?? '(no reason provided)')}</span>
      </p>
    `,
  );
  return sendAll(t.resend, t.from, [teacherEmail], subject, html);
}

// Fired on: PATCH entries (Path A) with change_request_id.
// Recipients: the teacher + any approver emails provided (Chandana FYI).
export async function notifyRequestApplied(
  req: RequestSummary,
  teacherEmail: string,
  approverEmails: string[],
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t) return { sent: 0, failed: 0 };

  const recipients = Array.from(new Set([teacherEmail, ...approverEmails])).filter(Boolean);
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const subject = `Grade change applied — ${req.student_label ?? 'student'}`;
  const html = baseFrame(
    'Grade change applied',
    `
      <p style="line-height: 1.6; margin: 0 0 8px;">
        An approved grade change has been applied to the locked sheet.
      </p>
      ${summaryTable(req)}
    `,
  );
  return sendAll(t.resend, t.from, recipients, subject, html);
}
