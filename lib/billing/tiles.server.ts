import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  stageFromInvoices,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import { rowsOfCustomer } from '@/lib/billing/sync-helpers';
import { todaySg } from '@/lib/billing/view';
import { connectedRealmId } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { QBO_STAGE_KEYS } from '@/lib/qbo/stage-state';
import {
  QBO_SYNC_LABEL,
  QBO_SYSTEM_ACTOR,
  readStageSnapshot,
  writeStageFromQbo,
} from '@/lib/qbo/stage-write';

/**
 * Recompute the Registration and Fees stages of one student from their stored
 * invoices, for the given years (default: every year one of their invoices is
 * on a tile). A year where the student has no admissions row is skipped. Only
 * the invoices of the student's currently linked customer count.
 */
export async function syncTilesForStudent(
  service: SupabaseClient,
  studentNumber: string,
  ayCodes?: string[],
  opts?: { realmId?: string }
): Promise<{ changed: number; errors: string[] }> {
  const realmId = opts?.realmId ?? (await connectedRealmId(service));
  if (!realmId) return { changed: 0, errors: [] };
  const { data: link, error: linkErr } = await service
    .from('qbo_customers')
    .select('qbo_customer_id')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId)
    .maybeSingle();
  if (linkErr)
    throw new Error(`Linked customer lookup failed: ${linkErr.message}`);
  // Not linked: no invoice is this student's, so nothing is changed.
  if (!link) return { changed: 0, errors: [] };
  // Voided invoices are kept: a stage whose tied invoices were all voided
  // reads Voided.
  const { data, error } = await service
    .from('qbo_invoices')
    .select(
      'doc_number, txn_date, due_date, state, payment_date, total, balance, ay_code, stage_keys, qbo_customer_id'
    )
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId);
  if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
  const rows = rowsOfCustomer(
    (data ?? []) as Array<{
      doc_number: string | null;
      txn_date: string | null;
      due_date: string | null;
      state: TileInvoice['state'];
      payment_date: string | null;
      total: number | string;
      balance: number | string;
      ay_code: string | null;
      stage_keys: string[] | null;
      qbo_customer_id: string | null;
    }>,
    (link as { qbo_customer_id: string }).qbo_customer_id
  );
  const years = ayCodes ?? [
    ...new Set(
      rows
        .filter((r) => r.ay_code && r.stage_keys?.length)
        .map((r) => r.ay_code!)
    ),
  ];

  let changed = 0;
  const errors: string[] = [];
  const today = todaySg();
  const toTile = (r: (typeof rows)[number]): TileInvoice => ({
    docNumber: r.doc_number,
    txnDate: r.txn_date,
    dueDate: r.due_date,
    state: r.state,
    paymentDate: r.payment_date,
    total: Number(r.total),
    balance: Number(r.balance),
  });
  for (const ayCode of years) {
    const { data: app, error: appErr } = await service
      .from(`ay${ayCode.slice(2)}_enrolment_applications`)
      .select('"enroleeNumber"')
      .eq('studentNumber', studentNumber)
      .order('enroleeNumber', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (appErr) {
      // A year with no applications table is skipped; anything else is real.
      if (appErr.code === 'PGRST205') continue;
      errors.push(`${ayCode}: enrolee lookup failed: ${appErr.message}`);
      continue;
    }
    const enroleeNumber = (app as { enroleeNumber: string } | null)
      ?.enroleeNumber;
    if (!enroleeNumber) continue;
    for (const stage of QBO_STAGE_KEYS) {
      try {
        const current = await readStageSnapshot(
          service,
          ayCode,
          enroleeNumber,
          stage
        );
        if (!current) continue;
        // Only the invoices tied to this stage count (spec 2026-10-21).
        const tied: TileInvoice[] = rows
          .filter(
            (r) => r.ay_code === ayCode && (r.stage_keys ?? []).includes(stage)
          )
          .map(toTile);
        const patch = stageFromInvoices(stage, tied, current, today);
        if (!patch) continue;
        const res = await writeStageFromQbo(service, {
          ayCode,
          enroleeNumber,
          stage,
          patch,
          actor: QBO_SYSTEM_ACTOR,
          updatedBy: QBO_SYNC_LABEL,
          docNumber: patch.invoice ?? current.invoice ?? null,
          trigger: 'sync',
        });
        if (res.ok) changed += res.changed > 0 ? 1 : 0;
        else errors.push(`${ayCode} ${stage}: ${res.error}`);
      } catch (e) {
        errors.push(
          `${ayCode} ${stage}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }
  return { changed, errors };
}

/**
 * Recompute the tiles of every student with a stored invoice on a year, plus
 * `extraStudents` (e.g. those whose invoices just lost their year), for the
 * given years. Database only, no QuickBooks calls.
 */
export async function syncTilesForAllStudents(
  service: SupabaseClient,
  years: string[],
  opts?: { realmId?: string; extraStudents?: string[] }
): Promise<{ students: number; errors: string[] }> {
  const realmId = opts?.realmId ?? (await connectedRealmId(service));
  if (!realmId) return { students: 0, errors: [] };
  const rows = await fetchAllPages<{ student_number: string }>(
    (from, to) =>
      service
        .from('qbo_invoices')
        .select('student_number')
        .eq('realm_id', realmId)
        .not('ay_code', 'is', null)
        .range(from, to) as unknown as PromiseLike<{
        data: Array<{ student_number: string }> | null;
        error: { message: string } | null;
      }>,
    1000,
    { tieBreak: 'id' }
  );
  const students = [
    ...new Set([
      ...rows.map((r) => r.student_number),
      ...(opts?.extraStudents ?? []),
    ]),
  ];
  const errors: string[] = [];
  for (const sn of students) {
    try {
      const r = await syncTilesForStudent(service, sn, years, { realmId });
      errors.push(...r.errors.map((e) => `${sn}: ${e}`));
    } catch (e) {
      errors.push(`${sn}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { students: students.length, errors };
}
