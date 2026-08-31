// scripts/probe-subject-display-name.ts
//
// Read-only. Sizes the MAPEH -> STAR rename (migration 137) against production
// so the write path and the UI are built for the rows that actually exist.
//
// Three questions:
//
//   1. WHICH SUBJECTS CARRY THE MAPEH/STAR NAMES TODAY, per academic year? The
//      catalogue has one row per subject with no AY dimension, so the answer
//      has to come from subject_configs.
//   2. HOW MANY CONFIGS HAVE weights_confirmed = false? A rename saved through
//      PATCH /api/sis/admin/subjects/[configId] flips that flag true as a side
//      effect on any row where it is false (migration 085's "needs attention"
//      clearing). If the count is zero the ambiguity is theoretical; if it is
//      not, the rename needs a write path that cannot touch the flag.
//   3. HOW MANY ARE grading_method = 'no_sheet'? Those rows render no Save
//      button in SubjectConfigForm, so hanging the rename on that button would
//      make them unrenameable.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-subject-display-name.ts
import { createServiceClient } from '../lib/supabase/service';

async function main() {
  const service = createServiceClient();

  const { data: years, error: yearsErr } = await service
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code');
  if (yearsErr) throw new Error(yearsErr.message);
  const ayById = new Map(
    (years ?? []).map((y: { id: string; ay_code: string }) => [y.id, y.ay_code])
  );

  const { data: subjects, error: subjErr } = await service
    .from('subjects')
    .select('id, code, name, report_label, grading_method');
  if (subjErr) throw new Error(subjErr.message);
  const subjectById = new Map(
    (subjects ?? []).map(
      (s: {
        id: string;
        code: string;
        name: string;
        report_label: string | null;
        grading_method: string;
      }) => [s.id, s]
    )
  );

  const { data: configs, error: cfgErr } = await service
    .from('subject_configs')
    .select(
      'id, academic_year_id, subject_id, weights_confirmed, display_name'
    );
  if (cfgErr) throw new Error(cfgErr.message);
  const rows = configs ?? [];

  console.log(`subject_configs rows: ${rows.length}`);
  console.log(`subjects in the catalogue: ${subjectById.size}`);
  console.log('');

  // 1 — the MAPEH/STAR family, per year.
  console.log('── Subjects whose name mentions MAPEH / STAR / PE / Music ──');
  const NAME_HINT = /mapeh|star|physical education|music|arts|rhythm/i;
  for (const [id, s] of subjectById) {
    if (!NAME_HINT.test(s.name) && !NAME_HINT.test(s.code)) continue;
    const mine = rows.filter(
      (r: { subject_id: string }) => r.subject_id === id
    );
    const years = mine
      .map(
        (r: { academic_year_id: string; display_name: string | null }) =>
          `${ayById.get(r.academic_year_id) ?? '?'}${r.display_name ? ` -> "${r.display_name}"` : ''}`
      )
      .sort()
      .join(', ');
    console.log(
      `  ${s.code.padEnd(8)} ${s.name.padEnd(40)} report_label=${s.report_label ?? '-'} · ${mine.length} config(s): ${years || 'none'}`
    );
  }
  console.log('');

  // 2 — the weights_confirmed side effect.
  const unconfirmed = rows.filter(
    (r: { weights_confirmed: boolean | null }) => r.weights_confirmed !== true
  );
  console.log(
    `── weights_confirmed is not true on ${unconfirmed.length} of ${rows.length} configs ──`
  );
  for (const r of unconfirmed as Array<{
    academic_year_id: string;
    subject_id: string;
  }>) {
    const s = subjectById.get(r.subject_id);
    console.log(
      `  ${ayById.get(r.academic_year_id) ?? '?'} ${s?.code ?? '?'} ${s?.name ?? '?'}`
    );
  }
  console.log('');

  // 3 — subjects with no grading sheet, per year.
  const noSheet = rows.filter((r: { subject_id: string }) => {
    return subjectById.get(r.subject_id)?.grading_method === 'no_sheet';
  });
  console.log(
    `── grading_method = 'no_sheet' on ${noSheet.length} of ${rows.length} configs ──`
  );
  for (const r of noSheet as Array<{
    academic_year_id: string;
    subject_id: string;
  }>) {
    const s = subjectById.get(r.subject_id);
    console.log(
      `  ${ayById.get(r.academic_year_id) ?? '?'} ${s?.code ?? '?'} ${s?.name ?? '?'}`
    );
  }
  console.log('');

  // 4 — anything already renamed.
  const renamed = rows.filter(
    (r: { display_name: string | null }) => r.display_name != null
  );
  console.log(`── display_name already set on ${renamed.length} config(s) ──`);
  for (const r of renamed as Array<{
    academic_year_id: string;
    subject_id: string;
    display_name: string | null;
  }>) {
    const s = subjectById.get(r.subject_id);
    console.log(
      `  ${ayById.get(r.academic_year_id) ?? '?'} ${s?.code ?? '?'} "${s?.name}" -> "${r.display_name}"`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
