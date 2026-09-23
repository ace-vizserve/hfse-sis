import { NextResponse, type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { createServiceClient } from '@/lib/supabase/service';
import { subjectDisplayName } from '@/lib/sis/subjects/display-name';
import { resolveSheetWeights } from '@/lib/grading/resolve-sheet-weights';

// GET /api/grading-sheets/[id]/section-terms
//
// Every term's grading sheet for the class + subject that THIS sheet belongs
// to, shaped as the props `components/grading/totals-editor.tsx` already takes.
//
// ⚠ IT EXISTS FOR REACH, NOT FOR A NEW EDITOR. `TotalsEditor` already does the
// whole job — WW/PT slots with each one's max, the exam max, the component
// chips that take the exam off a term (migration 159 / KD #218), and the
// post-lock correction path. It just lives on /markbook/grading/[id], one
// sheet at a time. Subject setup's class chips carry exactly one `sheetId` —
// "the current term's, else the latest that exists"
// (`lib/sis/subjects/sheet-impact.ts`) — so three of a class's four terms had
// no route in from that screen. Measured 2026-09-23: 123 of 125 AY2026
// class+subject pairs carry all four terms.
//
// Read-only. Every write still goes to the routes that already own it.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Matches the audience of `PATCH /api/grading-sheets/[id]/totals`, which is
  // what the editor this feeds writes through.
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { id: sheetId } = await params;
  const service = createServiceClient();

  const { data: anchor, error: anchorErr } = await service
    .from('grading_sheets')
    .select(
      `id, section_id, subject_id,
       section:sections(id, name, academic_year_id),
       subject:subjects(code, name),
       subject_config:subject_configs(ww_weight, pt_weight, qa_weight, ww_max_slots, pt_max_slots, display_name)`
    )
    .eq('id', sheetId)
    .maybeSingle();
  if (anchorErr)
    return NextResponse.json({ error: anchorErr.message }, { status: 500 });
  if (!anchor)
    return NextResponse.json({ error: 'sheet not found' }, { status: 404 });

  const one = <T>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;

  const section = one(
    anchor.section as { id: string; name: string; academic_year_id: string }[]
  );
  const subject = one(anchor.subject as { code: string; name: string }[]);
  const config = one(
    anchor.subject_config as {
      ww_weight: number | string;
      pt_weight: number | string;
      qa_weight: number | string;
      ww_max_slots: number;
      pt_max_slots: number;
      display_name: string | null;
    }[]
  );

  if (!section || !config) {
    return NextResponse.json(
      { error: 'this sheet is missing its class or its subject settings' },
      { status: 500 }
    );
  }

  const configWeights = {
    ww_weight: Number(config.ww_weight),
    pt_weight: Number(config.pt_weight),
    qa_weight: Number(config.qa_weight),
  };

  const [termsRes, sheetsRes] = await Promise.all([
    service
      .from('terms')
      .select('id, term_number, label')
      .eq('academic_year_id', section.academic_year_id)
      .order('term_number'),
    service
      .from('grading_sheets')
      .select(
        'id, term_id, is_locked, ww_totals, pt_totals, qa_total, ww_weight, pt_weight, qa_weight'
      )
      .eq('section_id', anchor.section_id)
      .eq('subject_id', anchor.subject_id),
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

  type SheetRow = {
    id: string;
    term_id: string;
    is_locked: boolean;
    ww_totals: (number | string)[] | null;
    pt_totals: (number | string)[] | null;
    qa_total: number | string | null;
    ww_weight: number | string | null;
    pt_weight: number | string | null;
    qa_weight: number | string | null;
  };
  const sheets = (sheetsRes.data ?? []) as SheetRow[];
  const pct = (n: number) => Math.round(n * 100);

  // Every term of the year, including ones with no sheet. A class that joined
  // the subject mid-year has nothing for Term 1, and leaving the row out would
  // read as "Term 1 has no written works" — a different, wrong statement.
  const terms = (
    (termsRes.data ?? []) as Array<{
      id: string;
      term_number: number;
      label: string;
    }>
  ).map((term) => {
    const sheet = sheets.find((s) => s.term_id === term.id) ?? null;
    const weights = sheet
      ? resolveSheetWeights(sheet, configWeights)
      : configWeights;

    return {
      termId: term.id,
      termNumber: term.term_number,
      label: term.label,
      sheetId: sheet?.id ?? null,
      isLocked: sheet?.is_locked ?? false,
      wwTotals: (sheet?.ww_totals ?? []).map(Number),
      ptTotals: (sheet?.pt_totals ?? []).map(Number),
      qaTotal: sheet?.qa_total == null ? null : Number(sheet.qa_total),
      weights: {
        ww: pct(weights.ww_weight),
        pt: pct(weights.pt_weight),
        qa: pct(weights.qa_weight),
      },
      // True when this term states its own weights rather than following the
      // subject — what `TotalsEditor` needs to offer "follow the subject again".
      weightsOverridden:
        sheet != null &&
        sheet.ww_weight != null &&
        sheet.pt_weight != null &&
        sheet.qa_weight != null,
    };
  });

  return NextResponse.json({
    section: { id: section.id, name: section.name },
    subject: {
      code: subject?.code ?? '',
      // Per academic year since migration 137 (KD #203) — subject first,
      // config second; the other order returns the wrong one of the two names.
      name: subjectDisplayName(subject ?? { name: '' }, {
        display_name: config.display_name,
      }),
    },
    limits: {
      wwMaxSlots: config.ww_max_slots,
      ptMaxSlots: config.pt_max_slots,
    },
    subjectWeights: {
      ww: pct(configWeights.ww_weight),
      pt: pct(configWeights.pt_weight),
      qa: pct(configWeights.qa_weight),
    },
    terms,
  });
}
