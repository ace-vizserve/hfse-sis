import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import {
  type SlotStatusKind,
  type RecipientEnvelope,
  type ReminderKind,
  resolveRecipients,
  sendReminder,
} from '@/lib/notifications/email-pfile-reminder';
import {
  prefixFor,
  ENROLLED_STATUSES,
  ADMISSIONS_FUNNEL_STATUSES,
} from '@/lib/p-files/_shared';

// Shared orchestration used by both the single-slot notify route and the
// bulk fan-out wrapper. Per call: looks up the student + slot context,
// enforces enrolled-only + 24h cooldown gates, sends the reminder,
// inserts one p_file_outreach row per successful send.
//
// Returns a summary suitable for both surface and audit logging. Does
// not write the audit_log row itself — the caller does that so it can
// log a single bulk-totals entry instead of N per-item entries.

const EXPIRING_SOON_DAYS = 60;

// Local sets for fast .has() lookups — built from the imported shared arrays.
const ENROLLED_STATUSES_SET = new Set<string>(ENROLLED_STATUSES);
const ADMISSIONS_FUNNEL_STATUSES_SET = new Set<string>(
  ADMISSIONS_FUNNEL_STATUSES
);

export type NotifyOutcome =
  | { ok: true; recipients: number; sent: number; failed: number }
  | {
      ok: false;
      reason:
        | 'unknown_slot'
        | 'no_application_row'
        | 'no_status_row'
        | 'not_enrolled'
        | 'no_recipients'
        | 'no_actionable_status'
        | 'cooldown'
        | 'send_failed';
      cooldownLastSentAt?: string;
      recipients?: number;
    };

export type NotifyContext = {
  ayCode: string;
  enroleeNumber: string;
  slotKey: string;
  // Optional email tone — defaults to 'renewal' for back-compat with the
  // existing P-Files routes. Admissions callers pass 'initial-chase'.
  kind?: ReminderKind;
};

function fullName(app: Record<string, unknown>): string {
  const last = (app.lastName as string | null) ?? '';
  const first = (app.firstName as string | null) ?? '';
  const middle = (app.middleName as string | null) ?? '';
  const composed = `${first}${middle ? ` ${middle}` : ''} ${last}`.trim();
  return composed || ((app.enroleeFullName as string | null) ?? 'Student');
}

function classifyStatus(
  status: string | null,
  url: string | null,
  expiry: string | null
): SlotStatusKind | null {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'rejected') return 'rejected';
  if (s === 'expired') return 'expired';
  if (s === 'to follow') return 'toFollow';
  if (!url && !status) return 'missing';
  // Only flag expiringSoon when slot is currently 'Valid' and within window.
  if (s === 'valid' && expiry) {
    const diff = (new Date(expiry).getTime() - Date.now()) / 86_400_000;
    if (diff <= EXPIRING_SOON_DAYS && diff > -0.5) return 'expiringSoon';
  }
  return null;
}

export async function runNotify(
  service: SupabaseClient,
  actor: { id: string; email: string | null },
  ctx: NotifyContext
): Promise<NotifyOutcome> {
  const slot = DOCUMENT_SLOTS.find((s) => s.key === ctx.slotKey);
  if (!slot) return { ok: false, reason: 'unknown_slot' };

  const prefix = prefixFor(ctx.ayCode);

  const [appRes, statusRes, docsRes] = await Promise.all([
    service
      .from(`${prefix}_enrolment_applications`)
      .select(
        '"enroleeNumber","firstName","middleName","lastName","enroleeFullName","motherEmail","fatherEmail","guardianEmail"'
      )
      .eq('enroleeNumber', ctx.enroleeNumber)
      .maybeSingle(),
    service
      .from(`${prefix}_enrolment_status`)
      .select('"applicationStatus","classLevel","classSection"')
      .eq('enroleeNumber', ctx.enroleeNumber)
      .maybeSingle(),
    service
      .from(`${prefix}_enrolment_documents`)
      .select(
        `"${ctx.slotKey}","${ctx.slotKey}Status"${slot.expires ? `,"${ctx.slotKey}Expiry"` : ''}`
      )
      .eq('enroleeNumber', ctx.enroleeNumber)
      .maybeSingle(),
  ]);

  if (!appRes.data) return { ok: false, reason: 'no_application_row' };
  if (!statusRes.data) return { ok: false, reason: 'no_status_row' };

  const app = appRes.data as unknown as Record<string, unknown>;
  const statusRow = statusRes.data as unknown as Record<string, unknown>;
  const docsRow = (docsRes.data ?? {}) as unknown as Record<string, unknown>;

  const applicationStatus =
    (statusRow.applicationStatus as string | null) ?? null;
  // Per-kind scope gate. P-Files (default 'renewal') chases enrolled
  // students only (KD #31). Admissions ('initial-chase') chases the
  // active pre-enrolment funnel (Submitted / Ongoing Verification /
  // Processing). The 'not_enrolled' reason name is preserved for
  // back-compat with existing P-Files callers; admissions surfaces map
  // it to a generic "not in chaseable scope" message.
  const kind: ReminderKind = ctx.kind ?? 'renewal';
  const allowedStatuses =
    kind === 'initial-chase'
      ? ADMISSIONS_FUNNEL_STATUSES_SET
      : ENROLLED_STATUSES_SET;
  if (!applicationStatus || !allowedStatuses.has(applicationStatus)) {
    return { ok: false, reason: 'not_enrolled' };
  }

  const slotUrl = (docsRow[ctx.slotKey] as string | null) ?? null;
  const slotStatus = (docsRow[`${ctx.slotKey}Status`] as string | null) ?? null;
  const slotExpiry = slot.expires
    ? ((docsRow[`${ctx.slotKey}Expiry`] as string | null) ?? null)
    : null;

  const statusKind = classifyStatus(slotStatus, slotUrl, slotExpiry);
  if (!statusKind) return { ok: false, reason: 'no_actionable_status' };

  const envelope: RecipientEnvelope = resolveRecipients(ctx.slotKey, {
    motherEmail: (app.motherEmail as string | null) ?? null,
    fatherEmail: (app.fatherEmail as string | null) ?? null,
    guardianEmail: (app.guardianEmail as string | null) ?? null,
  });
  if (envelope.kind === 'none') return { ok: false, reason: 'no_recipients' };

  // Claim the send BEFORE sending (migration 096).
  //
  // This used to be: read the last reminder → send → insert the row that
  // establishes the next cooldown. Two requests could both pass the read
  // before either inserted, and the gap between them spans an actual email
  // send — so a double-submit, or a single notify racing the bulk sweep over
  // the same slot, emailed the parent twice inside one 24h window.
  //
  // `claim_pfile_reminder` does the cooldown check and the insert under an
  // advisory lock on the slot key, so exactly one caller can win. A plain
  // `INSERT ... WHERE NOT EXISTS` would not be enough: under READ COMMITTED
  // neither concurrent statement sees the other's uncommitted row.
  const { data: claimRaw, error: claimErr } = await service.rpc(
    'claim_pfile_reminder',
    {
      p_ay_code: ctx.ayCode,
      p_enrolee_number: ctx.enroleeNumber,
      p_slot_key: ctx.slotKey,
      p_recipient_email: envelope.to,
      p_created_by_user_id: actor.id,
      p_created_by_email: actor.email,
    }
  );
  if (claimErr) {
    console.error('[p-files notify] claim failed:', claimErr.message);
    return { ok: false, reason: 'send_failed', recipients: 1 };
  }
  const claim = (claimRaw ?? {}) as {
    claimed?: boolean;
    claim_id?: string;
    last_sent_at?: string;
  };
  if (!claim.claimed) {
    return {
      ok: false,
      reason: 'cooldown',
      cooldownLastSentAt: claim.last_sent_at,
      recipients: 1,
    };
  }

  const result = await sendReminder(
    {
      studentName: fullName(app),
      level: (statusRow.classLevel as string | null) ?? null,
      section: (statusRow.classSection as string | null) ?? null,
      slotKey: ctx.slotKey,
      slotLabel: slot.label,
      statusKind,
      expiryDateIso: slotExpiry,
      kind: ctx.kind ?? 'renewal',
      enroleeNumber: ctx.enroleeNumber,
      ayCode: ctx.ayCode,
    },
    envelope
  );

  if (result.sent === 0) {
    // Retract our own claim so the registrar can retry. Without this, claiming
    // first would trade a duplicate-send bug for a worse one: a transient
    // Resend failure would leave a row asserting the parent was emailed, block
    // the retry for 24h, and show "cooldown" instead of "send failed".
    //
    // This is the single sanctioned DELETE on the append-only p_file_outreach
    // table (see migration 096) — it removes a row this request created seconds
    // ago describing an email that never left, which protects the record rather
    // than damaging it. The RPC is scoped to reminders created in the last 10
    // minutes, so it can never retract historical outreach.
    if (claim.claim_id) {
      const { error: releaseErr } = await service.rpc(
        'release_pfile_reminder_claim',
        { p_claim_id: claim.claim_id }
      );
      if (releaseErr) {
        console.error(
          '[p-files notify] claim release failed (slot stays on cooldown until it ages out):',
          releaseErr.message
        );
      }
    }
    return { ok: false, reason: 'send_failed', recipients: 1 };
  }

  // The outreach row already exists — it WAS the claim, inserted above by
  // `claim_pfile_reminder`. No insert here.

  return { ok: true, recipients: 1, sent: result.sent, failed: result.failed };
}
