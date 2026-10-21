import 'server-only';

import { unstable_cache } from 'next/cache';

import {
  READY_FOR_INVOICING,
  READY_FOR_INVOICING_STATUS_SELECT,
  buildReadyForInvoicingRows,
  compareReadyForInvoicing,
  type ReadyForInvoicingRow,
} from '@/lib/admissions/ready-for-invoicing';
import {
  loadAdmissionsLevelResolver,
  resolveChildLevel,
} from '@/lib/admissions/level-resolver';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { fetchAllPages } from '@/lib/supabase/paginate';

// Read half of the "Ready for invoicing" list — the rule lives in
// `ready-for-invoicing.ts`. One AY at a time (the Admissions `?ay=` switcher).
// Cached under `sis:${ayCode}`, which the stage PATCH route and the Billing
// stage writes already revalidate, so an invoiced stage leaves the list on
// the next render.

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

type AppsRow = {
  enroleeNumber: string | null;
  studentNumber: string | null;
  enroleeFullName: string | null;
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  levelApplied: string | null;
};

function nameOf(app: AppsRow | undefined, enroleeNumber: string): string {
  const full = app?.enroleeFullName?.trim();
  if (full) return full;
  const parts = [app?.lastName, app?.firstName, app?.middleName]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : enroleeNumber;
}

async function loadUncached(ayCode: string): Promise<ReadyForInvoicingRow[]> {
  const prefix = prefixFor(ayCode);
  const admissions = createAdmissionsClient();

  // ⚠ A failed read THROWS (fetchAllPages) rather than returning [] — an
  // empty list would read as "nobody waiting", the wrong answer that looks
  // right. `unstable_cache` does not store a throw.
  const [statusRows, appRows, resolveLevel] = await Promise.all([
    fetchAllPages<Record<string, unknown>>((from, to) =>
      admissions
        .from(`${prefix}_enrolment_status`)
        .select(READY_FOR_INVOICING_STATUS_SELECT)
        .or(
          // Quoted: the value holds spaces. Exact match, as the builder is.
          `registrationStatus.eq."${READY_FOR_INVOICING}",feeStatus.eq."${READY_FOR_INVOICING}"`
        )
        .range(from, to)
    ),
    fetchAllPages<AppsRow>((from, to) =>
      admissions
        .from(`${prefix}_enrolment_applications`)
        .select(
          'enroleeNumber, studentNumber, enroleeFullName, firstName, middleName, lastName, levelApplied'
        )
        .range(from, to)
    ),
    loadAdmissionsLevelResolver(),
  ]);

  const appByEnrolee = new Map<string, AppsRow>();
  for (const a of appRows) {
    if (a.enroleeNumber) appByEnrolee.set(a.enroleeNumber, a);
  }

  const out: ReadyForInvoicingRow[] = [];
  for (const s of statusRows) {
    if (typeof s.enroleeNumber !== 'string') continue;
    const enroleeNumber = s.enroleeNumber;
    const app = appByEnrolee.get(enroleeNumber);
    const classLevel = ((s.classLevel as string | null) ?? '').trim();
    out.push(
      ...buildReadyForInvoicingRows(
        {
          ayCode,
          enroleeNumber,
          studentNumber: app?.studentNumber?.trim() || null,
          studentName: nameOf(app, enroleeNumber),
          level: resolveChildLevel(resolveLevel, classLevel, app?.levelApplied),
        },
        s
      )
    );
  }

  return out.sort(compareReadyForInvoicing);
}

/** Every (student, stage) in `ayCode` whose stage is Ready for invoicing. */
export async function loadReadyForInvoicing(
  ayCode: string
): Promise<ReadyForInvoicingRow[]> {
  return unstable_cache(
    () => loadUncached(ayCode),
    ['admissions-ready-for-invoicing-v1', ayCode],
    { revalidate: CACHE_TTL_SECONDS, tags: [`sis:${ayCode}`] }
  )();
}
