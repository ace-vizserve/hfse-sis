import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateTag } from 'next/cache';

import { logAction } from '@/lib/audit/log-action';
import type {
  QboStageKey,
  StagePatch,
  StageSnapshot,
} from '@/lib/qbo/stage-state';
import {
  findStageCompletionBlockers,
  STAGE_COLUMN_MAP,
  STAGE_LABELS,
  stageCompletionMessage,
} from '@/lib/schemas/sis';
import { resolveEffectiveStageValues } from '@/lib/sis/stage-completion';

export const QBO_SYSTEM_ACTOR = {
  id: null,
  email: 'system:quickbooks-sync',
  role: null,
} as const;
export const QBO_SYNC_LABEL = 'QuickBooks sync';

const statusTable = (ayCode: string) =>
  `ay${ayCode.replace(/^AY/i, '').toLowerCase()}_enrolment_status`;

const colFor = (stage: QboStageKey, fieldKey: string) =>
  STAGE_COLUMN_MAP[stage].extras.find((e) => e.fieldKey === fieldKey)
    ?.columnName ?? null;

export async function readStageSnapshot(
  service: SupabaseClient,
  ayCode: string,
  enroleeNumber: string,
  stage: QboStageKey
): Promise<StageSnapshot | null> {
  const cols = STAGE_COLUMN_MAP[stage];
  const invoiceCol = colFor(stage, 'invoice')!;
  const paymentCol = colFor(stage, 'paymentDate')!;
  const startCol = colFor(stage, 'startDate');
  const select = [cols.statusCol, invoiceCol, paymentCol, startCol]
    .filter(Boolean)
    .join(', ');
  const { data, error } = await service
    .from(statusTable(ayCode))
    .select(select)
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (error) throw new Error(`Stage lookup failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, string | null>;
  return {
    status: row[cols.statusCol] ?? null,
    invoice: row[invoiceCol] ?? null,
    paymentDate: row[paymentCol] ?? null,
    startDate: startCol ? (row[startCol] ?? null) : null,
  };
}

/**
 * Writes what QuickBooks says to the stage — the same columns, the same
 * required-field check and the same `sis.stage.update` audit row as the stage
 * PATCH route, so a sync change reads in the log exactly like a person's.
 */
export async function writeStageFromQbo(
  service: SupabaseClient,
  args: {
    ayCode: string;
    enroleeNumber: string;
    stage: QboStageKey;
    patch: StagePatch;
    actor: { id: string | null; email: string | null; role: string | null };
    updatedBy: string;
    docNumber: string | null;
    trigger: 'create' | 'link' | 'sync';
  }
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  const cols = STAGE_COLUMN_MAP[args.stage];
  const table = statusTable(args.ayCode);
  const beforeSelect = [
    cols.statusCol,
    cols.remarksCol,
    ...cols.extras.map((e) => e.columnName),
  ].join(', ');
  const { data: before, error: beforeErr } = await service
    .from(table)
    .select(beforeSelect)
    .eq('enroleeNumber', args.enroleeNumber)
    .maybeSingle();
  if (beforeErr)
    return { ok: false, error: `Stage lookup failed: ${beforeErr.message}` };
  if (!before)
    return { ok: false, error: 'No status row for this enrolee in this year.' };
  const pre = before as unknown as Record<string, unknown>;

  const extras: Record<string, string | null> = {};
  if (args.patch.invoice !== undefined) extras.invoice = args.patch.invoice;
  if (args.patch.paymentDate !== undefined)
    extras.paymentDate = args.patch.paymentDate;

  const effective = resolveEffectiveStageValues(
    cols,
    pre,
    args.patch.status,
    extras
  );
  const blockers = findStageCompletionBlockers(
    args.stage,
    effective.status,
    effective.extras
  );
  if (blockers.length > 0) {
    return {
      ok: false,
      error: stageCompletionMessage(
        args.stage,
        effective.status ?? '',
        blockers
      ),
    };
  }

  const update: Record<string, unknown> = {
    [cols.updatedDateCol]: new Date().toISOString(),
    [cols.updatedByCol]: args.updatedBy,
  };
  if (args.patch.status !== undefined)
    update[cols.statusCol] = args.patch.status;
  for (const [fieldKey, value] of Object.entries(extras)) {
    update[colFor(args.stage, fieldKey)!] = value;
  }

  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const [col, next] of Object.entries(update)) {
    if (col === cols.updatedDateCol || col === cols.updatedByCol) continue;
    const prev = pre[col] ?? null;
    if ((prev ?? null) !== (next ?? null))
      changes.push({ field: col, from: prev, to: next });
  }
  if (changes.length === 0) return { ok: true, changed: 0 };

  const { error: upErr } = await service
    .from(table)
    .update(update)
    .eq('enroleeNumber', args.enroleeNumber);
  if (upErr) return { ok: false, error: upErr.message };

  await logAction({
    service,
    actor: args.actor,
    action: 'sis.stage.update',
    entityType: 'enrolment_status',
    entityId: args.enroleeNumber,
    context: {
      ay_code: args.ayCode,
      stage: args.stage,
      stage_label: STAGE_LABELS[args.stage],
      changes,
      source: 'quickbooks',
      trigger: args.trigger,
      qbo_doc_number: args.docNumber,
    },
  });

  // Expire now, not stale-while-revalidate ('max'): the Refresh button's
  // router.refresh() is the very next request, and under 'max' it was served
  // the cached pre-payment page (the lifecycle panel) — complete only after a
  // second load.
  for (const tag of [
    `sis:${args.ayCode}`,
    `admissions-drill:${args.ayCode}`,
    `admissions-dashboard:${args.ayCode}`,
    `records-drill:${args.ayCode}`,
  ]) {
    revalidateTag(tag, { expire: 0 });
  }
  return { ok: true, changed: changes.length };
}
