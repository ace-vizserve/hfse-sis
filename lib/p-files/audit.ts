import type { SupabaseClient } from '@supabase/supabase-js';

import {
  APPLICANT_IDENTITY_COLUMNS,
  applicantAuditIdentity,
  type ApplicantAuditIdentity,
  type ApplicantIdentityRow,
} from '@/lib/admissions/audit-identity';
import { prefixFor } from '@/lib/p-files/_shared';

// Who a P-Files audit row is about.
//
// Every document route keys on `enroleeNumber`, which resets each academic year
// (Hard Rule #4) and reads as a bare code on the audit log. Before this, not one
// P-Files row named the child: "Passport uploaded · E260117" was the whole
// story, and following it across years meant a lookup by hand. These helpers
// stamp the same `enroleeNumber` / `studentNumber` / `studentName` trio the
// admissions routes use (lib/admissions/audit-identity.ts), so a document row
// renders as a person the same way an admissions row does.
//
// ⚠ BEST-EFFORT BY DESIGN. The lookup runs AFTER the write it describes has
// committed; a failed read must never turn a successful upload into a 500 or,
// worse, skip the audit row. A miss returns the enrolee number with null name
// and number — the row is thinner, never absent.

export async function loadApplicantIdentity(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string
): Promise<ApplicantAuditIdentity> {
  try {
    const { data } = await service
      .from(`${prefixFor(ayCode)}_enrolment_applications`)
      .select(APPLICANT_IDENTITY_COLUMNS)
      .eq('enroleeNumber', enroleeNumber)
      .limit(1)
      .maybeSingle();
    return applicantAuditIdentity(
      enroleeNumber,
      data as ApplicantIdentityRow | null
    );
  } catch {
    return applicantAuditIdentity(enroleeNumber, null);
  }
}

/** Batch form — one `in` query per chunk, keyed by enrolee number. */
export async function loadApplicantIdentities(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumbers: readonly string[]
): Promise<Map<string, ApplicantAuditIdentity>> {
  const unique = Array.from(new Set(enroleeNumbers.filter(Boolean)));
  const rows = new Map<string, ApplicantIdentityRow>();
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    try {
      const { data } = await service
        .from(`${prefixFor(ayCode)}_enrolment_applications`)
        .select(APPLICANT_IDENTITY_COLUMNS)
        .in('enroleeNumber', unique.slice(i, i + CHUNK));
      for (const row of (data ?? []) as ApplicantIdentityRow[]) {
        if (row.enroleeNumber) rows.set(row.enroleeNumber, row);
      }
    } catch {
      // Best-effort — see header. Unresolved students keep their enrolee number.
    }
  }
  const out = new Map<string, ApplicantAuditIdentity>();
  for (const n of unique) out.set(n, applicantAuditIdentity(n, rows.get(n)));
  return out;
}

// ── Auto expire / revive sweep ─────────────────────────────────────────────

export type FreshenFlip = {
  enrolee_number: string;
  student_number: string | null;
  slot_key: string;
  from: 'Valid' | 'Expired';
  to: 'Valid' | 'Expired';
};

/**
 * One entry per document that changed, in a stable order (slot, then enrolee).
 *
 * The rows these replace carried a per-slot COUNT and a flat enrolee list cut
 * at 50, not split by slot — so "whose passport expired today?" had no answer
 * once more than 50 children crossed a boundary on the same day, and even
 * under 50 it could not say WHICH document. This list is complete: every
 * flipped (student, slot) pair, never capped. At roughly 90 bytes an entry, a
 * whole school's worth of passes expiring in one sweep is still a small row.
 */
export function buildFreshenFlips(
  direction: 'expire' | 'revive',
  bySlot: ReadonlyArray<{ slotKey: string; enroleeNumbers: readonly string[] }>,
  studentNumbers: ReadonlyMap<string, string | null>
): FreshenFlip[] {
  const from = direction === 'expire' ? 'Valid' : 'Expired';
  const to = direction === 'expire' ? 'Expired' : 'Valid';
  const flips: FreshenFlip[] = [];
  for (const { slotKey, enroleeNumbers } of bySlot) {
    for (const enrolee of enroleeNumbers) {
      flips.push({
        enrolee_number: enrolee,
        student_number: studentNumbers.get(enrolee) ?? null,
        slot_key: slotKey,
        from,
        to,
      });
    }
  }
  flips.sort(
    (a, b) =>
      a.slot_key.localeCompare(b.slot_key) ||
      a.enrolee_number.localeCompare(b.enrolee_number)
  );
  return flips;
}
