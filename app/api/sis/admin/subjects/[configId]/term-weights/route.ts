import { NextResponse, type NextRequest } from 'next/server';

import { requireCapability } from '@/lib/auth/require-capability';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { SubjectTermWeightsSchema } from '@/lib/schemas/subject-config';
import {
  recomputeSheetEntries,
  type SheetTotals,
  type SheetWeights,
} from '@/lib/grading/recompute-sheet';
import {
  redistributeWeights,
  resolveSheetWeights,
  type GradeComponent,
} from '@/lib/grading/resolve-sheet-weights';

// One subject × one term is up to ~20 sections, each with its entries
// recomputed in TypeScript. Same reasoning as the sibling config route: well
// inside 60s at HFSE's size, but not worth gambling a half-applied change on.
export const maxDuration = 60;

type TermSheetRow = {
  id: string;
  term_id: string;
  is_locked: boolean;
  ww_weight: number | string | null;
  pt_weight: number | string | null;
  qa_weight: number | string | null;
};

/**
 * GET /api/sis/admin/subjects/[configId]/term-weights
 *
 * What each term of this year currently grades this subject on.
 *
 * Loaded when the Subject setup drawer opens for ONE subject rather than with
 * the page: the catalog table shows ~20 subjects, and 20 × 4 terms of sheet
 * rows is a lot of work for a panel most visits never open.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireCapability('subjects.edit');
  if ('error' in auth) return auth.error;

  const { configId } = await params;
  const service = createServiceClient();

  const { data: config, error: cfgErr } = await service
    .from('subject_configs')
    .select('id, subject_id, academic_year_id, ww_weight, pt_weight, qa_weight')
    .eq('id', configId)
    .maybeSingle();
  if (cfgErr)
    return NextResponse.json({ error: cfgErr.message }, { status: 500 });
  if (!config)
    return NextResponse.json(
      { error: 'subject config not found' },
      { status: 404 }
    );

  const configWeights: SheetWeights = {
    ww_weight: Number(config.ww_weight),
    pt_weight: Number(config.pt_weight),
    qa_weight: Number(config.qa_weight),
  };

  const [termsRes, sheetsRes] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number, label')
      .eq('academic_year_id', config.academic_year_id)
      .order('term_number'),
    service
      .from('grading_sheets')
      .select('id, term_id, is_locked, ww_weight, pt_weight, qa_weight')
      .eq('subject_id', config.subject_id),
  ]);
  if (termsRes.error)
    return NextResponse.json(
      { error: termsRes.error.message },
      { status: 500 }
    );
  if (sheetsRes.error)
    return NextResponse.json(
      { error: sheetsRes.error.message },
      { status: 500 }
    );

  const sheets = (sheetsRes.data ?? []) as TermSheetRow[];
  const pct = (n: number) => Math.round(n * 100);

  const terms = (termsRes.data ?? []).map((term) => {
    const mine = sheets.filter((s) => s.term_id === term.id);
    const weights = mine.map((s) => resolveSheetWeights(s, configWeights));

    // ⚠ Sheets inside one term CAN disagree, and saying so matters more than
    // picking a winner. A class created after the last fan-out comes back with
    // the config's weights while its neighbours carry the term's, so the honest
    // answer is "mixed" and a re-save is what fixes it. Silently showing the
    // first sheet's answer would hide a class being graded differently from the
    // rest of its year group.
    const distinct = new Set(
      weights.map((w) => `${w.ww_weight}|${w.pt_weight}|${w.qa_weight}`)
    );
    const first = weights[0] ?? configWeights;

    return {
      termId: term.id,
      termNumber: term.term_number,
      label: term.label,
      sheets: mine.length,
      lockedSheets: mine.filter((s) => s.is_locked).length,
      mixed: distinct.size > 1,
      overridden: mine.some(
        (s) => s.ww_weight != null && s.pt_weight != null && s.qa_weight != null
      ),
      ww: pct(first.ww_weight),
      pt: pct(first.pt_weight),
      qa: pct(first.qa_weight),
    };
  });

  return NextResponse.json({
    config: {
      ww: pct(configWeights.ww_weight),
      pt: pct(configWeights.pt_weight),
      qa: pct(configWeights.qa_weight),
    },
    terms,
  });
}

// PATCH /api/sis/admin/subjects/[configId]/term-weights
//
// Says which components a subject is graded on IN ONE TERM, and at what
// weights (migration 159). Fans the answer out to every unlocked grading sheet
// for that subject in that term, and RECOMPUTES the grades on top of it.
//
// ── WHY THE FAN-OUT LIVES HERE AND NOT IN SQL ─────────────────────────────
//
// `sync_grading_sheets_from_config` (migration 052) moves denominators in SQL
// and cannot recompute, because a SQL function cannot call
// lib/compute/quarterly.ts — the single source of truth per Hard Rule #2. That
// is exactly how stored grades came to disagree with their own sheets, and why
// `scripts/audit-grade-recompute-drift.ts` had to be written. A weight change
// moves every grade on the sheet, so it must go through the TypeScript path.
//
// ── WHY THE SCOPE IS (SUBJECT × TERM) AND NOT ONE SHEET ───────────────────
//
// Joann is setting policy for S3 Filipino in Term 3, not for one class of it.
// Twenty-odd sections × four terms is not something anyone should click
// through one sheet at a time. Nobody has described a class that differs from
// its neighbour, so per-section is deliberately not offered.
//
// ⚠ LOCKED SHEETS ARE SKIPPED AND NAMED, NEVER SILENTLY PASSED OVER. A locked
// sheet has already been published (Hard Rule #5), so changing what its grades
// mean is a change request, not a settings toggle. The response says which
// classes were left alone so the coordinator can see it rather than discover it.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireCapability('subjects.edit');
  if ('error' in auth) return auth.error;

  const { configId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SubjectTermWeightsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const service = createServiceClient();

  // ---- The config, for its subject, its year, and its default weights ----
  const { data: config, error: cfgErr } = await service
    .from('subject_configs')
    .select(
      'id, subject_id, academic_year_id, ww_weight, pt_weight, qa_weight, subject:subjects(code, name)'
    )
    .eq('id', configId)
    .maybeSingle();
  if (cfgErr)
    return NextResponse.json({ error: cfgErr.message }, { status: 500 });
  if (!config)
    return NextResponse.json(
      { error: 'subject config not found' },
      { status: 404 }
    );

  // ---- The term must belong to this config's academic year --------------
  // Without this a caller could aim Term 3 of a different year at this
  // subject's sheets. The sheets would not match and nothing would be written,
  // but a 200 saying "0 sheets updated" reads as success.
  const { data: term, error: termErr } = await service
    .from('terms')
    .select('id, term_number, academic_year_id')
    .eq('id', input.term_id)
    .maybeSingle();
  if (termErr)
    return NextResponse.json({ error: termErr.message }, { status: 500 });
  if (!term)
    return NextResponse.json({ error: 'term not found' }, { status: 404 });
  if (term.academic_year_id !== config.academic_year_id) {
    return NextResponse.json(
      { error: 'that term belongs to a different academic year' },
      { status: 400 }
    );
  }

  const configWeights: SheetWeights = {
    ww_weight: Number(config.ww_weight),
    pt_weight: Number(config.pt_weight),
    qa_weight: Number(config.qa_weight),
  };

  // ---- What to write ----------------------------------------------------
  let next: SheetWeights | null;
  if ('inherit' in input) {
    next = null;
  } else if ('components' in input) {
    const inUse: Record<GradeComponent, boolean> = {
      ww: input.components.ww,
      pt: input.components.pt,
      qa: input.components.qa,
    };
    if (!inUse.ww && !inUse.pt && !inUse.qa) {
      return NextResponse.json(
        { error: 'A subject has to be graded on at least one component.' },
        { status: 400 }
      );
    }
    next = redistributeWeights(configWeights, inUse);
  } else {
    next = {
      ww_weight: input.ww_weight / 100,
      pt_weight: input.pt_weight / 100,
      qa_weight: input.qa_weight / 100,
    };
  }

  // ---- Every sheet for this subject in this term ------------------------
  const { data: sheetRows, error: sheetErr } = await service
    .from('grading_sheets')
    .select(
      'id, is_locked, ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight, section:sections(name)'
    )
    .eq('term_id', input.term_id)
    .eq('subject_id', config.subject_id);
  if (sheetErr)
    return NextResponse.json({ error: sheetErr.message }, { status: 500 });

  type SheetRow = {
    id: string;
    is_locked: boolean;
    ww_totals: number[] | null;
    pt_totals: number[] | null;
    qa_total: number | null;
    ww_weight: number | string | null;
    pt_weight: number | string | null;
    qa_weight: number | string | null;
    section: { name: string } | { name: string }[] | null;
  };
  const sheets = (sheetRows ?? []) as unknown as SheetRow[];
  const sectionName = (s: SheetRow): string => {
    const sec = Array.isArray(s.section) ? s.section[0] : s.section;
    return sec?.name ?? 'Unknown class';
  };

  const open = sheets.filter((s) => !s.is_locked);
  const lockedNames = sheets
    .filter((s) => s.is_locked)
    .map(sectionName)
    .sort();

  if (open.length === 0) {
    return NextResponse.json({
      sheetsUpdated: 0,
      entriesRecomputed: 0,
      lockedClasses: lockedNames,
      weights: next,
      message:
        sheets.length === 0
          ? 'There are no grading sheets for this subject in that term yet.'
          : 'Every class for this subject in that term is locked, so nothing was changed.',
    });
  }

  // ---- Write the weights, then recompute on top of them -----------------
  //
  // Weights first, grades second, and never the other way round: the recompute
  // reads the weights it is given rather than re-reading the row, but a failure
  // between the two must leave the stored grade stale against a NEW weight
  // (visible, and repaired by re-running this) rather than computed against a
  // weight nobody can see.
  const patch =
    next == null
      ? { ww_weight: null, pt_weight: null, qa_weight: null }
      : {
          ww_weight: next.ww_weight,
          pt_weight: next.pt_weight,
          qa_weight: next.qa_weight,
        };

  const { error: updateErr } = await service
    .from('grading_sheets')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .in(
      'id',
      open.map((s) => s.id)
    );
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const effective = next ?? configWeights;
  let entriesRecomputed = 0;
  try {
    for (const sheet of open) {
      const totals: SheetTotals = {
        ww_totals: (sheet.ww_totals ?? []).map(Number),
        pt_totals: (sheet.pt_totals ?? []).map(Number),
        qa_total: sheet.qa_total == null ? null : Number(sheet.qa_total),
      };
      const result = await recomputeSheetEntries(
        service,
        sheet.id,
        totals,
        effective
      );
      entriesRecomputed += result.entriesWritten;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: `Weights were saved, but recomputing the grades failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }. Re-run this to finish.`,
      },
      { status: 500 }
    );
  }

  const subject = Array.isArray(config.subject)
    ? config.subject[0]
    : config.subject;

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'subject_config.term_weights',
    entityType: 'subject_config',
    entityId: configId,
    context: {
      subject_code: subject?.code ?? null,
      term_number: term.term_number,
      term_id: term.id,
      academic_year_id: config.academic_year_id,
      before: open.map((s) => ({
        section: sectionName(s),
        ww_weight: s.ww_weight == null ? null : Number(s.ww_weight),
        pt_weight: s.pt_weight == null ? null : Number(s.pt_weight),
        qa_weight: s.qa_weight == null ? null : Number(s.qa_weight),
      })),
      after: patch,
      sheets_updated: open.length,
      entries_recomputed: entriesRecomputed,
      locked_classes_skipped: lockedNames,
    },
  });

  const { data: ay } = await service
    .from('academic_years')
    .select('ay_code')
    .eq('id', config.academic_year_id)
    .maybeSingle();
  if (ay?.ay_code) invalidateDrillTags('markbook', ay.ay_code);

  return NextResponse.json({
    sheetsUpdated: open.length,
    entriesRecomputed,
    lockedClasses: lockedNames,
    weights: next,
  });
}
