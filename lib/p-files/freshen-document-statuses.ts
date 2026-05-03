import 'server-only';

import { unstable_cache } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
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
//   • expire:  `<slot>Status = 'Valid'`   AND `<slot>Expiry < today`  → 'Expired'
//   • revive:  `<slot>Status = 'Expired'` AND `<slot>Expiry >= today` → 'Valid'
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
  enroleeNumbers: string[]; // capped at 50 in the audit context
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

async function freshenAyDocumentsUncached(ayCode: string): Promise<FreshenResult> {
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
  const today = new Date().toISOString().slice(0, 10);

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

        const { data, error } =
          direction === 'expire'
            ? await query.lt(slot.expiryCol!, today).select('enroleeNumber')
            : await query.gte(slot.expiryCol!, today).select('enroleeNumber');

        if (error) {
          console.warn(
            `[p-files/freshen-documents] ${direction} failed for ${slotKey} in ${ayCode}:`,
            error.message,
          );
          return { slotKey, direction, rows: [] as Array<{ enroleeNumber: string | null }> };
        }

        return {
          slotKey,
          direction,
          rows: (data ?? []) as Array<{ enroleeNumber: string | null }>,
        };
      }),
    );

    for (const { slotKey, direction, rows } of taskResults) {
      if (rows.length === 0) continue;
      if (direction === 'expire') {
        result.flippedCount += rows.length;
        result.flippedBySlot[slotKey] = rows.length;
        for (const row of rows) if (row.enroleeNumber) expiredSeen.add(row.enroleeNumber);
      } else {
        result.revivedCount += rows.length;
        result.revivedBySlot[slotKey] = rows.length;
        for (const row of rows) if (row.enroleeNumber) revivedSeen.add(row.enroleeNumber);
      }
    }
  } catch (e) {
    // Catch-all: never break a page render because freshen failed.
    console.warn(
      `[p-files/freshen-documents] unexpected failure for ${ayCode}:`,
      e instanceof Error ? e.message : String(e),
    );
    return result;
  }

  result.enroleeNumbers = Array.from(expiredSeen).slice(0, 50);
  result.revivedEnroleeNumbers = Array.from(revivedSeen).slice(0, 50);

  // Two audit rows when both directions had flips, so each is independently
  // filterable on /sis/audit-log.
  const service = createServiceClient();
  if (result.flippedCount > 0) {
    try {
      await logAction({
        service,
        actor: { id: null, email: '(system:freshen)' },
        action: 'sis.documents.auto-expire',
        entityType: 'enrolment_document',
        entityId: null,
        context: {
          ayCode,
          flippedCount: result.flippedCount,
          flippedBySlot: result.flippedBySlot,
          enroleeNumbers: result.enroleeNumbers,
          truncated: expiredSeen.size > 50 ? expiredSeen.size - 50 : 0,
        },
      });
    } catch (e) {
      console.warn(
        `[p-files/freshen-documents] audit log failed for ${ayCode}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  if (result.revivedCount > 0) {
    try {
      await logAction({
        service,
        actor: { id: null, email: '(system:freshen)' },
        action: 'sis.documents.auto-revive',
        entityType: 'enrolment_document',
        entityId: null,
        context: {
          ayCode,
          revivedCount: result.revivedCount,
          revivedBySlot: result.revivedBySlot,
          enroleeNumbers: result.revivedEnroleeNumbers,
          truncated: revivedSeen.size > 50 ? revivedSeen.size - 50 : 0,
        },
      });
    } catch (e) {
      console.warn(
        `[p-files/freshen-documents] revive audit log failed for ${ayCode}:`,
        e instanceof Error ? e.message : String(e),
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
      tags: ['sis', `sis:${ayCode}`],
    },
  )();
}
