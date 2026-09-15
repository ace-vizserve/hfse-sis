// scripts/audit-calendar-vs-sources.ts
//
// STRICTLY READ-ONLY. Every statement is a SELECT; the workbooks are opened
// read-only. Safe to point at production, and it writes nothing anywhere.
//
// WHAT IT ANSWERS. Production's school calendar was reverse-engineered from
// finished attendance registers, one ad-hoc importer per term. This reconciles
// HFSE's two real sources — the published calendar ("AY 2026 Calendar.png",
// transcribed in lib/sis/backfill/calendar/published-ay2026.ts) and the
// registers' own masthead calendar blocks — and reports every way the database
// disagrees with them. Nothing is applied; this is the thing to read BEFORE
// deciding what to apply.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-calendar-vs-sources.ts
//
// Exit code is 0 whenever the audit itself ran. Findings are findings, not
// failures.
import { PUBLISHED_AY2026 } from '../lib/sis/backfill/calendar/published-ay2026';
import { extractRegisterCalendar } from '../lib/sis/backfill/calendar/register-legend';
import { reconcile } from '../lib/sis/backfill/calendar/reconcile';
import { audienceFor, datesCovered } from '../lib/sis/backfill/calendar/types';
import { fetchAllPages } from '../lib/supabase/paginate';
import { createServiceClient } from '../lib/supabase/service';

const AY = 'AY2026';

// The registers on disk. `taught` marks a term that has already happened, so
// the register is the record of what occurred and wins a date conflict.
const REGISTERS: {
  file: string;
  termLabel: string;
  year: number;
  taught: boolean;
}[] = [
  {
    file: 'AY2026/T1/T1 Attendance Jan-Mar (1).xlsx',
    termLabel: 'T1',
    year: 2026,
    taught: true,
  },
  {
    file: 'AY2026/T2/T2 Attendance Mar-May (1).xlsx',
    termLabel: 'T2',
    year: 2026,
    taught: true,
  },
  {
    file: 'AY2026/T3/AY2026 Term 3 Attendance (1).xlsx',
    termLabel: 'T3',
    year: 2026,
    taught: true,
  },
];

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};
const h1 = (s: string) =>
  console.log(`\n\n══ ${s} ${'═'.repeat(Math.max(0, 70 - s.length))}`);
const h2 = (s: string) =>
  console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 70 - s.length))}`);

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Folds "date\tkind\tlabel" lines into "date..date  kind  label" runs. */
function collapseRuns(lines: string[]): string[] {
  const parsed = lines
    .map((l) => l.split('\t') as [string, string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const out: string[] = [];
  let i = 0;
  while (i < parsed.length) {
    const [startDate, kind, label] = parsed[i];
    let end = startDate;
    let j = i + 1;
    while (
      j < parsed.length &&
      parsed[j][1] === kind &&
      parsed[j][2] === label &&
      parsed[j][0] === nextDay(end)
    ) {
      end = parsed[j][0];
      j++;
    }
    const range = startDate === end ? startDate : `${startDate}..${end}`;
    out.push(`${range.padEnd(23)} ${kind.padEnd(20)} ${label}`);
    i = j;
  }
  return out;
}

async function main() {
  // ── Sources ──────────────────────────────────────────────────────────────
  const registers = REGISTERS.map((r) => ({
    termLabel: r.termLabel,
    taught: r.taught,
    entries: extractRegisterCalendar(r.file, r.year),
  }));
  console.log(
    `Sources: published calendar (${PUBLISHED_AY2026.length} entries)`
  );
  for (const r of registers) {
    console.log(
      `         register ${r.termLabel} (${r.entries.length} entries)`
    );
  }

  // ── Database ─────────────────────────────────────────────────────────────
  const db = createServiceClient();
  const { data: ays } = await db.from('academic_years').select('id, ay_code');
  const ay = (ays ?? []).find((a) => a.ay_code === AY);
  if (!ay) throw new Error(`${AY} not found`);

  const { data: termRows } = await db
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', ay.id)
    .order('term_number');
  const terms = (termRows ?? []).filter((t) => t.start_date && t.end_date) as {
    id: string;
    term_number: number;
    start_date: string;
    end_date: string;
  }[];
  const termFor = (date: string) =>
    terms.find((t) => date >= t.start_date && date <= t.end_date) ?? null;

  const termIds = terms.map((t) => t.id);
  const { data: dayRows } = await db
    .from('school_calendar')
    .select('term_id, date, day_type, label, audience, hbl_overlay')
    .in('term_id', termIds);
  // `school_calendar` is unique on (term_id, audience, date), so a date can
  // carry up to three rows and a primary/secondary row deliberately overrides
  // the 'all' baseline. Keying the comparison by date alone would keep
  // whichever row arrived last and report "correct"/"wrong kind" off an
  // arbitrary one. The intended state has no audience concept either (the
  // published calendar scopes EVENTS by level, never closures), so compare
  // against the 'all' baseline and report any override separately rather than
  // pretending to have an opinion about it.
  const storedDays = new Map(
    (dayRows ?? [])
      .filter((r) => r.audience === 'all')
      .map((r) => [r.date as string, r])
  );
  const audienceOverrides = (dayRows ?? []).filter((r) => r.audience !== 'all');

  const { data: eventRows } = await db
    .from('calendar_events')
    .select('term_id, start_date, end_date, label, category, audience')
    .in('term_id', termIds);
  const storedEvents = (eventRows ?? []) as {
    start_date: string;
    end_date: string;
    label: string;
    category: string;
    audience: string;
  }[];

  // ── Attendance marks on every date either source calls a closure ─────────
  // The single most important guard before applying anything. Turning a date
  // into a non-encodable closure while marks exist on it does NOT make those
  // marks fall out of the totals: recompute_attendance_rollup counts every
  // dated row with a non-null status and never joins school_calendar, so the
  // marks keep inflating that child's school_days. Clearing them is a separate,
  // deliberate step (an append of status = null per migration 134) followed by
  // a recompute. HBL is the exception — it is encodable, so marks on an HBL
  // day are correct and stay.
  //
  // Counted BEFORE the merge, because the merge uses it: a register masthead
  // claiming a day was closed is overruled by marks recorded on that day.
  const candidateDates = new Set<string>();
  for (const e of PUBLISHED_AY2026) {
    for (const d of datesCovered(e)) candidateDates.add(d);
  }
  for (const r of registers) {
    for (const e of r.entries) {
      for (const d of datesCovered(e)) candidateDates.add(d);
    }
  }
  //
  // `attendance_daily` is an APPEND-ONLY LEDGER. A correction — including a
  // clear — is a NEW row superseding the old one by `recorded_at desc`
  // (migration 134). Counting every row with a non-null status therefore
  // counts dead history: the five P5 Perseverance marks that
  // apply-clear-non-teaching-marks.ts already cleared would still read as five
  // live marks. That matters twice over, because this count is what tells the
  // merge whether a register's "closed" claim is contradicted by real
  // attendance — a phantom mark would reject a legitimate closure.
  //
  // So fold to the latest row per (section_student_id, date) first, exactly as
  // scripts/audit-post-merge-health.ts does, and count only those still
  // holding a status. One ranged query, not one per date.
  const dateList = [...candidateDates].sort();
  const ledger = await fetchAllPages<{
    date: string;
    section_student_id: string;
    status: string | null;
    recorded_at: string;
  }>((from, to) =>
    db
      .from('attendance_daily')
      .select('date, section_student_id, status, recorded_at')
      .in('date', dateList)
      .order('recorded_at', { ascending: true })
      .range(from, to)
  );
  const latest = new Map<string, { date: string; status: string | null }>();
  for (const row of ledger) {
    // Ascending recorded_at, so the last write for a key wins.
    latest.set(`${row.section_student_id}|${row.date}`, {
      date: row.date,
      status: row.status,
    });
  }
  const markCounts = new Map<string, number>();
  for (const { date, status } of latest.values()) {
    if (status === null) continue;
    markCounts.set(date, (markCounts.get(date) ?? 0) + 1);
  }

  const intended = reconcile({
    published: PUBLISHED_AY2026,
    registers,
    datesWithMarks: new Set(markCounts.keys()),
  });

  // ── A. Closures: the attendance gate ─────────────────────────────────────
  h1('A. CLOSURES — what teachers can and cannot mark');
  const markable: string[] = [];
  const wrongType: string[] = [];
  const correct: string[] = [];
  const unplaceable: string[] = [];

  for (const day of intended.days) {
    const term = termFor(day.date);
    const want = `${day.dayType}${day.hblOverlay ? '+hbl' : ''}`;
    if (!term) {
      unplaceable.push(`${day.date}\t${want}\t${day.label}`);
      continue;
    }
    const stored = storedDays.get(day.date);
    const got = stored
      ? `${stored.day_type}${stored.hbl_overlay ? '+hbl' : ''}`
      : '(no row)';
    // Marks only matter when the target day is NOT encodable. HBL is.
    const encodableTarget =
      day.dayType === 'hbl' ||
      (day.dayType === 'school_holiday' && day.hblOverlay);
    const marks = markCounts.get(day.date) ?? 0;
    const warn =
      marks > 0 && !encodableTarget
        ? `  ⚠ ${marks} attendance mark(s) on this date — must be cleared + rollups recomputed`
        : marks > 0
          ? `  (${marks} mark(s), still valid — target day takes attendance)`
          : '';
    const line = `${day.date} ${dow(day.date)} T${term.term_number}  stored=${got.padEnd(20)} want=${want.padEnd(20)} ${day.label}${warn}`;
    if (got === want) correct.push(line);
    else if (!stored || stored.day_type === 'school_day') markable.push(line);
    else wrongType.push(line);
  }

  h2(`🔴 ${markable.length} closure(s) teachers can still mark attendance on`);
  markable.forEach((l) => console.log('  ' + l));
  h2(`⚠ ${wrongType.length} closure(s) stored as the wrong kind of day`);
  wrongType.forEach((l) => console.log('  ' + l));
  h2(`✓ ${correct.length} closure(s) already correct`);
  h2(
    `${unplaceable.length} closure(s) fall outside every term window — nowhere to store them`
  );
  // Collapse consecutive same-kind, same-label days (the five-week yearend
  // block would otherwise be 38 near-identical lines).
  for (const run of collapseRuns(unplaceable)) console.log('  ' + run);

  h2(
    `${audienceOverrides.length} stored day row(s) carry a primary/secondary override`
  );
  audienceOverrides.forEach((r) =>
    console.log(
      `  ${r.date} ${dow(r.date as string)}  aud=${String(r.audience).padEnd(9)} ${String(r.day_type).padEnd(15)} ${r.label ?? '(no label)'}`
    )
  );

  // Stored closures no source accounts for. These are mostly the register
  // import's blank-column artefact (a weekend with no marks became no_class).
  h2('Stored closures that neither source mentions');
  const intendedDates = new Set(intended.days.map((d) => d.date));
  const orphans = (dayRows ?? []).filter(
    (r) => r.day_type !== 'school_day' && !intendedDates.has(r.date as string)
  );
  const weekend = orphans.filter((r) =>
    ['Sat', 'Sun'].includes(dow(r.date as string))
  );
  console.log(
    `  ${orphans.length} row(s): ${weekend.length} on a weekend (harmless — a blank column the importer called no_class), ${orphans.length - weekend.length} on a weekday`
  );
  orphans
    .filter((r) => !['Sat', 'Sun'].includes(dow(r.date as string)))
    .forEach((r) =>
      console.log(
        `  ${r.date} ${dow(r.date as string)}  ${String(r.day_type).padEnd(15)} ${r.label ?? '(no label)'}`
      )
    );

  // ── B. Events ────────────────────────────────────────────────────────────
  h1('B. EVENTS — the labels on the calendar');
  const missingEvents: string[] = [];
  const presentEvents: string[] = [];
  const outsideTerms: string[] = [];

  const sameish = (a: string, b: string) => {
    const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return n(a) === n(b) || n(a).includes(n(b)) || n(b).includes(n(a));
  };

  for (const ev of intended.events) {
    const term = termFor(ev.startDate);
    const range =
      ev.startDate === ev.endDate
        ? ev.startDate
        : `${ev.startDate}..${ev.endDate}`;
    const scope = ev.levels ? ev.levels.join(',') : 'whole school';
    const line = `${range.padEnd(23)} ${ev.category.padEnd(17)} ${scope.padEnd(24)} ${ev.label}`;
    if (!term) {
      outsideTerms.push(line);
      continue;
    }
    const hit = storedEvents.find(
      (s) =>
        s.start_date <= ev.endDate &&
        s.end_date >= ev.startDate &&
        sameish(s.label, ev.label)
    );
    if (hit) presentEvents.push(line);
    else missingEvents.push(line);
  }

  h2(`🔴 ${missingEvents.length} event(s) missing from the database`);
  missingEvents.forEach((l) => console.log('  ' + l));
  h2(`✓ ${presentEvents.length} event(s) already stored`);
  h2(
    `${outsideTerms.length} event(s) fall outside every term window — nowhere to store them`
  );
  outsideTerms.forEach((l) => console.log('  ' + l));

  h2('Stored events that neither source mentions');
  for (const s of storedEvents) {
    const matched = intended.events.some(
      (ev) =>
        ev.startDate <= s.end_date &&
        ev.endDate >= s.start_date &&
        sameish(ev.label, s.label)
    );
    if (!matched) {
      console.log(
        `  ${s.start_date}..${s.end_date} ${String(s.category).padEnd(17)} aud=${String(s.audience).padEnd(9)} ${s.label}`
      );
    }
  }

  // ── C. Level scope ───────────────────────────────────────────────────────
  h1('C. LEVEL SCOPE — what the schema cannot hold yet');
  const scoped = intended.events.filter((e) => e.levels !== null);
  console.log(
    `${scoped.length} of ${intended.events.length} events name specific levels.`
  );
  console.log(
    'The schema stores audience all/primary/secondary only, so these degrade:'
  );
  let degraded = 0;
  for (const ev of scoped) {
    const aud = audienceFor(ev.levels);
    const exact =
      (aud === 'primary' && ev.levels!.length === 6) ||
      (aud === 'secondary' && ev.levels!.length === 4);
    if (exact) continue;
    degraded++;
    const range =
      ev.startDate === ev.endDate
        ? ev.startDate
        : `${ev.startDate}..${ev.endDate}`;
    console.log(
      `  ${range.padEnd(23)} ${ev.levels!.join(',').padEnd(24)} → stored as '${aud}'   ${ev.label}`
    );
  }
  console.log(
    `\n→ ${degraded} event(s) lose real scope on the way in. That is the case for the level field.`
  );

  // ── D. Conflicts + unresolved ────────────────────────────────────────────
  h1('D. SOURCE CONFLICTS — a human decides these');
  if (intended.conflicts.length === 0) console.log('  none');
  for (const c of intended.conflicts) {
    console.log(
      `  ${c.date} ${dow(c.date)}  ${c.what}\n      published: ${c.published}\n      register:  ${c.register}\n      → ${c.resolution}`
    );
  }

  h2(
    `${intended.uncategorised.length} register entr(ies) with no category and no published match`
  );
  // Show what the published calendar has on those dates. The merge will not
  // guess across wordings this far apart ("Secondary T1 Exams" against
  // "Secondary School Term 1 Exam"), and loosening it risks a long span
  // swallowing genuinely different events — so the decision is surfaced with
  // the context needed to make it in one glance.
  for (const u of intended.uncategorised) {
    const on = u.date.slice(0, 10);
    const near = intended.events.filter(
      (e) => e.startDate <= on && e.endDate >= on
    );
    console.log(`  ${u.date.padEnd(23)} [${u.termLabel}] ${u.label}`);
    for (const n of near) {
      console.log(
        `      ↳ published on these dates: ${n.startDate}..${n.endDate} ${n.category} "${n.label}"`
      );
    }
    if (near.length === 0) {
      console.log('      ↳ nothing published on this date');
    }
  }

  // ── E. Summary ───────────────────────────────────────────────────────────
  h1('E. SUMMARY');
  const t4 = terms.find((t) => t.term_number === 4);
  if (t4) {
    const t4Days = (dayRows ?? []).filter((r) => r.term_id === t4.id);
    const t4Closures = t4Days.filter((r) => r.day_type !== 'school_day').length;
    const t4Events = storedEvents.length
      ? (eventRows ?? []).filter((r) => r.term_id === t4.id).length
      : 0;
    const t4Intended = intended.days.filter((d) => {
      const t = termFor(d.date);
      return t?.term_number === 4;
    }).length;
    const t4IntendedEvents = intended.events.filter((e) => {
      const t = termFor(e.startDate);
      return t?.term_number === 4;
    }).length;
    console.log(
      `T4 (${t4.start_date} .. ${t4.end_date}, live now): ${t4Days.length} rows stored, ${t4Closures} closures, ${t4Events} events.`
    );
    console.log(
      `T4 per the sources: ${t4Intended} closures, ${t4IntendedEvents} events.`
    );
  }
  console.log(
    `\nClosures:  ${markable.length} markable that should not be, ${wrongType.length} wrong kind, ${correct.length} correct.`
  );
  console.log(
    `Events:    ${missingEvents.length} missing, ${presentEvents.length} stored.`
  );
  console.log(
    `Conflicts: ${intended.conflicts.length} to decide, ${intended.uncategorised.length} register entries to categorise.`
  );
  console.log(
    `Unstorable: ${unplaceable.length} closures + ${outsideTerms.length} events fall outside every term window.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
