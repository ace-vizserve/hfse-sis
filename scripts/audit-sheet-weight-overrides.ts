// Read-only: which grading sheets carry their own weights, and is each one
// the subject's weights with components switched off (allowed), or some
// other split (not allowed since 2026-09-25 — a subject's weights are the
// same in every term)?
//
// Usage: npx tsx --env-file=.env.local scripts/audit-sheet-weight-overrides.ts

import { createServiceClient } from '../lib/supabase/service';
import { isSubjectTermSplit } from '../lib/grading/resolve-sheet-weights';

const sb = createServiceClient();
const pct = (v: unknown) => Math.round(Number(v) * 100);

async function main() {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('grading_sheets')
      .select(
        'id, is_locked, ww_weight, pt_weight, qa_weight, term:terms(term_number, academic_year:academic_years(ay_code)), section:sections(name), subject_config:subject_configs(ww_weight, pt_weight, qa_weight, subject:subjects(code))'
      )
      .not('ww_weight', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  let allowed = 0;
  const bad: string[] = [];
  const bySubjectTerm = new Map<string, number>();
  for (const r of rows) {
    const cfg = one(r.subject_config);
    const term = one(r.term);
    const ay = one(term?.academic_year)?.ay_code;
    const code = one(cfg?.subject)?.code;
    const split = {
      ww: pct(r.ww_weight),
      pt: pct(r.pt_weight),
      qa: pct(r.qa_weight),
    };
    const key = `${ay} T${term?.term_number} ${code} ${split.ww}/${split.pt}/${split.qa} (subject ${pct(cfg.ww_weight)}/${pct(cfg.pt_weight)}/${pct(cfg.qa_weight)})`;
    bySubjectTerm.set(key, (bySubjectTerm.get(key) ?? 0) + 1);
    if (isSubjectTermSplit(cfg, split)) allowed += 1;
    else
      bad.push(
        `${key} — ${one(r.section)?.name}${r.is_locked ? ' [locked]' : ''}`
      );
  }

  console.log(`sheets with their own weights: ${rows.length}`);
  console.log(`  allowed (subject weights, components off): ${allowed}`);
  console.log(`  NOT allowed (a different split): ${bad.length}`);
  console.log('\nby AY / term / subject:');
  for (const [k, n] of [...bySubjectTerm].sort())
    console.log(`  ${k}: ${n} sheets`);
  if (bad.length) {
    console.log('\nnot allowed:');
    for (const b of bad) console.log(`  ${b}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
