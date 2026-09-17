import 'server-only';

import { unstable_cache } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { sgToday } from '@/lib/dates';
import {
  buildFreshenFlips,
  loadApplicantIdentities,
} from '@/lib/p-files/audit';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

// ──────────────────────────────────────────────────────────────────────────
// freshen-document-statuses — KD #60 reactive auto-flip.
//
// P-Files owns "validity over time" per the practical rule: once a document
// has an expiry date, the auto-flip Valid↔Expired logic is P-Files territory
// even when admissions surfaces also depend on the column being current
// (admissions chase `?status=expired` reads the same column). This module
// runs AY-wide so admissions chase + records cohorts + the P-Files renewal
// dashboard all see consistent Expired flags within 60s of expiry crossing.
//
// Each call runs 16 parallel idempotent UPDATEs (8 expiring slots × 2
// directions):
//   • expire:  `<slot>Status = 'Valid'`   AND `<slot>Expiry <= today` → 'Expired'
//   • revive:  `<slot>Status = 'Expired'` AND `<slot>Expiry >  today` → 'Valid'
//
// The boundary day belongs unambiguously to "expired": expire is inclusive
// (`<= today`) and revive is strictly greater-than (`> today`). Both
// inclusive would let a document expiring exactly today satisfy BOTH
// predicates, so successive runs would flip it Valid↔Expired all day,
// polluting the audit log and flickering the chase queue. Matches
// `resolveStatus`'s stored-'Expired'-is-authoritative semantics.
//
// The revive direction is a backstop for cases where a future-dated expiry
// lands on a row whose status wasn't updated alongside it (e.g. parent-portal
// direct write that only touches the URL + expiry columns, or a manual edit
// that fixed the date but missed the status pill). Cached for 60s per AY so
// rapid refreshes don't repeat work; tag-invalidated by `sis:${ayCode}` so
// manual edits via existing PATCH routes don't see stale freshen results.
//
// Audit-log action names stay `sis.documents.auto-{expire,revive}` — the
// data lives on the admissions-side `_documents` tables (sis-prefix in the
// audit taxonomy), even though the logic that flips them now belongs to
// P-Files.
//
// Spec: docs/superpowers/specs/2026-04-28-document-expiry-auto-flip-design.md
// ──────────────────────────────────────────────────────────────────────────

export type FreshenResult = {
  flippedCount: number;
  flippedBySlot: Record<string, number>;
  enroleeNumbers: string[]; // every distinct enrolee flipped — no cap
  revivedCount: number;
  revivedBySlot: Record<string, number>;
  revivedEnroleeNumbers: string[];
};

const EXPIRING_SLOTS = DOCUMENT_SLOTS.filter((s) => s.expiryCol);
const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

type Direction = 'expire' | 'revive';

async function freshenAyDocumentsUncached(
  ayCode: string
): Promise<FreshenResult> {
  const result: FreshenResult = {
    flippedCount: 0,
    flippedBySlot: {},
    enroleeNumbers: [],
    revivedCount: 0,
    revivedBySlot: {},
    revivedEnroleeNumbers: [],
  };

  const admissions = createAdmissionsClient();
  const prefix = prefixFor(ayCode);
  const expiredSeen = new Set<string>();
  const revivedSeen = new Set<string>();
  // Per-slot enrolee lists, so the audit row can say WHICH document of WHICH
  // child flipped rather than a count per slot beside an unsplit name list.
  const expiredBySlot: Array<{ slotKey: string; enroleeNumbers: string[] }> =
    [];
  const revivedBySlot: Array<{ slotKey: string; enroleeNumbers: string[] }> =
    [];
  const today = sgToday();

  try {
    // 16 UPDATEs in parallel (8 expiring slots × {expire, revive}). All are
    // independent and idempotent; the WHERE clauses are mutually exclusive on
    // the status column so the two directions never race for the same row.
    const tasks: Array<{ slotKey: string; direction: Direction }> = [];
    for (const slot of EXPIRING_SLOTS) {
      tasks.push({ slotKey: slot.key, direction: 'expire' });
      tasks.push({ slotKey: slot.key, direction: 'revive' });
    }

    const taskResults = await Promise.all(
      tasks.map(async ({ slotKey, direction }) => {
        const slot = EXPIRING_SLOTS.find((s) => s.key === slotKey)!;
        const query = admissions
          .from(`${prefix}_enrolment_documents`)
          .update({
            [slot.statusCol]: direction === 'expire' ? 'Expired' : 'Valid',
          })
          .eq(slot.statusCol, direction === 'expire' ? 'Valid' : 'Expired')
          .not(slot.expiryCol!, 'is', null);

        // Boundary rule: expiry === today is EXPIRED (expire pass inclusive,
        // revive pass strictly `>` — see module header). Never make both
        // inclusive: a doc expiring today would oscillate Valid↔Expired.
        const { data, error } =
          direction === 'expire'
            ? await query.lte(slot.expiryCol!, today).select('enroleeNumber')
            : await query.gt(slot.expiryCol!, today).select('enroleeNumber');

        if (error) {
          console.warn(
            `[p-files/freshen-documents] ${direction} failed for ${slotKey} in ${ayCode}:`,
            error.message
          );
          return {
            slotKey,
            direction,
            rows: [] as Array<{ enroleeNumber: string | null }>,
          };
        }

        return {
          slotKey,
          direction,
          rows: (data ?? []) as Array<{ enroleeNumber: string | null }>,
        };
      })
    );

    for (const { slotKey, direction, rows } of taskResults) {
      if (rows.length === 0) continue;
      const enrolees = rows
        .map((row) => row.enroleeNumber)
        .filter((n): n is string => Boolean(n));
      if (direction === 'expire') {
        result.flippedCount += rows.length;
        result.flippedBySlot[slotKey] = rows.length;
        for (const n of enrolees) expiredSeen.add(n);
        expiredBySlot.push({ slotKey, enroleeNumbers: enrolees });
      } else {
        result.revivedCount += rows.length;
        result.revivedBySlot[slotKey] = rows.length;
        for (const n of enrolees) revivedSeen.add(n);
        revivedBySlot.push({ slotKey, enroleeNumbers: enrolees });
      }
    }
  } catch (e) {
    // Catch-all: never break a page render because freshen failed.
    console.warn(
      `[p-files/freshen-documents] unexpected failure for ${ayCode}:`,
      e instanceof Error ? e.message : String(e)
    );
    return result;
  }

  // NO CAP. These used to be cut at 50 with a `truncated` count beside them,
  // which meant a busy expiry day recorded the first fifty children and a
  // number for the rest. The audit row is the only record of an automatic
  // flip — nobody clicked anything — so it has to be complete.
  result.enroleeNumbers = Array.from(expiredSeen);
  result.revivedEnroleeNumbers = Array.from(revivedSeen);

  // Student numbers for the flip lists: one read, only when something flipped.
  // Best-effort (lib/p-files/audit.ts) — a miss leaves `student_number` null.
  const studentNumbers = new Map<string, string | null>();
  if (expiredSeen.size + revivedSeen.size > 0) {
    const identities = await loadApplicantIdentities(admissions, ayCode, [
      ...expiredSeen,
      ...revivedSeen,
    ]);
    for (const [enrolee, who] of identities)
      studentNumbers.set(enrolee, who.studentNumber);
  }

  // Two audit rows when both directions had flips, so each is independently
  // filterable on /sis/audit-log.
  const service = createServiceClient();
  if (result.flippedCount > 0) {
    try {
      await logAction({
        service,
        // ⚠ NULL, AND NOT THE VIEWER'S ROLE, EVEN THOUGH ONE IS AVAILABLE.
        // This runs inside an `unstable_cache` block on somebody's page load:
        // a user triggered it, but the SYSTEM did it, and they neither asked
        // for it nor could have stopped it. Stamping their role on the row
        // would write a lie into an append-only table (Hard Rule #6) — it
        // would read as "a school admin expired these documents". The
        // `actor_id` here has always been null for the same reason.
        actor: { id: null, email: '(system:freshen)', role: null },
        action: 'sis.documents.auto-expire',
        entityType: 'enrolment_document',
        entityId: null,
        context: {
          ayCode,
          flippedCount: result.flippedCount,
          flippedBySlot: result.flippedBySlot,
          enroleeNumbers: result.enroleeNumbers,
          // Complete — kept for rows that read `truncated`; always 0 now.
          truncated: 0,
          flips: buildFreshenFlips('expire', expiredBySlot, studentNumbers),
        },
      });
    } catch (e) {
      console.warn(
        `[p-files/freshen-documents] audit log failed for ${ayCode}:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  if (result.revivedCount > 0) {
    try {
      await logAction({
        service,
        // ⚠ NULL, AND NOT THE VIEWER'S ROLE, EVEN THOUGH ONE IS AVAILABLE.
        // This runs inside an `unstable_cache` block on somebody's page load:
        // a user triggered it, but the SYSTEM did it, and they neither asked
        // for it nor could have stopped it. Stamping their role on the row
        // would write a lie into an append-only table (Hard Rule #6) — it
        // would read as "a school admin expired these documents". The
        // `actor_id` here has always been null for the same reason.
        actor: { id: null, email: '(system:freshen)', role: null },
        action: 'sis.documents.auto-revive',
        entityType: 'enrolment_document',
        entityId: null,
        context: {
          ayCode,
          revivedCount: result.revivedCount,
          revivedBySlot: result.revivedBySlot,
          enroleeNumbers: result.revivedEnroleeNumbers,
          truncated: 0,
          flips: buildFreshenFlips('revive', revivedBySlot, studentNumbers),
        },
      });
    } catch (e) {
      console.warn(
        `[p-files/freshen-documents] revive audit log failed for ${ayCode}:`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  return result;
}

export function freshenAyDocuments(ayCode: string): Promise<FreshenResult> {
  return unstable_cache(
    () => freshenAyDocumentsUncached(ayCode),
    ['p-files', 'freshen-documents', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['sis', `sis:${ayCode}`, `p-files-freshen:${ayCode}`],
    }
  )();
}
