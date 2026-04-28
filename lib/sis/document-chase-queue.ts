import { unstable_cache } from 'next/cache';

import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';
import { scanDocStatusForActionFlags } from '@/lib/sis/process';

// ──────────────────────────────────────────────────────────────────────────
// Document chase queue — top-of-fold counts for /p-files, /admissions,
// /records dashboards. Counts students (not slots) with at least one slot
// in each of three orthogonal action states. Overlap allowed: a row with
// both an Uploaded slot and a 'To follow' slot counts in both validation
// and promised — same semantics as the cohort lifecycle aggregate widget.
//
// Cached per-AY with the existing `sis:${ayCode}` tag (KD #46), so any
// existing write that already invalidates that tag (PATCH on
// /api/sis/students/[enroleeNumber]/documents, residence-history editor,
// etc.) automatically refreshes these counts.
// ──────────────────────────────────────────────────────────────────────────

export type DocumentChaseQueueCounts = {
  promised: number;     // any slot at 'To follow'
  validation: number;   // any slot at 'Uploaded'
  revalidation: number; // any slot at 'Rejected' or 'Expired'
};

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

async function loadChaseQueueUncached(
  ayCode: string,
): Promise<DocumentChaseQueueCounts> {
  const prefix = prefixFor(ayCode);
  const supabase = createAdmissionsClient();

  const docColumns = ['enroleeNumber', ...DOCUMENT_SLOTS.map((s) => s.statusCol)];

  const docsRes = await supabase
    .from(`${prefix}_enrolment_documents`)
    .select(docColumns.join(', '));

  if (docsRes.error) {
    console.warn(
      '[sis/document-chase-queue] docs fetch failed:',
      docsRes.error.message,
    );
    return { promised: 0, validation: 0, revalidation: 0 };
  }

  let promised = 0;
  let validation = 0;
  let revalidation = 0;

  type DocRow = Record<string, string | null>;
  const rows = (docsRes.data ?? []) as unknown as DocRow[];

  for (const row of rows) {
    const flags = scanDocStatusForActionFlags(row);
    if (flags.hasPromised) promised += 1;
    if (flags.hasValidation) validation += 1;
    if (flags.hasRevalidation) revalidation += 1;
  }

  return { promised, validation, revalidation };
}

export async function getDocumentChaseQueueCounts(
  ayCode: string,
): Promise<DocumentChaseQueueCounts> {
  return unstable_cache(
    () => loadChaseQueueUncached(ayCode),
    ['sis', 'document-chase-queue', ayCode],
    {
      revalidate: CACHE_TTL_SECONDS,
      tags: ['sis', `sis:${ayCode}`],
    },
  )();
}
