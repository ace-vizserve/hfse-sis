import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import {
  subjectConfigUnchanged,
  subjectPerYearTextUnchanged,
  subjectNumbersIdentical,
} from '@/lib/sis/subject-config-unchanged';
import { SubjectConfigUpdateSchema } from '@/lib/schemas/subject-config';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import {
  findTruncationBlockers,
  recomputeSyncedSheets,
} from '@/lib/grading/sync-config-sheets';

// A config fans out to 4 terms x N sections, and each sheet's entries are
// recomputed in TypeScript. Comfortably inside 60s at HFSE's ~20 sections,
// but the default limit is not worth gambling a half-applied sync on.
export const maxDuration = 60;

// PATCH /api/sis/admin/subjects/[configId]
//
// Updates per (subject × AY) weights + max slots (migration 080 collapsed
// the level dimension off `subject_configs` — a config now applies to
// every level the subject is attached to, see `subject_level_offerings`).
// school_admin + superadmin — weight changes are high-blast-radius (every
// grading sheet for this subject inside this AY reads the new weights on
// render).
//
// Body contract: integer percentages 0–100 that sum to 100. Converted to
// `numeric(4,2)` decimals (0.00–1.00) on write to satisfy the DB check
// constraint `ww_weight + pt_weight + qa_weight = 1.00`.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireCapability('subjects.edit');
  if ('error' in auth) return auth.error;

  const { configId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SubjectConfigUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const {
    ww_weight,
    pt_weight,
    qa_weight,
    ww_max_slots,
    pt_max_slots,
    qa_max,
    display_name,
    report_label,
    description,
  } = parsed.data;

  // Normalise the three per-year text fields HERE, not in the schema. Three
  // states have to survive to this line and a zod `.transform()` would
  // collapse two of them:
  //   • key absent   -> undefined -> don't touch what is stored
  //   • '' or null   -> null      -> clear the override and fall back
  //                                  (both migrations' CHECK constraints
  //                                  refuse a blank string outright)
  //   • real text    -> the value for this academic year
  // See SubjectConfigUpdateSchema for the matching note on the schema side.
  const clearable = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null || v.length === 0 ? null : v;

  const nextDisplayName = clearable(display_name);
  const nextReportLabel = clearable(report_label);
  const nextDescription = clearable(description);

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('subject_configs')
    .select(
      'id, academic_year_id, subject_id, ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, qa_max, weights_confirmed, display_name, report_label, description'
    )
    .eq('id', configId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'config not found' }, { status: 404 });

  // No-op guard, same shape as the canonical one in
  // app/api/sections/[id]/students/[enrolmentId]/route.ts:292-307.
  //
  // Re-saving identical weights previously ran the UPDATE, re-ran
  // sync_grading_sheets_from_config (which re-stamps updated_at on EVERY
  // unlocked grading sheet tied to this config), and wrote a
  // `subject_config.update` audit row whose before/after blocks were
  // identical. audit_log is append-only and is the evidence trail for how a
  // sheet's weights came to be what they are — a row asserting a change that
  // did not happen defeats the only job that table has.
  //
  // `weights_confirmed` is part of the comparison ON PURPOSE. It is set true
  // unconditionally below (see the comment there) to clear migration 082's
  // "needs attention" flag on the GP/COMP/ARTD/PESTD stand-in rows. Diffing
  // only the six numeric fields would make that flag-clearing save look like a
  // no-op and silently drop it — so a false -> true transition still counts as
  // a real change and proceeds.
  const submission = {
    ww_weight,
    pt_weight,
    qa_weight,
    ww_max_slots,
    pt_max_slots,
    qa_max,
  };
  const numbersUnchanged = subjectConfigUnchanged(before, submission);

  // The three per-year TEXT fields are compared SEPARATELY (migrations 137 +
  // 138). They have to participate in the no-op decision or a text-only save
  // would be swallowed by the guard above and answered `{ ok: true }` with
  // nothing written — but they must not be folded into the same verdict,
  // because the two halves have different consequences. See
  // subjectPerYearTextUnchanged.
  const textEdits: Array<{
    column: 'display_name' | 'report_label' | 'description';
    next: string | null | undefined;
  }> = [
    { column: 'display_name', next: nextDisplayName },
    { column: 'report_label', next: nextReportLabel },
    { column: 'description', next: nextDescription },
  ];
  const changedText = textEdits.filter(
    (e) => !subjectPerYearTextUnchanged(before[e.column], e.next)
  );
  const textUnchanged = changedText.length === 0;

  if (numbersUnchanged && textUnchanged) {
    return NextResponse.json({ ok: true, changed: false, sheets_synced: 0 });
  }

  // ── Text-only: change the words, touch nothing else ─────────────────────
  // Nothing a grading sheet stores depends on any of these — the slot maxima
  // and qa_max are what `sync_grading_sheets_from_config` denormalises, and
  // those are unchanged here. Running the sync anyway would re-stamp
  // updated_at on every unlocked sheet tied to this config and re-run the
  // recompute over every entry, for a change that only alters words on a
  // screen. The audit row is still written: this is the only record of when
  // the school started calling a subject something else.
  //
  // ⚠ Gated on subjectNumbersIdentical, NOT on the no-op guard above, and the
  // difference is `weights_confirmed`. Five production configs still carry the
  // flag as false (migration 082's stand-in rows). Renaming one through the
  // full path would flip it true — silently recording that an admin reviewed
  // weights they never looked at, because they typed a name. Typing a name is
  // not a review, so the flagged row stays flagged and the "fix the weights →
  // the flag clears" loop is untouched: that save carries no text change and
  // lands below.
  if (subjectNumbersIdentical(before, submission) && !textUnchanged) {
    const patch: Record<string, string | null> = {};
    for (const e of changedText) patch[e.column] = e.next ?? null;

    const { error: textErr } = await service
      .from('subject_configs')
      .update(patch)
      .eq('id', configId);
    if (textErr)
      return NextResponse.json({ error: textErr.message }, { status: 500 });

    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'subject_config.update',
      entityType: 'subject_config',
      entityId: configId,
      context: {
        academic_year_id: before.academic_year_id,
        subject_id: before.subject_id,
        // Only the fields that actually moved, so the row says what changed
        // rather than restating everything that did not.
        before: Object.fromEntries(
          changedText.map((e) => [e.column, before[e.column] ?? null])
        ),
        after: Object.fromEntries(
          changedText.map((e) => [e.column, e.next ?? null])
        ),
        sheets_synced: 0,
      },
    });

    const { data: textAy } = await service
      .from('academic_years')
      .select('ay_code')
      .eq('id', before.academic_year_id)
      .maybeSingle();
    const textAyCode = (textAy as { ay_code: string } | null)?.ay_code ?? null;
    if (textAyCode) invalidateDrillTags('markbook', textAyCode);

    return NextResponse.json({ ok: true, changed: true, sheets_synced: 0 });
  }

  // ── Rule 1: never destroy entered marks ────────────────────────────────
  // HFSE agrees a Scheme of Work before each AY, so the normal save lands on
  // empty sheets and this finds nothing. Mid-year changes are rare but real,
  // and that is when lowering a slot count would delete work.
  //
  // Refuse rather than log it: Hard Rule #6 wants an audit row for a deletion,
  // but a score cannot be recovered FROM an audit row. Clearing the slot first
  // is a deliberate act; losing it to an unrelated config edit is not.
  let blockers;
  try {
    blockers = await findTruncationBlockers(
      service,
      configId,
      ww_max_slots,
      pt_max_slots
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'check failed' },
      { status: 500 }
    );
  }
  if (blockers.length > 0) {
    const slots = [
      ...new Set(
        blockers.flatMap((b) =>
          b.slotNumbers.map(
            (n) =>
              `${b.component === 'ww' ? 'Written Work' : 'Performance Task'} ${n}`
          )
        )
      ),
    ].sort();
    return NextResponse.json(
      {
        error: `Reducing the number of slots would erase marks that teachers have already entered (${slots.join(', ')}) on ${blockers.length} class ${blockers.length === 1 ? 'sheet' : 'sheets'}. Clear those scores first, then change the setting.`,
        blocked_by_entered_scores: true,
        sheets: blockers,
      },
      { status: 409 }
    );
  }

  // ── Rule 2 (part 1): remember each sheet's exam total BEFORE the sync ───
  // Read here, not after, so the customisation rule is correct whether or not
  // migration 108 has been applied — the RPC still overwrites qa_total until
  // then, and this is the only moment the true prior value exists.
  const { data: priorSheets, error: priorErr } = await service
    .from('grading_sheets')
    .select('id, qa_total')
    .eq('subject_config_id', configId)
    .eq('is_locked', false);
  if (priorErr)
    return NextResponse.json({ error: priorErr.message }, { status: 500 });
  const priorQaBySheet = new Map<string, number | null>(
    ((priorSheets ?? []) as { id: string; qa_total: number | null }[]).map(
      (r) => [r.id, r.qa_total == null ? null : Number(r.qa_total)]
    )
  );

  const ww_dec = (ww_weight / 100).toFixed(2);
  const pt_dec = (pt_weight / 100).toFixed(2);
  const qa_dec = (qa_weight / 100).toFixed(2);

  // Task 2 (migration 085) — an explicit save via this route means an
  // admin reviewed these numbers, so weights_confirmed flips true
  // unconditionally, regardless of whether the row started false
  // (migration 082's GP/COMP/ARTD/PESTD stand-in rows). Closes the "needs
  // attention" loop: fix the flagged row's weights via this route → the
  // flag clears.
  const { error: updateErr } = await service
    .from('subject_configs')
    .update({
      ww_weight: ww_dec,
      pt_weight: pt_dec,
      qa_weight: qa_dec,
      ww_max_slots,
      pt_max_slots,
      qa_max,
      weights_confirmed: true,
      // Spread, not `display_name: nextDisplayName`, so each key is genuinely
      // absent when the caller never sent it — writing `undefined` into the
      // payload would serialise to null and clear a stored value on every
      // weights-only save. See `clearable` above.
      ...Object.fromEntries(changedText.map((e) => [e.column, e.next ?? null])),
    })
    .eq('id', configId);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Sync all unlocked grading sheets that reference this config. Weights are
  // read at render time (no sync needed), but ww_max_slots / pt_max_slots /
  // qa_max are denormalized at sheet-creation time and must be propagated.
  // Locked sheets are never touched per Hard Rule #5.
  const { data: syncResult, error: syncErr } = await service.rpc(
    'sync_grading_sheets_from_config',
    { p_config_id: configId }
  );

  // The RPC moves the DENOMINATORS and cannot recompute the grades that hang
  // off them — a SQL function can't call lib/compute/quarterly.ts, which Hard
  // Rule #2 makes the only place the formula lives. Left there, every affected
  // student's stored quarterly_grade stays computed against the old totals,
  // and that stored value is what the report card prints.
  const sync = await recomputeSyncedSheets(
    service,
    configId,
    syncResult,
    syncErr,
    // Rule 2 (part 2): a sheet still on the old subject default adopts the new
    // one — the SOW broadcast. A sheet set deliberately for its section keeps
    // what it was given.
    {
      previousQaMax: before.qa_max == null ? null : Number(before.qa_max),
      nextQaMax: qa_max,
      priorQaBySheet,
    }
  );

  // No longer best-effort. Once grades depend on this step, a green toast over
  // silently-wrong report cards is not an acceptable failure mode: the caller
  // is told, and pointed at the resync endpoint, which is safely re-runnable.
  if (sync.error) {
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'subject_config.update',
      entityType: 'subject_config',
      entityId: configId,
      context: {
        academic_year_id: before.academic_year_id,
        subject_id: before.subject_id,
        sheets_synced: sync.sheetsSynced,
        sheets_skipped_locked: sync.sheetsSkippedLocked,
        entries_scanned: sync.entriesScanned,
        entries_recomputed: sync.entriesRecomputed,
        qa_totals_applied: sync.qaTotalsApplied,
        qa_totals_preserved: sync.qaTotalsPreserved,
        sync_error: sync.error,
      },
    });
    return NextResponse.json(
      {
        error:
          'The subject settings were saved, but the grading sheets could not be brought up to date. Grades on those sheets may be wrong until this is retried.',
        config_updated: true,
        sync_failed: true,
        detail: sync.error,
        resync_href: `/api/sis/admin/subjects/${configId}/resync`,
      },
      { status: 500 }
    );
  }

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'subject_config.update',
    entityType: 'subject_config',
    entityId: configId,
    context: {
      academic_year_id: before.academic_year_id,
      subject_id: before.subject_id,
      before: {
        ww_weight: Number(before.ww_weight),
        pt_weight: Number(before.pt_weight),
        qa_weight: Number(before.qa_weight),
        ww_max_slots: before.ww_max_slots,
        pt_max_slots: before.pt_max_slots,
        qa_max: before.qa_max,
        weights_confirmed: before.weights_confirmed,
        ...Object.fromEntries(
          changedText.map((e) => [e.column, before[e.column] ?? null])
        ),
      },
      after: {
        ww_weight: Number(ww_dec),
        pt_weight: Number(pt_dec),
        qa_weight: Number(qa_dec),
        ww_max_slots,
        pt_max_slots,
        qa_max,
        weights_confirmed: true,
        // Only the text fields that actually moved — an unsent field is
        // unchanged, and naming it here would claim a write nobody made.
        ...Object.fromEntries(
          changedText.map((e) => [e.column, e.next ?? null])
        ),
      },
      sheets_synced: sync.sheetsSynced,
      sheets_skipped_locked: sync.sheetsSkippedLocked,
      entries_scanned: sync.entriesScanned,
      entries_recomputed: sync.entriesRecomputed,
      qa_totals_applied: sync.qaTotalsApplied,
      qa_totals_preserved: sync.qaTotalsPreserved,
    },
  });

  // Weights + slot maxes feed the cached markbook masterfile/drill, and the
  // RPC just resynced unlocked sheets — bust the markbook tags for this AY so
  // the change shows on the next read (not after the 60s TTL). Best-effort.
  const { data: ay } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('id', before.academic_year_id)
    .maybeSingle();
  const ayCode = (ay as { ay_code: string } | null)?.ay_code ?? null;
  if (ayCode) invalidateDrillTags('markbook', ayCode);

  return NextResponse.json({ ok: true });
}
