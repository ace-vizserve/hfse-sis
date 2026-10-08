// The Phase 3 check (markbook + publication), called from `verify`.
//
// Prints, against production's figures (prod-profile.md §3-4): sheets, locks,
// weights, teacher names and labels per AY × term; slot counts, slot maxes and
// exam totals; score-as-%-of-max percentiles; blank and zero rates; quarterly
// percentiles and the share under 75; N/A and letter overrides; the
// grade_audit_log, change requests, their approval ladders and the
// publication. Then proves:
//   * Hard Rule #1 — lib/compute/quarterly.ts (its self-test runs on import)
//     and the database's `compute_quarterly` both give 93 on the canonical
//     case;
//   * the trigger's stored grades agree with the database's own
//     `grade_component_ps` AND with lib's `computeQuarterly` on sampled sheets
//     (a normal one and the no-exam 37/63/0 one);
//   * the app's own loader (`buildAllRowSets`, lib/markbook/drill.ts — the
//     markbook dashboard's sheet list) returns every sheet with the right lock
//     state.
// Ends with a content fingerprint (two rebuilds must print the same one).

import { createHash } from 'node:crypto';

import { computeQuarterly } from '@/lib/compute/quarterly';
import { resolveSheetWeights } from '@/lib/grading/resolve-sheet-weights';
import { buildAllRowSets } from '@/lib/markbook/drill';

import { maskApprovalDate } from '../lib/constants';
import { sql, sqlRows } from '../lib/local';
import { loadSheets, noExamSheet } from './markbook';
import { PUBLICATION } from './publication';

const num = (q: string) => Number(sql(q).trim());
const failures: string[] = [];
function check(ok: boolean, what: string) {
  if (!ok) failures.push(what);
}

const GS = `grading_sheets gs join terms t on t.id = gs.term_id
  join academic_years a on a.id = t.academic_year_id`;
const GE_JOIN = `grade_entries ge join grading_sheets gs on gs.id = ge.grading_sheet_id
  join terms t on t.id = gs.term_id join academic_years a on a.id = t.academic_year_id`;

/** prod: ay|term → [sheets, locked, custom weights, teacher name, labels] */
const PROD_SHEETS: Record<string, number[]> = {
  'AY2025 1': [155, 152, 0, 0, 0],
  'AY2025 2': [155, 152, 0, 0, 0],
  'AY2025 3': [155, 152, 0, 0, 0],
  'AY2025 4': [155, 152, 0, 0, 0],
  'AY2026 1': [125, 119, 0, 110, 1],
  'AY2026 2': [124, 118, 0, 110, 2],
  'AY2026 3': [124, 3, 1, 0, 4],
  'AY2026 4': [123, 0, 37, 0, 13],
};
/** prod: ay|term → [quarterly p05, p50, % under 75 of graded] */
const PROD_Q: Record<string, [number, number, string]> = {
  'AY2025 1': [73, 87, '8.1'],
  'AY2025 2': [73, 89, '7.0'],
  'AY2025 3': [75, 90, '4.7'],
  'AY2025 4': [76, 91, '3.4'],
  'AY2026 1': [73, 87, '6.6'],
  'AY2026 2': [74, 88, '6.3'],
  'AY2026 3': [75, 89, '4.9'],
  'AY2026 4': [63, 67, '91.1'],
};

export async function verifyMarkbook(): Promise<void> {
  failures.length = 0;
  const total = num('select count(*) from grading_sheets');
  if (total === 0) {
    console.log(
      '  markbook: no grading sheets yet (markbook phase not run) — skipped'
    );
    return;
  }

  // ── Sheets ────────────────────────────────────────────────────────────
  console.log(
    '  grading_sheets per AY x term: sheets / locked / own weights / teacher name / slot labels   [prod]'
  );
  const perTerm =
    sqlRows(`select a.ay_code, t.term_number, count(*), count(*) filter (where gs.is_locked),
      count(*) filter (where gs.ww_weight is not null), count(gs.teacher_name), count(gs.slot_labels)
      from ${GS} group by 1, 2 order by 1, 2`);
  for (const [ay, term, n, locked, w, tn, lb] of perTerm) {
    console.log(
      `    ${ay} T${term}  ${n.padStart(3)} / ${locked.padStart(3)} / ${w.padStart(2)} / ${tn.padStart(3)} / ${lb.padStart(2)}   [${PROD_SHEETS[`${ay} ${term}`].join(' / ')}]`
    );
  }
  const expected =
    sqlRows(`select a.ay_code, count(*) * 4 from section_subjects ss join sections s on s.id = ss.section_id
      join academic_years a on a.id = s.academic_year_id where a.ay_code in ('AY2025','AY2026') group by 1`);
  for (const [ay, want] of expected) {
    const got = perTerm
      .filter((r) => r[0] === ay)
      .reduce((n, r) => n + Number(r[2]), 0);
    check(
      got === Number(want),
      `${ay}: ${got} sheets, want ${want} (one per class subject per term)`
    );
  }
  const cell = (ay: string, term: number, col: number) =>
    Number(
      perTerm.find((r) => r[0] === ay && Number(r[1]) === term)?.[col] ?? -1
    );
  for (let term = 1; term <= 4; term++) {
    check(
      cell('AY2025', term, 3) === cell('AY2025', term, 2),
      `AY2025 T${term} not all locked`
    );
  }
  check(
    cell('AY2026', 1, 3) === cell('AY2026', 1, 2),
    'AY2026 T1 not all locked'
  );
  check(
    cell('AY2026', 2, 3) === cell('AY2026', 2, 2),
    'AY2026 T2 not all locked'
  );
  check(
    cell('AY2026', 3, 3) === 3,
    `AY2026 T3 locked ${cell('AY2026', 3, 3)}, want 3`
  );
  check(cell('AY2026', 4, 3) === 0, 'AY2026 T4 has locked sheets');
  check(
    cell('AY2026', 4, 4) === 37 && cell('AY2026', 3, 4) === 1,
    'own-weight sheets: want T4 37 + T3 1'
  );
  check(
    cell('AY2025', 1, 5) === 0 && cell('AY2026', 3, 5) === 0,
    'teacher names outside AY2026 T1–T2'
  );
  const triples =
    sqlRows(`select ww_weight, pt_weight, qa_weight, count(*) from grading_sheets
      where ww_weight is not null group by 1, 2, 3 order by 4 desc`);
  console.log(
    `  own-weight triples: ${triples.map(([a, b, c, n]) => `${a}/${b}/${c} x${n}`).join(', ')}  [prod 0.30/0.50/0.20 x21, 0.20/0.60/0.20 x15, 0.37/0.63/0.00 x1, 0.40/0.40/0.20 x1]`
  );

  // ── Shapes ────────────────────────────────────────────────────────────
  const slots = sqlRows(`select ay, c, n, count(*) from (
      select a.ay_code ay, 'ww' c, coalesce(array_length(gs.ww_totals, 1), 0) n from ${GS}
      union all select a.ay_code, 'pt', coalesce(array_length(gs.pt_totals, 1), 0) from ${GS}) x
      group by 1, 2, 3 order by 1, 2, 3`);
  for (const ay of ['AY2025', 'AY2026']) {
    for (const c of ['ww', 'pt']) {
      console.log(
        `  ${ay} ${c} slots per sheet: ${slots
          .filter((r) => r[0] === ay && r[1] === c)
          .map((r) => `${r[2]}:${r[3]}`)
          .join(' ')}`
      );
    }
  }
  console.log(
    '    [prod AY2025 ww 0:232 3:298 4:60 5:30, pt 0:232 3:93 4:16 5:279; AY2026 ww 1:110 2:327 3:11 4:1 5:47, pt 1:3 2:24 3:398 5:71]'
  );
  const slotless = num(`select count(*) from ${GS} where a.ay_code = 'AY2025'
      and coalesce(array_length(gs.ww_totals, 1), 0) = 0 and coalesce(array_length(gs.pt_totals, 1), 0) = 0`);
  const ay25 = num(`select count(*) from ${GS} where a.ay_code = 'AY2025'`);
  console.log(
    `  AY2025 sheets with no WW/PT slots: ${slotless} of ${ay25} (${Math.round((100 * slotless) / ay25)}%; prod 232 of 620, 37%)`
  );
  check(
    slotless / ay25 > 0.25 && slotless / ay25 < 0.45,
    'AY2025 slotless share off'
  );
  const maxes = (c: string) =>
    sqlRows(
      `select v, count(*) from grading_sheets, unnest(${c}_totals) v group by 1 order by 2 desc limit 6`
    )
      .map(([v, n]) => `${Number(v)}:${n}`)
      .join(' ');
  console.log(
    `  slot maxes ww ${maxes('ww')} [prod 10:932 15:715 20:642]; pt ${maxes('pt')} [prod 10:1181 20:894 15:594 30:327 25:325]`
  );
  const qa = sqlRows(
    `select coalesce(qa_total::text, 'null'), count(*) from grading_sheets group by 1 order by 2 desc limit 7`
  );
  const qaNull = num(
    'select count(*) from grading_sheets where qa_total is null'
  );
  console.log(
    `  qa_total: ${qa.map(([v, n]) => `${v === 'null' ? v : Number(v)}:${n}`).join(' ')}; NULL ${Math.round((100 * qaNull) / total)}% [prod null 222 30:222 50:170 60:139 65:107 20:98, null 20%]`
  );

  // ── Scores ────────────────────────────────────────────────────────────
  const pcts = sqlRows(`with s as (
      select 'ww' c, (ge.ww_scores)[i] v, (gs.ww_totals)[i] m from ${GE_JOIN},
        generate_subscripts(ge.ww_scores, 1) i
      union all select 'pt', (ge.pt_scores)[i], (gs.pt_totals)[i] from ${GE_JOIN},
        generate_subscripts(ge.pt_scores, 1) i
      union all select 'qa', ge.qa_score, gs.qa_total from ${GE_JOIN} where ge.qa_score is not null)
    select c, ${[0.05, 0.25, 0.5, 0.75, 0.95]
      .map(
        (p) =>
          `round(percentile_disc(${p}) within group (order by 100.0 * v / m), 1)`
      )
      .join(', ')}
      from s where v is not null and m > 0 group by c order by c`);
  const prodPct: Record<string, string> = {
    pt: '43.3 / 73.3 / 85.0 / 95.0 / 100.0',
    qa: '34.9 / 61.7 / 76.7 / 87.5 / 97.5',
    ww: '43.3 / 73.3 / 86.7 / 100.0 / 100.0',
  };
  console.log('  score as % of max, p05 / p25 / p50 / p75 / p95   [prod]');
  for (const [c, ...ps] of pcts) {
    console.log(`    ${c}  ${ps.join(' / ')}   [${prodPct[c]}]`);
  }
  const p50 = Object.fromEntries(pcts.map((r) => [r[0], Number(r[3])]));
  check(Math.abs(p50.ww - 86.7) <= 5, `WW p50 ${p50.ww}, want ~87`);
  check(Math.abs(p50.pt - 85) <= 5, `PT p50 ${p50.pt}, want ~85`);
  check(Math.abs(p50.qa - 76.7) <= 5, `QA p50 ${p50.qa}, want ~77`);

  // Two blank rates: over every slot, and over the slots of entries that are
  // graded and not N/A. Production's imports created entries only for the
  // children with a mark, and its N/A entries carry empty arrays; here the RPC
  // gives every child on the list an entry and the derive trigger sizes every
  // array to the sheet — so the second figure is the one comparable to
  // production's (AY2026 T4 is checked on the first: it is mostly ungraded).
  const rates =
    sqlRows(`select a.ay_code, t.term_number, count(*), count(*) filter (where v is null),
      count(*) filter (where v = 0),
      count(*) filter (where ge.quarterly_grade is not null and not ge.is_na),
      count(*) filter (where v is null and ge.quarterly_grade is not null and not ge.is_na)
      from ${GE_JOIN}, unnest(ge.ww_scores || ge.pt_scores) v group by 1, 2 order by 1, 2`);
  console.log(
    '  slots: n / blank % (all) / blank % (graded, not N/A) / zero %   [prod AY2025 T1–T3 ~7% / 0.3–0.6%, AY2026 T1–T3 2–6% / 0.1–0.3%, AY2026 T4 98% blank]'
  );
  for (const [ay, term, n, all, z, gn, gb] of rates) {
    const allp = (100 * Number(all)) / Number(n);
    const bp = term === '4' ? allp : (100 * Number(gb)) / Number(gn);
    const zp = (100 * Number(z)) / Number(n);
    console.log(
      `    ${ay} T${term}  ${n.padStart(5)} / ${allp.toFixed(1)}% / ${term === '4' ? '—' : `${bp.toFixed(1)}%`} / ${zp.toFixed(2)}%`
    );
    if (ay === 'AY2026' && term === '4')
      check(bp >= 95, `AY2026 T4 blank ${bp.toFixed(1)}%, want ~98%`);
    else if (!(ay === 'AY2025' && term === '4')) {
      check(
        bp >= 1 && bp <= 12,
        `${ay} T${term} blank ${bp.toFixed(1)}%, want 2–7%`
      );
      check(zp < 1, `${ay} T${term} zero ${zp.toFixed(2)}%, want < 1%`);
    }
  }

  const q =
    sqlRows(`select a.ay_code, t.term_number, count(*), count(ge.quarterly_grade),
      percentile_disc(0.05) within group (order by ge.quarterly_grade),
      percentile_disc(0.5) within group (order by ge.quarterly_grade),
      round(100.0 * count(*) filter (where ge.quarterly_grade < 75) / nullif(count(ge.quarterly_grade), 0), 1),
      count(*) filter (where ge.is_na), count(ge.letter_grade), count(*) filter (where ge.qa_score is null)
      from ${GE_JOIN} group by 1, 2 order by 1, 2`);
  console.log(
    '  entries: n / graded / quarterly p05 / p50 / % under 75 / N/A / letters   [prod p05 / p50 / % under 75]'
  );
  for (const [ay, term, n, g, p05, p50q, u75, na, lt] of q) {
    const [pp05, pp50, pu] = PROD_Q[`${ay} ${term}`];
    console.log(
      `    ${ay} T${term}  ${n.padStart(4)} / ${g.padStart(4)} / ${p05} / ${p50q} / ${u75}% / ${na} / ${lt}   [${pp05} / ${pp50} / ${pu}%]`
    );
    if (term !== '4') {
      check(
        Number(p50q) >= 85 && Number(p50q) <= 92,
        `${ay} T${term} quarterly p50 ${p50q}, want 87–91`
      );
      check(
        Number(u75) >= 3 && Number(u75) <= 9,
        `${ay} T${term} under-75 ${u75}%, want 4–7%`
      );
    }
  }
  const na25 = num(
    `select count(*) from ${GE_JOIN} where a.ay_code = 'AY2025' and ge.is_na`
  );
  const all25 = num(
    `select count(*) from ${GE_JOIN} where a.ay_code = 'AY2025'`
  );
  console.log(
    `  N/A: AY2025 ${((100 * na25) / all25).toFixed(1)}% of entries (prod 994 / 11,814 = 8.4%); AY2026 0 (prod 0)`
  );
  const t4 =
    num(`select count(*) from ${GE_JOIN} where a.ay_code = 'AY2025' and t.term_number = 4
      and (ge.qa_score is not null or exists (select 1 from unnest(ge.ww_scores || ge.pt_scores) v where v is not null))`);
  console.log(
    `  AY2025 T4 entries holding any score: ${t4} (prod 0 — quarterly only)`
  );
  check(t4 === 0, 'AY2025 T4 holds scores');

  // ── Post-lock trail, requests, publication ────────────────────────────
  const gal =
    sqlRows(`select split_part(field_changed, '[', 1), count(*), count(approval_reference)
      from grade_audit_log group by 1 order by 1`);
  const galN = gal.reduce((n, r) => n + Number(r[1]), 0);
  console.log(
    `  grade_audit_log ${galN} (target ~150): ${gal.map(([f, n, a]) => `${f} ${n} (${a} with approval_reference)`).join(', ')}  [prod 258: quarterly_grade 252 (migration 177), scores/totals 6]`
  );
  check(galN >= 120 && galN <= 180, `grade_audit_log ${galN}, want ~150`);
  check(
    gal.every((r) => r[1] === r[2]),
    'a grade_audit_log row without approval_reference (Hard Rule #5)'
  );
  const unlockedTrail = num(
    `select count(*) from grade_audit_log gal join grading_sheets gs on gs.id = gal.grading_sheet_id where not gs.is_locked`
  );
  check(
    unlockedTrail === 0,
    `${unlockedTrail} grade_audit_log rows on unlocked sheets`
  );

  const crs =
    sqlRows(`select status, field_changed, reason_category, coalesce(approval_flow, ''),
      coalesce(notification_status, ''), count(*) from grade_change_requests group by 1, 2, 3, 4, 5`);
  console.log(
    `  grade_change_requests: ${crs.map((r) => r.join('|')).join('; ')}  [prod applied|ww_scores|regrading|(legacy, no flow)|sent 1 + pending 1]`
  );
  check(
    num(
      `select count(*) from grade_change_requests where status = 'applied' and applied_at is not null`
    ) === 2,
    'want 2 applied grade change requests'
  );
  const ladders =
    sqlRows(`select r.flow, r.status, count(*) from approval_requests r
      where r.subject_type = 'grade_change_request' group by 1, 2`);
  console.log(
    `  their approval requests: ${ladders.map((r) => r.join('|')).join('; ')}`
  );
  const pubs = num('select count(*) from report_card_publications');
  const evaluated = num('select count(*) from evaluation_writeups');
  console.log(
    `  report_card_publications: ${pubs} (prod 1: AY2026 T3, with gaps, notified, 4 days)${pubs === 0 ? ` — the publish gate refuses ${PUBLICATION.level} ${PUBLICATION.section} until adviser comments exist (evaluation_writeups: ${evaluated})` : ''}`
  );
  if (evaluated > 0)
    check(pubs === 1, `publication ${pubs}, want 1 once writeups exist`);
  const actions =
    sqlRows(`select action, count(*) from audit_log where action in ('entry.update', 'totals.update', 'sheet.lock',
      'sheet.unlock', 'sheet.labels.update', 'subject_config.term_weights', 'grade_correction',
      'grade_change_requested', 'grade_change_approved', 'grade_change_applied', 'publication.create')
      group by 1 order by 1`);
  console.log(
    `  markbook audit_log: ${actions.map(([a, n]) => `${a} ${n}`).join(', ')}  [prod entry.update 491, totals.update 250, sheet.labels.update 140, sheet.lock 13, sheet.unlock 10, subject_config.term_weights 8, publication.create 52]`
  );

  // Term 4's marks went in through the entries route: one `entry.update` per
  // mark, on Term 4 entries only (the other terms are import-shaped).
  const t4Marks =
    num(`select count(*) from ${GE_JOIN}, unnest(ge.ww_scores || ge.pt_scores || array[ge.qa_score]) v
      where a.ay_code = 'AY2026' and t.term_number = 4 and v is not null`);
  const [[entryUpdates, offTerm4]] = sqlRows(`select count(*),
      count(*) filter (where not exists (select 1 from ${GE_JOIN} where ge.id::text = al.entity_id::text
        and a.ay_code = 'AY2026' and t.term_number = 4))
      from audit_log al where al.action = 'entry.update'`);
  console.log(
    `  entries route (AY2026 T4): ${t4Marks} marks, ${entryUpdates} entry.update rows (${offTerm4} outside Term 4)  [prod entry.update 491 in all]`
  );
  check(
    Number(entryUpdates) === t4Marks && Number(offTerm4) === 0,
    `entry.update ${entryUpdates} (${offTerm4} outside T4) vs ${t4Marks} Term 4 marks`
  );

  // ── Hard Rule #1 + trigger vs lib on sampled sheets ───────────────────
  const canonical = computeQuarterly({
    ww_scores: [10, 10],
    ww_totals: [10, 10],
    pt_scores: [6, 10, 10],
    pt_totals: [10, 10, 10],
    qa_score: 22,
    qa_total: 30,
    ww_weight: 0.4,
    pt_weight: 0.4,
    qa_weight: 0.2,
  }).quarterly_grade;
  const dbCanonical = num(`select quarterly_grade from compute_quarterly(
      '{10,10}', '{10,10}', '{6,10,10}', '{10,10,10}', 22, 30, 0.4, 0.4, 0.2)`);
  console.log(
    `  Hard Rule #1: lib computeQuarterly ${canonical}, database compute_quarterly ${dbCanonical} (want 93)`
  );
  check(
    canonical === 93 && dbCanonical === 93,
    'Hard Rule #1 canonical case is not 93'
  );

  const sheets = loadSheets();
  const sample = [
    sheets.find(
      (s) =>
        s.ay === 'AY2026' && s.term === 3 && !s.ownWeights && s.code === 'MATH'
    )!,
    noExamSheet(sheets),
  ];
  for (const s of sample) {
    const rows =
      sqlRows(`select array_to_string(ge.ww_scores, ',', 'x'), array_to_string(ge.pt_scores, ',', 'x'),
        coalesce(ge.qa_score::text, ''), coalesce(ge.ww_ps::text, ''), coalesce(ge.quarterly_grade::text, ''),
        coalesce(round(grade_component_ps(ge.ww_scores, gs.ww_totals, ge.ww_excused)::numeric, 4)::text, ''),
        coalesce(gs.ww_weight::text, sc.ww_weight::text), coalesce(gs.pt_weight::text, sc.pt_weight::text),
        coalesce(gs.qa_weight::text, sc.qa_weight::text)
        from grade_entries ge join grading_sheets gs on gs.id = ge.grading_sheet_id
        join subject_configs sc on sc.id = gs.subject_config_id
       where gs.id = '${s.id}' and ge.quarterly_grade is not null`);
    const arr = (x: string) =>
      x === '' ? [] : x.split(',').map((v) => (v === 'x' ? null : Number(v)));
    let psBad = 0;
    let qBad = 0;
    for (const [ww, pt, qa, wwPs, qg, dbPs, w1, w2, w3] of rows) {
      if (wwPs !== '' && Math.abs(Number(wwPs) - Number(dbPs)) > 1e-3) psBad++;
      const out = computeQuarterly({
        ww_scores: arr(ww),
        ww_totals: s.ww_totals,
        pt_scores: arr(pt),
        pt_totals: s.pt_totals,
        qa_score: qa === '' ? null : Number(qa),
        qa_total: s.qa_total,
        ...resolveSheetWeights(
          { ww_weight: w1, pt_weight: w2, qa_weight: w3 },
          null
        ),
      });
      if (out.quarterly_grade !== Number(qg)) qBad++;
    }
    console.log(
      `  sampled sheet ${s.key}${s.ownWeights ? ' (own weights)' : ''}: ${rows.length} graded entries — stored ww_ps vs grade_component_ps mismatches ${psBad}, stored quarterly vs lib computeQuarterly mismatches ${qBad}`
    );
    check(
      rows.length > 0 && psBad === 0 && qBad === 0,
      `${s.key}: trigger, database and lib disagree`
    );
  }

  // ── The app's own loader ──────────────────────────────────────────────
  for (const ay of ['AY2025', 'AY2026']) {
    const { sheets: loaded } = await buildAllRowSets({ ayCode: ay });
    const want = sheets.filter((s) => s.ay === ay);
    const lockedOk = loaded.every(
      (l) => want.find((w) => w.id === l.sheetId)?.locked === l.isLocked
    );
    console.log(
      `  buildAllRowSets (lib/markbook/drill.ts, the markbook dashboard) ${ay}: ${loaded.length} sheets (${loaded.filter((l) => l.isLocked).length} locked, ${loaded.filter((l) => l.teacherName).length} with a teacher name); expected ${want.length}; lock states agree: ${lockedOk}`
    );
    check(
      loaded.length === want.length && lockedOk,
      `buildAllRowSets ${ay} disagrees with the database`
    );
  }

  // ── Fingerprint ───────────────────────────────────────────────────────
  const key = `a.ay_code || ' T' || t.term_number || ' ' || l.code || ' ' || s.name || ' ' || sub.code`;
  const SK = `${GS} join sections s on s.id = gs.section_id join levels l on l.id = s.level_id join subjects sub on sub.id = gs.subject_id`;
  const fp = createHash('sha256')
    .update(
      sql(`select ${key}, gs.ww_totals::text, gs.pt_totals::text, coalesce(gs.qa_total::text, ''),
             coalesce(gs.ww_weight::text, ''), coalesce(gs.pt_weight::text, ''), coalesce(gs.qa_weight::text, ''),
             gs.is_locked, coalesce(gs.locked_at::text, ''), coalesce(gs.locked_by, ''),
             coalesce(gs.teacher_name, ''), coalesce(gs.slot_labels::text, '')
           from ${SK} order by 1`)
    )
    .update(
      sql(`select ${key}, st.student_number, ge.ww_scores::text, ge.pt_scores::text, coalesce(ge.qa_score::text, ''),
             coalesce(ge.ww_ps::text, ''), coalesce(ge.pt_ps::text, ''), coalesce(ge.qa_ps::text, ''),
             coalesce(ge.initial_grade::text, ''), coalesce(ge.quarterly_grade::text, ''), ge.is_na, coalesce(ge.letter_grade, '')
           from grade_entries ge join ${SK} on gs.id = ge.grading_sheet_id
           join section_students ss on ss.id = ge.section_student_id join students st on st.id = ss.student_id
          order by 1, 2`)
    )
    .update(
      // A totals row hangs off the sheet's first entry BY ID (the totals
      // route's anchor) — a random uuid, so whose entry it is varies.
      sql(`select ${key}, case when gal.field_changed like '%total%' then '' else st.student_number end,
             gal.field_changed, coalesce(gal.old_value, ''),
             coalesce(gal.new_value, ''), gal.changed_by, ${maskApprovalDate("coalesce(gal.approval_reference, '')")}
           from grade_audit_log gal join ${SK} on gs.id = gal.grading_sheet_id
           join grade_entries ge on ge.id = gal.grade_entry_id
           join section_students ss on ss.id = ge.section_student_id join students st on st.id = ss.student_id
          order by 1, 2, 3, 4, 5`)
    )
    .update(
      sql(`select id, field_changed, coalesce(slot_index::text, ''), coalesce(current_value, ''), proposed_value,
             reason_category, status, coalesce(approval_flow, ''), requested_by_email, coalesce(reviewed_by_email, '')
           from grade_change_requests order by 1`)
    )
    .digest('hex')
    .slice(0, 16);
  console.log(`  markbook fingerprint: ${fp}`);

  if (failures.length) {
    throw new Error(
      `markbook check failed:\n    - ${failures.join('\n    - ')}`
    );
  }
  console.log('  markbook check: PASS');
}
