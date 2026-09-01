import 'server-only';

import { Resend } from 'resend';

import { env } from '@/lib/env';
import { signActionToken } from '@/lib/change-requests/action-token';
import { escapeHtml, renderEmailFrame } from '@/lib/notifications/email-frame';
import { toPlainText } from '@/lib/rich-text';

// ⚠ RICH-TEXT FIELDS ARE STRIPPED BEFORE THEY ARE ESCAPED.
//
// `justification` and `decision_note` are written in the rich-text editor, so
// the column holds HTML. `escapeHtml` alone would show the approver the markup
// — an HOD would open this and read `<p><strong>Please review</strong> — the
// score was 78.</p>` instead of the sentence. `toPlainText` first, `escapeHtml`
// second: strip the tags, then make the remaining words safe to inline.
//
// Only those two fields. Everything else on `RequestSummary` is a scalar the
// editor never touched (a grade value, a column key, an email address) and is
// escaped exactly as before.

// Server-only. Four email notifications for the change-request workflow.
// All functions are best-effort: they silently no-op when RESEND_API_KEY is
// unset, and per-recipient errors are logged but never thrown. The workflow
// state machine is the source of truth; email is a courtesy nudge.
//
// CTAs deep-link to /markbook/change-requests?req=<id>[&action=...]; the
// page reads the params, scrolls to the row and (for the approver email)
// auto-opens the decision dialog. Absolute URLs require NEXT_PUBLIC_SIS_URL;
// when unset the build still ships but the buttons render relative URLs that
// most email clients won't navigate from. The central warning fires once at
// import time from `lib/env.ts`; the runtime fallback to '' is unchanged.

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

function changeRequestUrl(
  requestId: string,
  action?: 'approve' | 'reject'
): string {
  const origin = env.NEXT_PUBLIC_SIS_URL || '';
  const path = `/markbook/change-requests?req=${encodeURIComponent(requestId)}`;
  const suffix = action ? `&action=${action}` : '';
  return `${origin}${path}${suffix}`;
}

// One-click approve/reject URL for a specific approver. Mints a signed
// action token so the linked confirm page can act without the approver
// logging in. Falls back to the in-app deep-link when signing throws
// (CHANGE_REQUEST_ACTION_SECRET unset) — the email still goes out, the
// button just lands on the normal logged-in flow instead.
function actionTokenUrl(
  requestId: string,
  action: 'approve' | 'reject',
  approverId: string
): string {
  try {
    const token = signActionToken({ requestId, action, approverId });
    const origin = env.NEXT_PUBLIC_SIS_URL || '';
    return `${origin}/change-requests/act?token=${encodeURIComponent(token)}`;
  } catch {
    // Secret unset (or any signing error): degrade to the in-app deep-link.
    return changeRequestUrl(requestId, action);
  }
}

function getTransport(): { resend: Resend; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      '[notify] skipping change-request email: RESEND_API_KEY unset'
    );
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
          <td style="padding: 6px 0; color: #1d1c1d;">${escapeHtml(value)}</td>
        </tr>`
        )
        .join('')}
    </table>
  `;
}

// Fired on: POST /api/change-requests (teacher files a request)
// Recipients: the request's primary + secondary approvers (per KD #41).
// Each approver gets their OWN email — the Approve/Reject buttons carry a
// signed action token unique to that approver, so the one-click confirm
// page can act on their behalf without a login. The buttons fall back to
// the in-app deep-link when token signing is unavailable (secret unset).
// A secondary "review in the app" text link is unchanged.
export async function notifyRequestFiled(
  req: RequestSummary,
  approvers: { id: string; email: string }[]
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  const recipients = approvers.filter((a) => Boolean(a.email));
  if (!t || recipients.length === 0) return { sent: 0, failed: 0 };

  const subject = `New grade change request — ${req.student_label ?? 'student'}`;
  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      A teacher has filed a request to edit a locked grading sheet.
    </p>
    ${summaryTable(req)}
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      <strong>Justification:</strong><br/>
      <span style="color:#475569;">${escapeHtml(toPlainText(req.justification))}</span>
    </p>
  `;

  // Render + send per approver — the token differs per approverId, so each
  // recipient must get their own html (don't reuse one across recipients).
  let sent = 0;
  let failed = 0;
  for (const approver of recipients) {
    const html = renderEmailFrame({
      headline: 'New grade change request',
      bodyHtml,
      ctas: [
        {
          label: 'Approve',
          href: actionTokenUrl(req.id, 'approve', approver.id),
          variant: 'primary',
        },
        {
          label: 'Reject',
          href: actionTokenUrl(req.id, 'reject', approver.id),
          variant: 'destructive',
        },
        {
          label: 'To review the request, click here',
          href: changeRequestUrl(req.id),
          variant: 'secondary-text',
        },
      ],
    });
    const res = await sendAll(
      t.resend,
      t.from,
      [approver.email],
      subject,
      html
    );
    sent += res.sent;
    failed += res.failed;
  }
  return { sent, failed };
}

// Fired on: PATCH approve
// Recipients: the teacher who filed it + all registrar users.
export async function notifyRequestApproved(
  req: RequestSummary,
  teacherEmail: string,
  applierEmails: string[]
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t) return { sent: 0, failed: 0 };

  const recipients = Array.from(
    new Set([teacherEmail, ...applierEmails])
  ).filter(Boolean);
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const subject = `Grade change approved — ${req.student_label ?? 'student'}`;
  // ⚠ THE "IS THERE A NOTE?" TEST READS THE PROSE, NOT THE COLUMN. An
  // approver who opened the note box and typed nothing stores `<p></p>` —
  // truthy, seven characters — so testing `req.decision_note` would print an
  // empty "Note:" heading under every such approval.
  const decisionNote = toPlainText(req.decision_note);
  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      Your grade change request has been approved by
      <strong>${escapeHtml(req.reviewed_by_email ?? 'an administrator')}</strong>.
      The registrar will apply it shortly.
    </p>
    ${summaryTable(req)}
    ${
      decisionNote
        ? `<p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;"><strong>Note:</strong> ${escapeHtml(decisionNote)}</p>`
        : ''
    }
  `;
  const html = renderEmailFrame({
    headline: 'Grade change request approved',
    bodyHtml,
    ctas: [{ label: 'View approved request', href: changeRequestUrl(req.id) }],
  });
  return sendAll(t.resend, t.from, recipients, subject, html);
}

// Fired on: PATCH reject
// Recipients: the teacher who filed it.
export async function notifyRequestRejected(
  req: RequestSummary,
  teacherEmail: string
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t || !teacherEmail) return { sent: 0, failed: 0 };

  const subject = `Grade change request declined — ${req.student_label ?? 'student'}`;
  // Same reason as the approval email: an empty rich-text document is not a
  // reason, so it falls through to the placeholder rather than printing blank.
  const decisionNote = toPlainText(req.decision_note) || '(no reason provided)';
  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      Your grade change request was declined by
      <strong>${escapeHtml(req.reviewed_by_email ?? 'an administrator')}</strong>.
    </p>
    ${summaryTable(req)}
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      <strong>Reason given:</strong><br/>
      <span style="color:#475569;">${escapeHtml(decisionNote)}</span>
    </p>
  `;
  const html = renderEmailFrame({
    headline: 'Grade change request declined',
    bodyHtml,
    ctas: [{ label: 'View declined request', href: changeRequestUrl(req.id) }],
  });
  return sendAll(t.resend, t.from, [teacherEmail], subject, html);
}

// Lightweight summary type for the lazy reminder fan-out. Carries only the
// fields the reminder email + deep-link CTA need — separate from the full
// RequestSummary so callers in the GET inbox path don't have to hydrate
// labels for every candidate row.
export type ApprovedStaleSummary = {
  id: string;
  student_label: string | null;
  field_changed: string;
  approved_at: string;
  grading_sheet_id: string;
};

function staleRowsTable(rows: ApprovedStaleSummary[]): string {
  const cell =
    'padding: 8px 12px; color: #1d1c1d; border-bottom: 1px solid #eaeaea; font-size: 14px; vertical-align: top;';
  const headerCell =
    'padding: 8px 12px; color: #64748B; border-bottom: 1px solid #eaeaea; font-size: 12px; text-align: left; font-weight: 600;';
  const body = rows
    .map((r) => {
      const approvedMs = Date.parse(r.approved_at);
      const days = Number.isFinite(approvedMs)
        ? Math.max(0, Math.floor((Date.now() - approvedMs) / 86_400_000))
        : 0;
      const dayLabel = days === 1 ? '1 day ago' : `${days} days ago`;
      return `
        <tr>
          <td style="${cell}">${escapeHtml(r.student_label ?? '(student)')}</td>
          <td style="${cell}">${escapeHtml(r.field_changed)}</td>
          <td style="${cell}">${escapeHtml(dayLabel)}</td>
          <td style="${cell}"><a href="${changeRequestUrl(r.id)}" style="color:#004aad;text-decoration:underline;">Open request</a></td>
        </tr>`;
    })
    .join('');
  return `
    <table style="width: 100%; border-collapse: collapse; margin: 12px 0 16px;">
      <thead>
        <tr>
          <th style="${headerCell}">Student</th>
          <th style="${headerCell}">Field</th>
          <th style="${headerCell}">Approved</th>
          <th style="${headerCell}"></th>
        </tr>
      </thead>
      <tbody>
        ${body}
      </tbody>
    </table>
  `;
}

// Fired on: GET /api/change-requests when the lazy reminder candidate scan
// finds approved-but-not-applied requests older than 3 days. Recipients:
// the registrar list (they're the ones who apply approved requests).
// Idempotent via reminder_sent_at on each row — the GET handler stamps it
// before this fan-out so concurrent inbox loads don't double-send.
export async function notifyApprovedNotApplied(
  rows: ApprovedStaleSummary[],
  registrarEmails: string[]
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t || rows.length === 0 || registrarEmails.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const recipients = Array.from(new Set(registrarEmails)).filter(Boolean);
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const subject = 'Reminder: change request approved but not yet applied';
  const headerCount =
    rows.length === 1
      ? '1 approved change request'
      : `${rows.length} approved change requests`;
  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      ${headerCount} ${rows.length === 1 ? 'is' : 'are'} still waiting to be applied to a locked sheet. Open each one to review and apply, or close it out if it's no longer needed.
    </p>
    ${staleRowsTable(rows)}
    <p style="font-size:14px;line-height:22px;color:#475569;margin:0 0 16px;">
      You're getting this once per request — we won't keep nagging.
    </p>
  `;
  const html = renderEmailFrame({
    headline: 'Approved changes still waiting',
    bodyHtml,
    ctas: [
      {
        label: 'Open change requests',
        href: `${env.NEXT_PUBLIC_SIS_URL}/markbook/change-requests`,
      },
    ],
  });
  return sendAll(t.resend, t.from, recipients, subject, html);
}

// Fired on: PATCH entries (Path A) with change_request_id.
// Recipients: the teacher + any approver emails provided.
export async function notifyRequestApplied(
  req: RequestSummary,
  teacherEmail: string,
  approverEmails: string[]
): Promise<{ sent: number; failed: number }> {
  const t = getTransport();
  if (!t) return { sent: 0, failed: 0 };

  const recipients = Array.from(
    new Set([teacherEmail, ...approverEmails])
  ).filter(Boolean);
  if (recipients.length === 0) return { sent: 0, failed: 0 };

  const subject = `Grade change applied — ${req.student_label ?? 'student'}`;
  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      An approved grade change has been applied to the locked sheet.
    </p>
    ${summaryTable(req)}
  `;
  const html = renderEmailFrame({
    headline: 'Grade change applied',
    bodyHtml,
    ctas: [{ label: 'View applied change', href: changeRequestUrl(req.id) }],
  });
  return sendAll(t.resend, t.from, recipients, subject, html);
}
