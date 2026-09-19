// Read-only: re-check the open items that are quoted from older notes, so the
// list reflects the database rather than what was true when someone wrote it
// down. Three of these have already turned out to be stale.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-open-items-recheck.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

async function main() {
  const { data: ay } = await sb
    .from('academic_years')
    .select('id')
    .eq('ay_code', 'AY2026')
    .single();
  const ayId = (ay as any).id;

  // ── 1. KD #218 — can a term say it has no exam, and is anything using it? ──
  console.log('1. KD #218 — per-term weights on grading sheets');
  const { data: sheets } = await sb
    .from('grading_sheets')
    .select(
      'id, ww_weight, pt_weight, qa_weight, term_id, subject_id, section_id'
    )
    .not('qa_weight', 'is', null);
  const zeroExam = (sheets ?? []).filter((s: any) => Number(s.qa_weight) === 0);
  console.log(
    `   sheets carrying their own weights : ${(sheets ?? []).length}`
  );
  console.log(`   of those, exam weight set to 0    : ${zeroExam.length}`);
  if (zeroExam.length) {
    for (const s of zeroExam.slice(0, 10)) {
      const { data: subj } = await sb
        .from('subjects')
        .select('name')
        .eq('id', (s as any).subject_id)
        .maybeSingle();
      const { data: sec } = await sb
        .from('sections')
        .select('name, levels(code)')
        .eq('id', (s as any).section_id)
        .maybeSingle();
      const { data: t } = await sb
        .from('terms')
        .select('term_number')
        .eq('id', (s as any).term_id)
        .maybeSingle();
      console.log(
        `     ${(sec as any)?.levels?.code ?? '?'} ${(sec as any)?.name ?? '?'} · ${(subj as any)?.name ?? '?'} · T${(t as any)?.term_number ?? '?'}  ww=${(s as any).ww_weight} pt=${(s as any).pt_weight} qa=0`
      );
    }
    console.log(
      '   → somebody HAS unticked an exam, so the feature is in use.'
    );
  } else {
    console.log(
      '   → nothing has unticked an exam yet, so the canonical check has not been exercised.'
    );
  }

  // ── 2. Calendar rows outside every term window ────────────────────────────
  console.log('\n2. Calendar entries outside every AY2026 term window');
  const { data: terms } = await sb
    .from('terms')
    .select('term_number, start_date, end_date')
    .eq('academic_year_id', ayId)
    .order('term_number');
  for (const t of terms ?? [])
    console.log(
      `   T${(t as any).term_number}: ${(t as any).start_date} → ${(t as any).end_date}`
    );
  const windows = (terms ?? [])
    .map((t: any) => [t.start_date, t.end_date])
    .filter(([a, b]) => a && b) as [string, string][];
  const inside = (d: string) => windows.some(([a, b]) => d >= a && d <= b);

  const { data: closures } = await sb
    .from('school_calendar')
    .select('date, day_type, label')
    .gte('date', '2026-01-01')
    .lte('date', '2026-12-31');
  const outClosures = (closures ?? []).filter(
    (c: any) => c.date && !inside(c.date)
  );
  const { data: events } = await sb
    .from('calendar_events')
    .select('start_date, title')
    .gte('start_date', '2026-01-01')
    .lte('start_date', '2026-12-31');
  const outEvents = (events ?? []).filter(
    (e: any) => e.start_date && !inside(e.start_date)
  );
  console.log(
    `   closures outside a term : ${outClosures.length} of ${(closures ?? []).length}`
  );
  console.log(
    `   events   outside a term : ${outEvents.length} of ${(events ?? []).length}`
  );

  // 🔴 ZERO HERE DOES NOT MEAN THE ITEM IS CLOSED, and reading it that way is
  // the trap. The open item is that 43 closures and 9 events have NOWHERE to be
  // stored, because both tables are term-scoped — so those rows were never
  // inserted. A query over the table can only see rows that exist. The right
  // question is whether the GAPS BETWEEN TERMS are empty, which is what the
  // absence looks like from inside the database.
  const gaps: [string, string][] = [];
  for (let i = 0; i < windows.length - 1; i++) {
    gaps.push([windows[i][1], windows[i + 1][0]]);
  }
  console.log('   between-term gaps, and what is recorded in them:');
  for (const [from, to] of gaps) {
    const n = (closures ?? []).filter(
      (c: any) => c.date > from && c.date < to
    ).length;
    console.log(`     ${from} → ${to}  : ${n} closure row(s)`);
  }
  const firstStart = windows[0]?.[0];
  const lastEnd = windows[windows.length - 1]?.[1];
  const before = (closures ?? []).filter(
    (c: any) => c.date < firstStart
  ).length;
  const after = (closures ?? []).filter((c: any) => c.date > lastEnd).length;
  console.log(`     before ${firstStart}     : ${before} closure row(s)`);
  console.log(`     after  ${lastEnd}     : ${after} closure row(s)`);
  console.log(
    '   → all zero means the unstorable days are still unstorable, not that\n' +
      '     somebody fixed it. The item stands.'
  );

  // ── 3. Withdrawn AY2026 students still with no class row ──────────────────
  console.log('\n3. Withdrawn AY2026 students with no class row');
  const { data: status } = await sb
    .from('ay2026_enrolment_status')
    .select('"enroleeNumber","enroleeName","applicationStatus"')
    .ilike('"applicationStatus"', '%withdraw%');
  const { data: apps } = await sb
    .from('ay2026_enrolment_applications')
    .select('"enroleeNumber","studentNumber"');
  const numberBy = new Map(
    (apps ?? []).map((a: any) => [a.enroleeNumber, a.studentNumber])
  );

  const { data: secs } = await sb
    .from('sections')
    .select('id')
    .eq('academic_year_id', ayId);
  const secIds = (secs ?? []).map((s: any) => s.id);
  const { data: roster } = await sb
    .from('section_students')
    .select('student_id')
    .in('section_id', secIds);
  const { data: studs } = await sb
    .from('students')
    .select('id, student_number');
  const numById = new Map(
    (studs ?? []).map((s: any) => [s.id, s.student_number])
  );
  const placed = new Set(
    (roster ?? []).map((r: any) => numById.get(r.student_id)).filter(Boolean)
  );

  const missing = (status ?? []).filter((s: any) => {
    const n = numberBy.get(s.enroleeNumber);
    return !n || !placed.has(n);
  });
  console.log(
    `   withdrawn AY2026 rows : ${(status ?? []).length}, of which NOT on an AY2026 roster : ${missing.length}`
  );
  for (const m of missing.slice(0, 20)) {
    console.log(
      `     ${String(numberBy.get((m as any).enroleeNumber) ?? '(no number)').padEnd(9)} ${(m as any).enroleeName}`
    );
  }
  if (missing.length > 20)
    console.log(`     … and ${missing.length - 20} more`);
  console.log(
    '   ⚠ matches on the AY2026 studentNumber, which is wrong for a child whose\n' +
      '     real number lives on an older row — so this can overcount (CLAUDE.md).'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
