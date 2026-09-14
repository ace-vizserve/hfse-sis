// scripts/backfill/probe-index-drift.ts
//
// Read-only. Answers the question the migration-147 preview raised: "Generate
// index" reports that 15 of 21 AY2026 sections would change, several of them
// wholesale — so what is actually wrong with the stored numbers?
//
// The headline counts mislead on their own. A class reporting "12 of 12 would
// change" turned out to have an almost-correct ORDER: two students transposed
// at the top, and a hole at #3 that nobody holds. Closing that hole shifts the
// number of all ten students below it, and every one of them counts as
// "changed" even though they are in the right sequence.
//
// Position and number are different faults and they need different tools:
//
//   OUT OF ORDER — two students in the wrong sequence. A swap fixes it, leaves
//                  everyone else alone, and does not need Generate at all.
//   GAP          — a number nobody holds (usually a student who left whose row
//                  was removed rather than marked withdrawn, so the number was
//                  never retired). A swap CANNOT fix this: there is no second
//                  holder to trade with. Only Generate closes a hole, and it
//                  renumbers everyone below it to do so.
//
// This prints which fault each section has, so the choice of tool is a reading
// rather than a guess.
//
// Writes nothing.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/probe-index-drift.ts
import { createServiceClient } from '../../lib/supabase/service';

const AY_CODE = 'AY2026';

type Row = {
  index_number: number;
  enrollment_status: string;
  enrollment_date: string | null;
  student:
    | { last_name: string; first_name: string; middle_name: string | null }
    | Array<{
        last_name: string;
        first_name: string;
        middle_name: string | null;
      }>
    | null;
};

async function main() {
  const svc = createServiceClient();

  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', AY_CODE)
    .single();
  const ayId = (ay as { id: string }).id;

  const { data: terms } = await svc
    .from('terms')
    .select('start_date')
    .eq('academic_year_id', ayId);
  const t1Start =
    ((terms ?? []) as Array<{ start_date: string | null }>)
      .map((t) => t.start_date)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

  const { data: sections } = await svc
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', ayId)
    .order('name');
  const secs = (sections ?? []) as Array<{ id: string; name: string }>;

  console.log(`\n${AY_CODE} — index number health (year opens ${t1Start})\n`);
  console.log(
    'section                  roster  gaps          out-of-order  Generate moves'
  );
  console.log(
    '------------------------ ------  ------------  ------------  --------------'
  );

  let totalGaps = 0;
  let totalOutOfOrder = 0;
  const gapSections: string[] = [];
  const orderSections: string[] = [];

  for (const sec of secs) {
    const { data } = await svc
      .from('section_students')
      .select(
        'index_number, enrollment_status, enrollment_date, student:students(last_name, first_name, middle_name)'
      )
      .eq('section_id', sec.id)
      .order('index_number');
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) continue;

    const onRoster = rows.filter((r) => r.enrollment_status !== 'withdrawn');
    const held = new Set(rows.map((r) => r.index_number));

    // A gap is a number below the highest one in use that NOBODY holds —
    // not an on-roster student, not a student who left. A retired number is
    // held by a withdrawn row and is not a gap.
    const highest = Math.max(...rows.map((r) => r.index_number));
    const gaps: number[] = [];
    for (let n = 1; n <= highest; n++) if (!held.has(n)) gaps.push(n);

    // Out of order: among students who were here from the start, is the
    // stored sequence alphabetical by (last, first, middle)?
    const onTime = onRoster
      .filter(
        (r) =>
          !(
            r.enrollment_date != null &&
            t1Start != null &&
            r.enrollment_date > t1Start
          )
      )
      .map((r) => {
        const s = Array.isArray(r.student) ? r.student[0] : r.student;
        return {
          index: r.index_number,
          last: s?.last_name ?? '',
          first: s?.first_name ?? '',
          middle: s?.middle_name ?? '',
        };
      })
      .sort((a, b) => a.index - b.index);

    // Compare the three name parts in sequence, exactly as the RPC's ORDER BY
    // does. Joining them into one string first is NOT the same comparison —
    // it put "Dela Cruz" pairs on the wrong side of the separator and reported
    // sections out of order that the RPC itself said would not move.
    type N = (typeof onTime)[number];
    const cmp = (a: N, b: N) =>
      a.last.localeCompare(b.last) ||
      a.first.localeCompare(b.first) ||
      a.middle.localeCompare(b.middle);
    let outOfOrder = 0;
    for (let i = 1; i < onTime.length; i++) {
      if (cmp(onTime[i - 1], onTime[i]) > 0) outOfOrder++;
    }

    const { data: prev } = await svc.rpc('generate_section_index_numbers', {
      p_section_id: sec.id,
      p_dry_run: true,
    });
    const moves = (prev as { rows_changed: number } | null)?.rows_changed ?? 0;

    totalGaps += gaps.length;
    totalOutOfOrder += outOfOrder;
    if (gaps.length > 0) gapSections.push(sec.name);
    if (outOfOrder > 0) orderSections.push(sec.name);

    console.log(
      `${sec.name.padEnd(24).slice(0, 24)} ${String(onRoster.length).padStart(6)}  ${(gaps.length > 0 ? gaps.map((g) => `#${g}`).join(',') : '—').padEnd(20)}  ${String(outOfOrder).padStart(12)}  ${String(moves).padStart(14)}`
    );
  }

  console.log(
    `\n  Gaps (a number nobody holds): ${totalGaps} across ${gapSections.length} section(s)`
  );
  if (gapSections.length > 0) console.log(`    ${gapSections.join(', ')}`);
  console.log(
    `  Out-of-order pairs: ${totalOutOfOrder} across ${orderSections.length} section(s)`
  );
  if (orderSections.length > 0) console.log(`    ${orderSections.join(', ')}`);
  console.log(
    '\n  A swap fixes out-of-order. Only Generate closes a gap, and it renumbers\n' +
      '  everyone below the hole to do it.\n'
  );
  console.log(
    '  Trust these columns differently:\n' +
      '    gaps           exact — set arithmetic, nothing to interpret.\n' +
      '    Generate moves exact — read straight out of the RPC dry-run.\n' +
      '    out-of-order   APPROXIMATE. Sorted here with JavaScript\n' +
      '                   localeCompare; the RPC sorts in Postgres under the\n' +
      '                   column collation, and the two disagree on spacing and\n' +
      '                   case (this roster has a surname with a trailing\n' +
      '                   space). Obedience is a live example: 1 pair flagged\n' +
      '                   here, 0 moves reported by the RPC. Where they differ,\n' +
      '                   the RPC is what the button will do.\n'
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
