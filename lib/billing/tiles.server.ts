import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  stageFromInvoices,
  type TileInvoice,
} from '@/lib/billing/stage-from-invoices';
import { connectedRealmId } from '@/lib/qbo/client';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { blank, QBO_STAGE_KEYS } from '@/lib/qbo/stage-state';
import {
  QBO_SYNC_LABEL,
  QBO_SYSTEM_ACTOR,
  readStageSnapshot,
  writeStageFromQbo,
} from '@/lib/qbo/stage-write';

/**
 * Recompute the Registration and Fees stages of one student from their stored
 * invoices, for the given years (default: every year one of their invoices is
 * on a tile). A year where the student has no admissions row is skipped.
 */
export async function syncTilesForStudent(
  service: SupabaseClient,
  studentNumber: string,
  ayCodes?: string[]
): Promise<{ changed: number; errors: string[] }> {
  const realmId = await connectedRealmId(service);
  if (!realmId) return { changed: 0, errors: [] };
  // Voided invoices are kept: a tile whose only invoice was voided must reset.
  const { data, error } = await service
    .from('qbo_invoices')
    .select('doc_number, txn_date, state, payment_date, ay_code, stage_keys')
    .eq('student_number', studentNumber)
    .eq('realm_id', realmId);
  if (error) throw new Error(`Invoice lookup failed: ${error.message}`);
  const rows = (data ?? []) as Array<{
    doc_number: string | null;
    txn_date: string | null;
    state: TileInvoice['state'];
    payment_date: string | null;
    ay_code: string | null;
    stage_keys: string[] | null;
  }>;
  const years = ayCodes ?? [
    ...new Set(
      rows
        .filter((r) => r.ay_code && r.stage_keys?.length)
        .map((r) => r.ay_code!)
    ),
  ];

  let changed = 0;
  const errors: string[] = [];
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
        const toTile = (r: (typeof rows)[number]): TileInvoice => ({
          docNumber: r.doc_number,
          txnDate: r.txn_date,
          state: r.state,
          paymentDate: r.payment_date,
        });
        let tile: TileInvoice[] = rows
          .filter(
            (r) => r.ay_code === ayCode && (r.stage_keys ?? []).includes(stage)
          )
          .map(toTile);
        if (tile.length === 0 && !blank(current.invoice)) {
          // Nothing is on this tile now. If the stage still shows the number
          // of one of this student's stored invoices (it moved off the tile or
          // to another year), treat that invoice as voided so the stage
          // resets. A hand-typed number matching no stored invoice is left.
          const stale = rows.find(
            (r) => r.doc_number?.trim() === current.invoice!.trim()
          );
          if (stale) tile = [{ ...toTile(stale), state: 'voided' }];
        }
        const patch = stageFromInvoices(stage, tile, current);
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
 * Recompute the tiles of every student with a stored invoice on a year, for the
 * given years. Database only, no QuickBooks calls. Returns the first errors.
 */
export async function syncTilesForAllStudents(
  service: SupabaseClient,
  years: string[]
): Promise<{ students: number; errors: string[] }> {
  const realmId = await connectedRealmId(service);
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
  const students = [...new Set(rows.map((r) => r.student_number))];
  const errors: string[] = [];
  for (const sn of students) {
    try {
      const r = await syncTilesForStudent(service, sn, years);
      errors.push(...r.errors.map((e) => `${sn}: ${e}`));
    } catch (e) {
      errors.push(`${sn}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { students: students.length, errors };
}
