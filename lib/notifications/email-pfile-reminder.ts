import 'server-only';

import { Resend } from 'resend';

import {
  escapeHtml,
  escapeLines,
  renderEmailFrame,
} from '@/lib/notifications/email-frame';
import { toPlainText } from '@/lib/rich-text';

// ⚠ `rejectionReason` IS THE ONLY RICH-TEXT VALUE IN THIS FILE and is stripped
// before it is escaped. The officer types it in the rich-text editor on the
// reject dialog, so the column holds HTML; escaping alone would send a parent
// a blockquote full of tags. Every other value here — slot label, student
// name, class, the formatted expiry date — is a scalar this app composed.

// Server-only. Best-effort renewal-reminder email to the parent(s) tied
// to a P-Files document slot. Mirrors the send/dev-redirect pattern of
// `email-parents-publication.ts` per KD #16 + KD #29.

export type SlotStatusKind =
  | 'expired'
  | 'expiringSoon'
  | 'rejected'
  | 'missing'
  | 'toFollow';

// `kind` selects the email tone:
//   - 'renewal' (default): post-enrolment chase aimed at parents whose
//     valid documents are nearing expiry or already expired. Used by
//     P-Files for enrolled-student renewal lifecycle.
//   - 'initial-chase': pre-enrolment chase aimed at parents who haven't
//     completed an applicant document slot yet (Pending/Rejected/Uploaded
//     awaiting validation). Used by Admissions during the application
//     funnel — copy stresses "completing the application" rather than
//     "renewing existing docs".
//   - 'rejection': fired automatically when a P-File Officer or academic
//     coordinator rejects a parent-uploaded document via the document
//     validation queue.
//     Includes the specific rejection reason so the parent knows exactly
//     what to fix before re-uploading. Bypasses the runNotify() 24h cooldown
//     because rejection is a discrete event, not a recurring chase reminder.
export type ReminderKind = 'renewal' | 'initial-chase' | 'rejection';

export type ReminderContext = {
  studentName: string;
  level: string | null;
  section: string | null;
  slotKey: string;
  slotLabel: string;
  statusKind: SlotStatusKind;
  expiryDateIso: string | null; // for expired / expiringSoon
  kind?: ReminderKind; // default 'renewal' for back-compat
  /** Required when kind='rejection'. The verbatim reason the officer entered
   *  when rejecting the document — included in the email body so the parent
   *  knows exactly what to fix before re-uploading. */
  rejectionReason?: string;
  /** Enrolee number for the AY whose docs slot is being chased. Used to
   *  build the parent-portal upload deep-link. */
  enroleeNumber: string;
  /** AY code in canonical uppercase form (e.g. 'AY2026'). Lower-cased to
   *  the `ay{YYYY}` URL slug per KD #53 when constructing the deep-link. */
  ayCode: string;
};

export type RecipientCandidate = {
  email: string;
  role: 'mother' | 'father' | 'guardian';
};

/** A single email envelope representing one send: one To address + zero or
 *  more Cc addresses. Replaces the multi-recipient `RecipientCandidate[]`
 *  pattern so each notify call maps to exactly one Resend send. */
export type RecipientEnvelope =
  | {
      kind: 'parent';
      to: string;
      cc: string[];
      primaryRole: 'mother' | 'father' | 'guardian';
    }
  | { kind: 'none'; reason: 'no-parent-emails' };

// Resolve which parent email addresses receive a reminder for a given
// slot, collapsed to a single envelope. Mother-prefixed slots go to the
// mother only; father-prefixed to the father; guardian-prefixed to the
// guardian. Student slots (passport, pass, idPicture, etc.) go to mother
// as To + father as Cc, falling back to guardian when both are missing.
export function resolveRecipients(
  slotKey: string,
  emails: {
    motherEmail: string | null;
    fatherEmail: string | null;
    guardianEmail: string | null;
  }
): RecipientEnvelope {
  const motherEmail = emails.motherEmail?.trim() || null;
  const fatherEmail = emails.fatherEmail?.trim() || null;
  const guardianEmail = emails.guardianEmail?.trim() || null;

  if (slotKey.startsWith('mother')) {
    return motherEmail
      ? { kind: 'parent', to: motherEmail, cc: [], primaryRole: 'mother' }
      : { kind: 'none', reason: 'no-parent-emails' };
  }
  if (slotKey.startsWith('father')) {
    return fatherEmail
      ? { kind: 'parent', to: fatherEmail, cc: [], primaryRole: 'father' }
      : { kind: 'none', reason: 'no-parent-emails' };
  }
  if (slotKey.startsWith('guardian')) {
    return guardianEmail
      ? { kind: 'parent', to: guardianEmail, cc: [], primaryRole: 'guardian' }
      : { kind: 'none', reason: 'no-parent-emails' };
  }

  // Student-owned slot — mother as To, father as Cc, fallback guardian.
  if (motherEmail) {
    return {
      kind: 'parent',
      to: motherEmail,
      cc: fatherEmail ? [fatherEmail] : [],
      primaryRole: 'mother',
    };
  }
  if (fatherEmail) {
    return { kind: 'parent', to: fatherEmail, cc: [], primaryRole: 'father' };
  }
  if (guardianEmail) {
    return {
      kind: 'parent',
      to: guardianEmail,
      cc: [],
      primaryRole: 'guardian',
    };
  }
  return { kind: 'none', reason: 'no-parent-emails' };
}

function daysBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso);
  const b = new Date(bIso);
  const ms = a.setHours(0, 0, 0, 0) - b.setHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

function statusDescriptor(ctx: ReminderContext): string {
  const today = new Date().toISOString().slice(0, 10);
  if (ctx.statusKind === 'expired' && ctx.expiryDateIso) {
    const days = daysBetween(today, ctx.expiryDateIso);
    return days <= 0 ? 'expired today' : `expired ${days} days ago`;
  }
  if (ctx.statusKind === 'expiringSoon' && ctx.expiryDateIso) {
    const days = daysBetween(ctx.expiryDateIso, today);
    return days <= 0 ? 'expires today' : `expires in ${days} days`;
  }
  if (ctx.statusKind === 'rejected') return 'needs replacement';
  if (ctx.statusKind === 'toFollow')
    return 'has been promised but not yet received';
  return 'is missing';
}

export type RenderedReminder = {
  subject: string;
  html: string;
};

function parentPortalUploadUrl(
  portalUrl: string,
  enroleeNumber: string,
  ayCode: string
): string {
  // Lowercased 4-digit AY slug per KD #53.
  const ayCodeLower = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  return `${portalUrl}/admission/enrolments/application/${encodeURIComponent(enroleeNumber)}?academicYear=${ayCodeLower}`;
}

function renderReminder(ctx: ReminderContext): RenderedReminder {
  const portalUrl =
    process.env.NEXT_PUBLIC_PARENT_PORTAL_URL ?? 'https://enrol.hfse.edu.sg';
  const descriptor = statusDescriptor(ctx);
  const kind: ReminderKind = ctx.kind ?? 'renewal';
  const ctaHref = parentPortalUploadUrl(
    portalUrl,
    ctx.enroleeNumber,
    ctx.ayCode
  );

  if (kind === 'rejection') {
    // Stripped first, then defaulted: an editor opened and left alone stores
    // `<p></p>`, which `??` would happily print as an empty quote block.
    const rejectionReason =
      toPlainText(ctx.rejectionReason) || '(no reason provided)';
    const sectionLabel =
      ctx.level && ctx.section
        ? `${ctx.level} ${ctx.section}`
        : (ctx.level ?? ctx.section ?? '');
    const subject = `Action needed: ${ctx.slotLabel} not accepted — ${ctx.studentName}`;
    const headline = `${ctx.slotLabel} — document not accepted`;
    const bodyHtml = `
      <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
        Dear Parent / Guardian,
      </p>
      <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
        The <strong>${escapeHtml(ctx.slotLabel)}</strong> submitted for
        <strong>${escapeHtml(ctx.studentName)}</strong>${sectionLabel ? ` (${escapeHtml(sectionLabel)})` : ''}
        could not be accepted for the following reason:
      </p>
      <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:4px solid #e2e8f0;background:#f8fafc;color:#334155;font-size:15px;line-height:24px;">
        ${escapeLines(rejectionReason)}
      </blockquote>
      <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
        Please re-upload a corrected document so we can continue processing the enrolment.
      </p>
    `;
    const html = renderEmailFrame({
      headline,
      bodyHtml,
      ctas: [
        {
          label: `Re-upload ${ctx.slotLabel} for ${ctx.studentName}`,
          href: ctaHref,
        },
      ],
      reviewLinkHtml: `
        <p style="font-size:14px;line-height:24px;color:#1d1c1d;margin:0 0 16px;">
          Sign in at the parent portal and upload a replacement document under your
          enrolment details page. If you believe this rejection is in error, please
          contact the school registrar.
        </p>
      `,
    });
    return { subject, html };
  }

  // Subject branching matches the existing kind split.
  const subject =
    kind === 'initial-chase'
      ? `Document follow-up needed: ${ctx.slotLabel} for ${ctx.studentName}`
      : `Document renewal needed: ${ctx.slotLabel} for ${ctx.studentName} (${descriptor})`;

  const sectionLabel =
    ctx.level && ctx.section
      ? `${ctx.level} ${ctx.section}`
      : (ctx.level ?? ctx.section ?? '');

  const headline =
    kind === 'initial-chase'
      ? `${ctx.slotLabel} required to complete application`
      : `${ctx.slotLabel} ${descriptor}`;

  const ctaLabel =
    kind === 'initial-chase'
      ? `Upload ${ctx.slotLabel} for ${ctx.studentName}`
      : `Re-upload ${ctx.slotLabel} for ${ctx.studentName}`;

  const expiryLine = ctx.expiryDateIso
    ? `<p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 12px;">
         <strong>Document expiry:</strong>
         <span style="font-family:monospace;color:#475569;">${escapeHtml(
           new Date(ctx.expiryDateIso).toLocaleDateString('en-SG', {
             year: 'numeric',
             month: 'long',
             day: 'numeric',
           })
         )}</span>
       </p>`
    : '';

  const bodyParagraph =
    kind === 'initial-chase'
      ? `Please upload the <strong>${escapeHtml(ctx.slotLabel)}</strong> for
         <strong>${escapeHtml(ctx.studentName)}</strong>${
           sectionLabel ? ` (${escapeHtml(sectionLabel)})` : ''
         }
         to continue the application. Our records show this document ${escapeHtml(descriptor)}.`
      : `Please re-upload the <strong>${escapeHtml(ctx.slotLabel)}</strong> for
         <strong>${escapeHtml(ctx.studentName)}</strong>${
           sectionLabel ? ` (${escapeHtml(sectionLabel)})` : ''
         }.
         Our records show this document ${escapeHtml(descriptor)}.`;

  const footerParagraph =
    kind === 'initial-chase'
      ? `Sign in at the parent portal with the same email and password you use
         for enrolment, then upload the document under your enrolment
         details page. If you have already submitted this document, please
         contact the school admissions office to confirm receipt.`
      : `Sign in at the parent portal with the same email and password you use
         for enrolment, then re-upload the document under your enrolment
         details page. If you have already submitted this document, please
         contact the school registrar to confirm receipt.`;

  const bodyHtml = `
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      Dear Parent / Guardian,
    </p>
    <p style="font-size:16px;line-height:26px;color:#1d1c1d;margin:0 0 16px;">
      ${bodyParagraph}
    </p>
    ${expiryLine}
  `;

  const html = renderEmailFrame({
    headline,
    bodyHtml,
    ctas: [{ label: ctaLabel, href: ctaHref }],
    reviewLinkHtml: `
      <p style="font-size:14px;line-height:24px;color:#1d1c1d;margin:0 0 16px;">
        ${footerParagraph}
      </p>
    `,
  });

  return { subject, html };
}

export type SendOutcome = {
  recipient: RecipientCandidate;
  ok: boolean;
  error?: string;
};

export type SendResult = {
  attempted: number;
  sent: number;
  failed: number;
  outcomes: SendOutcome[];
};

// Best-effort send. One Resend call for the envelope (To + Cc). Returns
// per-outcome shape for compatibility with callers. No DB writes here.
export async function sendReminder(
  ctx: ReminderContext,
  envelope: RecipientEnvelope
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || envelope.kind === 'none') {
    if (!apiKey) {
      console.warn('[notify] skipping pfile reminder: RESEND_API_KEY unset');
    }
    return { attempted: 0, sent: 0, failed: 0, outcomes: [] };
  }

  const resend = new Resend(apiKey);
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ?? 'HFSE SIS <noreply@hfse.edu.sg>';
  const devTo =
    process.env.NODE_ENV !== 'production' ? 'ace.vizserve@gmail.com' : null;
  const { subject, html } = renderReminder(ctx);

  const toAddr = devTo ?? envelope.to;
  const ccAddrs = devTo
    ? undefined
    : envelope.cc.length > 0
      ? envelope.cc
      : undefined;

  // Represent the primary recipient as a RecipientCandidate for the outcome shape.
  const primaryRecipient: RecipientCandidate = {
    email: envelope.to,
    role: envelope.primaryRole,
  };

  try {
    const res = await resend.emails.send({
      from: fromAddress,
      to: toAddr,
      cc: ccAddrs,
      subject,
      html,
    });
    if (res.error) {
      console.error(
        '[notify] pfile reminder resend error for',
        envelope.to,
        res.error
      );
      return {
        attempted: 1,
        sent: 0,
        failed: 1,
        outcomes: [
          { recipient: primaryRecipient, ok: false, error: res.error.message },
        ],
      };
    }
    return {
      attempted: 1,
      sent: 1,
      failed: 0,
      outcomes: [{ recipient: primaryRecipient, ok: true }],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[notify] pfile reminder resend throw for', envelope.to, e);
    return {
      attempted: 1,
      sent: 0,
      failed: 1,
      outcomes: [{ recipient: primaryRecipient, ok: false, error: msg }],
    };
  }
}
