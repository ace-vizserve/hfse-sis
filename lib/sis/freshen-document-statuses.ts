import 'server-only';

import { unstable_cache } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { createServiceClient } from '@/lib/supabase/service';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

// ──────────────────────────────────────────────────────────────────────────
// freshen-document-statuses — KD #60 reactive auto-flip.
//
// Implements the "auto-flip when expiry passes" half of KD #60's expiring-
// document contract. Called at the top of every page RSC that displays
// document status. Each call runs 8 parallel idempotent UPDATEs (one per
// expiring slot) and flips `<slot>Status = 'Valid'` rows whose `<slot>Expiry`
// is in the past to `'Expired'`. Cached for 60s per AY so rapid refreshes
// don't repeat work; tag-invalidated by `sis:${ayCode}` so manual edits via
// existing PATCH routes don't see stale freshen results.
//
// Spec: docs/superpowers/specs/2026-04-28-document-expiry-auto-flip-design.md
// ──────────────────────────────────────────────────────────────────────────

export type FreshenResult = {
  flippedCount: number;
  flippedBySlot: Record<string, number>;
  enroleeNumbers: string[]; // capped at 50 in the audit context
};

const EXPIRING_SLOTS = DOCUMENT_SLOTS.filter((s) => s.expiryCol);
const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

async function freshenAyDocumentsUncached(ayCode: string): Promise<FreshenResult> {
  const result: FreshenResult = {
    flippedCount: 0,
    flippedBySlot: {},
    enroleeNumbers: [],
  };

  const admissions = createAdmissionsClient();
  const prefix = prefixFor(ayCode);
  const seen = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);

  try {
    // 8 per-slot UPDATEs in parallel — single Supabase roundtrip latency
    // dominates instead of 8x sequential. Each UPDATE is independent and
    // idempotent; concurrent execution is safe.
    const slotResults = await Promise.all(
      EXPIRING_SLOTS.map(async (slot) => {
        const { data, error } = await admissions
          .from(`${prefix}_enrolment_documents`)
          .update({ [slot.statusCol]: 'Expired' })
          .eq(slot.statusCol, 'Valid')
          .lt(slot.expiryCol!, today)
          .not(slot.expiryCol!, 'is', null)
          .select('enroleeNumber');

        if (error) {
          console.warn(
            `[sis/freshen-documents] flip failed for ${slot.key} in ${ayCode}:`,
            error.message,
          );
          return { slotKey: slot.key, flipped: [] as Array<{ enroleeNumber: string | null }> };
        }

        return {
          slotKey: slot.key,
          flipped: (data ?? []) as Array<{ enroleeNumber: string | null }>,
        };
      }),
    );

    for (const { slotKey, flipped } of slotResults) {
      if (flipped.length > 0) {
        result.flippedCount += flipped.length;
        result.flippedBySlot[slotKey] = flipped.length;
        for (const row of flipped) {
          if (row.enroleeNumber) seen.add(row.enroleeNumber);
        }
      }
    }
  } catch (e) {
    // Catch-all: never break a page render because freshen failed.
    console.warn(
      `[sis/freshen-documents] unexpected failure for ${ayCode}:`,
      e instanceof Error ? e.message : String(e),
    );
    return result;
  }

  result.enroleeNumbers = Array.from(seen).slice(0, 50);

  if (result.flippedCount > 0) {
    try {
      await logAction({
        service: createServiceClient(),
        actor: { id: null, email: '(system:freshen)' },
        action: 'sis.documents.auto-expire',
        entityType: 'enrolment_document',
        entityId: null,
        context: {
          ayCode,
          flippedCount: result.flippedCount,
          flippedBySlot: result.flippedBySlot,
          enroleeNumbers: result.enroleeNumbers,
          truncated: seen.size > 50 ? seen.size - 50 : 0,
        },
      });
    } catch (e) {
      console.warn(
        `[sis/freshen-documents] audit log failed for ${ayCode}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return result;
}

export function freshenAyDocuments(ayCode: string): Promise<FreshenResult> {
  return unstable_cache(
    () => freshenAyDocumentsUncached(ayCode),
    ['sis', 'freshen-documents', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['sis', `sis:${ayCode}`],
    },
  )();
}
