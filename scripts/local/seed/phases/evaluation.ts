// Phase "evaluation" (plan phase 5): the form advisers' write-ups
// (`evaluation_writeups`, the report card's FCA comment).
//
// Production (prod-profile.md §5): AY2025 T1–T3 and AY2026 T1–T2 hold one
// submitted write-up for ~95% of the children on the class list (398 / 374 /
// 384 / 369 / 371), plain text; AY2026 T3 holds 2, short and HTML-wrapped
// (the in-app editor). 4 of 1,898 rows start with <p>. 37 evaluation audit
// rows in all (save 18, resubmit 11, submit 8).
//
// Two write paths, as production's rows came about:
//
//   * IMPORTED (AY2025 T1–T3, AY2026 T1–T2). Production loaded these with the
//     backfill import (lib/sis/backfill/evaluation/build-writeups-import.ts →
//     scripts/backfill/ay2026-t{1,2}-writeups-apply.sql, 2026-07-20): one
//     `insert … (term_id, student_id, section_id, writeup, submitted,
//     submitted_at) … on conflict do nothing`, no `created_by`. That was
//     BEFORE migration 150 (2026-09-14) added the touch and audit triggers,
//     so the rows carry the import's submitted_at, no author and no audit
//     row. Mirrored as exactly that statement, with the two triggers switched
//     off for its transaction — that is the database the import ran against.
//     AY2025 has no teacher assignments, so no author can be named there
//     either; created_by is NULL on every imported row.
//
//   * IN THE APP (AY2026 T3, and a few later edits of T2 comments). The page
//     (components/evaluation/writeup-roster-client.tsx) writes straight to
//     Supabase as the signed-in adviser: `upsert({ term_id, section_id,
//     student_id, writeup, submitted }, { onConflict: 'term_id,student_id' })`
//     under the RLS policies of migration 150, and the triggers stamp
//     created_by / submitted_at and write the audit row (save / submit /
//     resubmit). Done the same way here: the class's form adviser signs in
//     with a password and upserts through an authenticated client.
//
// ⚠ AY2026 T3 HAS 4 ROWS, NOT PRODUCTION'S 2. Production's two T3 comments
// are the class its one T3 report card was published for; the publish gate
// (computePublishReadiness → cumulativeCommentGaps) hard-blocks a T3 card
// until every child on the roster has a submitted comment for T1, T2 AND T3.
// The local published class (publication.ts: P3 Courtesy) has 4 children, so
// all 4 get their T3 comment — fewer and the real gate refuses the publish.
// For the same reason Courtesy is never among the ~5% without a T1/T2 comment.
//
// Idempotent: imports are `on conflict do nothing`; the in-app saves are
// counted per child by their trigger audit rows (one per save, written in the
// save's own transaction), so a re-run makes exactly the saves still missing.

import { TODAY, LOCAL_PASSWORD } from '../lib/constants';
import { anon, must, service, sql, sqlRows } from '../lib/local';
import { rng } from '../lib/random';
import { loadRoster, type Enrolment } from '../attendance/roster';
import { shortWriteup, writeup } from '../evaluation/text';
import { PUBLICATION } from './publication';

/** Imported terms and the year's median comment length (production p50). */
const IMPORTED: Array<{
  ay: 'AY2025' | 'AY2026';
  term: number;
  median: number;
}> = [
  { ay: 'AY2025', term: 1, median: 330 },
  { ay: 'AY2025', term: 2, median: 300 },
  { ay: 'AY2025', term: 3, median: 335 },
  { ay: 'AY2026', term: 1, median: 250 },
  { ay: 'AY2026', term: 2, median: 260 },
];
const COVERAGE = 0.95;
/** AY2026 T2 comments an adviser went back and edited in the app. */
const T2_EDITS = 3;

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Each child's enrolment on the class list on the term's last school day. */
function onListAtTermEnd(enrolments: Enrolment[], termId: string): Enrolment[] {
  const out = new Map<string, Enrolment>();
  // The last school day of the term for each enrolment's level.
  const lastDay = new Map<string, string>();
  for (const e of enrolments)
    for (const d of e.days)
      if (d.termId === termId && (lastDay.get(e.level) ?? '') < d.date)
        lastDay.set(e.level, d.date);
  for (const e of enrolments) {
    const end = lastDay.get(e.level);
    if (end && e.days.some((d) => d.date === end)) out.set(e.studentNumber, e);
  }
  return [...out.values()].sort((a, b) =>
    a.studentNumber.localeCompare(b.studentNumber)
  );
}

function genders(): Map<string, string> {
  return new Map(
    sqlRows(
      `select "studentNumber", "gender" from ay2025_enrolment_applications where "gender" is not null
       union all
       select "studentNumber", "gender" from ay2026_enrolment_applications where "gender" is not null`
    ).map(([sn, g]) => [sn, g])
  );
}

async function signIn(email: string) {
  const client = anon();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: LOCAL_PASSWORD,
  });
  if (error)
    throw new Error(`evaluation: sign-in as ${email}: ${error.message}`);
  return client;
}

/** The page's save, as the signed-in adviser. */
async function save(
  client: Awaited<ReturnType<typeof signIn>>,
  row: { termId: string; sectionId: string; studentId: string },
  text: string,
  submit: boolean
): Promise<void> {
  const { error } = await client
    .from('evaluation_writeups')
    .upsert(
      {
        term_id: row.termId,
        section_id: row.sectionId,
        student_id: row.studentId,
        writeup: text,
        submitted: submit,
      },
      { onConflict: 'term_id,student_id' }
    )
    .select('submitted, submitted_at')
    .single();
  if (error) throw new Error(`evaluation: save refused: ${error.message}`);
}

export async function runEvaluation(): Promise<void> {
  const roster = await loadRoster();
  const gender = genders();
  const virtues = new Map(
    sqlRows(`select t.id, coalesce(t.virtue_theme, '') from terms t`).map(
      ([id, v]) => [id, v]
    )
  );
  const courtesy = (e: Enrolment) =>
    e.ay === PUBLICATION.ay &&
    e.level === PUBLICATION.level &&
    e.sectionName === PUBLICATION.section;

  // ── Imported terms ──────────────────────────────────────────────────────
  const counts: string[] = [];
  for (const { ay, term, median } of IMPORTED) {
    const t = roster.terms.find((x) => x.ay === ay && x.number === term)!;
    const r = rng(`evaluation:coverage:${ay}:${term}`);
    const rows = onListAtTermEnd(
      roster.enrolments.filter((e) => e.ay === ay),
      t.id
    ).filter((e) => {
      const skipped = r.chance(1 - COVERAGE);
      return courtesy(e) || !skipped;
    });
    const values = rows
      .map(
        (e) =>
          `(${q(e.studentId)}::uuid, ${q(e.sectionId)}::uuid, ${q(
            writeup({
              key: `${ay}:${term}:${e.studentNumber}`,
              studentNumber: e.studentNumber,
              firstName: e.firstName,
              gender: gender.get(e.studentNumber) ?? null,
              virtue: virtues.get(t.id) || 'Respect',
              median,
            })
          )})`
      )
      .join(',\n');
    // The import's submitted_at: the evening the term closed.
    const submittedAt = `${t.end}T17:30:00+08:00`;
    const inserted = sql(`begin;
alter table public.evaluation_writeups disable trigger evaluation_writeups_audit_trg;
alter table public.evaluation_writeups disable trigger evaluation_writeups_touch_trg;
with ins as (
  insert into public.evaluation_writeups (term_id, student_id, section_id, writeup, submitted, submitted_at)
  select ${q(t.id)}::uuid, r.student_id, r.section_id, r.writeup, true, ${q(submittedAt)}::timestamptz
    from (values ${values}) as r(student_id, section_id, writeup)
  on conflict (term_id, student_id) do nothing
  returning 1)
select count(*) from ins;
alter table public.evaluation_writeups enable trigger evaluation_writeups_audit_trg;
alter table public.evaluation_writeups enable trigger evaluation_writeups_touch_trg;
commit;`);
    counts.push(`${ay} T${term} ${inserted}/${rows.length}`);
  }
  console.log(`  imported write-ups (new/planned): ${counts.join(', ')}`);

  // ── In the app ──────────────────────────────────────────────────────────
  const advisers = new Map(
    sqlRows(
      `select ta.section_id, u.email from teacher_assignments ta
         join auth.users u on u.id = ta.teacher_user_id where ta.role = 'form_adviser'`
    ).map(([s, e]) => [s, e])
  );
  // Which rows exist — never their text: psql's line-and-`|` output would
  // split a multi-paragraph comment (evaluation/text.ts joins paragraphs with
  // a blank line). Full texts are read through supabase-js where needed.
  const existing = new Set(
    sqlRows(`select term_id || ':' || student_id from evaluation_writeups`).map(
      ([k]) => k
    )
  );
  // The in-app saves already made, per (term, child): the trigger writes one
  // audit row per save in the same transaction as the save itself, so the
  // count is exactly how many of a child's planned saves have landed.
  const savesDone = new Map(
    sqlRows(
      `select context->>'term_id' || ':' || (context->>'student_id'), count(*) from audit_log
        where action like 'evaluation.writeup.%' group by 1`
    ).map(([k, n]) => [k, Number(n)])
  );
  let appWrites = 0;

  // AY2026 T3: the published class's comments (see the header).
  const t3 = roster.terms.find((x) => x.ay === 'AY2026' && x.number === 3)!;
  const t3Rows = onListAtTermEnd(
    roster.enrolments.filter((e) => e.ay === 'AY2026' && courtesy(e)),
    t3.id
  ).filter((e) => e.status !== 'withdrawn');
  if (t3Rows.length > 0) {
    let client: Awaited<ReturnType<typeof signIn>> | null = null;
    for (const [i, e] of t3Rows.entries()) {
      const final = `<p>${shortWriteup(`${e.studentNumber}:final`)}</p>`;
      // Drafted, then submitted; the first one edited after submitting.
      const steps: Array<[string, boolean]> =
        i === 0
          ? [
              [`<p>${shortWriteup(`${e.studentNumber}:draft`)}</p>`, false],
              [`<p>${shortWriteup(`${e.studentNumber}:first`)}</p>`, true],
              [final, true],
            ]
          : [
              [final, false],
              [final, true],
            ];
      const done = savesDone.get(`${t3.id}:${e.studentId}`) ?? 0;
      if (done >= steps.length) continue;
      client ??= await signIn(advisers.get(e.sectionId)!);
      const row = {
        termId: t3.id,
        sectionId: e.sectionId,
        studentId: e.studentId,
      };
      for (const [text, submit] of steps.slice(done)) {
        await save(client, row, text, submit);
        appWrites++;
      }
    }
    if (client) await client.auth.signOut();
  }

  // AY2026 T2: a few imported comments later edited by their adviser.
  const t2 = roster.terms.find((x) => x.ay === 'AY2026' && x.number === 2)!;
  const editable = onListAtTermEnd(
    roster.enrolments.filter(
      (e) => e.ay === 'AY2026' && !courtesy(e) && e.status !== 'withdrawn'
    ),
    t2.id
  ).filter(
    (e) => advisers.has(e.sectionId) && existing.has(`${t2.id}:${e.studentId}`)
  );
  const edits = rng('evaluation:t2-edits').shuffle(editable).slice(0, T2_EDITS);
  // The imported comments in full, through supabase-js (never psql — see
  // above), so an edit can never be built on a truncated text.
  const priorText = new Map(
    (
      await must(
        'evaluation: T2 comments to edit',
        service()
          .from('evaluation_writeups')
          .select('student_id, writeup')
          .eq('term_id', t2.id)
          .in(
            'student_id',
            edits.map((e) => e.studentId)
          )
      )
    ).map((w) => [w.student_id as string, (w.writeup as string | null) ?? ''])
  );
  for (const e of edits) {
    // Already edited (the edit is the comment's one in-app save).
    if ((savesDone.get(`${t2.id}:${e.studentId}`) ?? 0) > 0) continue;
    const prior = priorText.get(e.studentId) ?? '';
    if (prior === '' || prior.startsWith('<p>')) continue;
    // The adviser fixes a sentence: same comment, in the editor's markup.
    const edited = `<p>${prior
      .split('\n\n')
      .join('</p><p>')
      .replace(
        / this term\./,
        ' this term, especially in the last few weeks.'
      )}</p>`;
    const client = await signIn(advisers.get(e.sectionId)!);
    await save(
      client,
      { termId: t2.id, sectionId: e.sectionId, studentId: e.studentId },
      edited,
      true
    );
    await client.auth.signOut();
    appWrites++;
  }
  console.log(
    `  in-app saves (adviser sign-in, RLS, trigger audit): ${appWrites} (AY2026 T3 ${t3Rows.length} rows; ${edits.length} AY2026 T2 edits) — as of ${TODAY}`
  );
}
