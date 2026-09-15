// scripts/probe-calendar-event-scope.ts
//
// STRICTLY READ-ONLY. Every statement is a SELECT. Safe against production.
//
// Question: calendar entries carry `audience IN ('all','primary','secondary')`
// and nothing finer. Mr Ace reports seeing e.g. "P6 Fieldtrip" stored as
// whole-school. This measures how often a stored row's LABEL names a level (or
// a section) that its AUDIENCE does not actually restrict it to — before any
// schema change is proposed.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-calendar-event-scope.ts
import { createServiceClient } from '../lib/supabase/service';

const h1 = (s: string) =>
  console.log(`\n══ ${s} ${'═'.repeat(Math.max(0, 66 - s.length))}`);

// Level mentions in free-text labels. Word-boundary-ish so "P6" matches but
// "SPORTS" does not, and the word forms ("Primary Six") match too.
const LEVEL_PATTERNS: {
  code: string;
  type: 'primary' | 'secondary';
  re: RegExp;
}[] = [
  ['P1', 'primary', 'Primary One'],
  ['P2', 'primary', 'Primary Two'],
  ['P3', 'primary', 'Primary Three'],
  ['P4', 'primary', 'Primary Four'],
  ['P5', 'primary', 'Primary Five'],
  ['P6', 'primary', 'Primary Six'],
  ['S1', 'secondary', 'Secondary One'],
  ['S2', 'secondary', 'Secondary Two'],
  ['S3', 'secondary', 'Secondary Three'],
  ['S4', 'secondary', 'Secondary Four'],
].map(([code, type, word]) => ({
  code: code as string,
  type: type as 'primary' | 'secondary',
  re: new RegExp(`(^|[^A-Za-z0-9])(${code}|${word})([^A-Za-z0-9]|$)`, 'i'),
}));

const GROUP_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'primary-wide', re: /(^|[^a-z])primary([^a-z]|$)/i },
  { name: 'secondary-wide', re: /(^|[^a-z])secondary([^a-z]|$)/i },
];

function levelsIn(label: string): string[] {
  return LEVEL_PATTERNS.filter((p) => p.re.test(label)).map((p) => p.code);
}

async function main() {
  const db = createServiceClient();

  const { data: ays, error: ayErr } = await db
    .from('academic_years')
    .select('id, ay_code, is_current')
    .order('ay_code');
  if (ayErr) throw new Error(ayErr.message);

  const { data: terms, error: tErr } = await db
    .from('terms')
    .select('id, label, term_number, academic_year_id');
  if (tErr) throw new Error(tErr.message);
  const termById = new Map((terms ?? []).map((t) => [t.id as string, t]));
  const ayById = new Map((ays ?? []).map((a) => [a.id as string, a]));
  const aySlugForTerm = (termId: string) => {
    const t = termById.get(termId);
    return t ? (ayById.get(t.academic_year_id as string)?.ay_code ?? '?') : '?';
  };

  // ── calendar_events ───────────────────────────────────────────────────────
  const { data: events, error: eErr } = await db
    .from('calendar_events')
    .select(
      'id, term_id, start_date, end_date, label, category, audience, tentative'
    )
    .order('start_date');
  if (eErr) throw new Error(eErr.message);
  const ev = events ?? [];

  h1(`calendar_events — ${ev.length} rows total`);
  const byAudience: Record<string, number> = {};
  for (const e of ev)
    byAudience[e.audience as string] =
      (byAudience[e.audience as string] ?? 0) + 1;
  console.log('audience distribution:', byAudience);

  const byAy: Record<string, number> = {};
  for (const e of ev) {
    const s = aySlugForTerm(e.term_id as string);
    byAy[s] = (byAy[s] ?? 0) + 1;
  }
  console.log('by academic year:', byAy);

  h1('Events whose LABEL names a level');
  let mismatched = 0;
  let consistentButCoarse = 0;
  for (const e of ev) {
    const label = String(e.label ?? '');
    const lv = levelsIn(label);
    if (lv.length === 0) continue;
    const types = new Set(
      LEVEL_PATTERNS.filter((p) => lv.includes(p.code)).map((p) => p.type)
    );
    const aud = e.audience as string;
    const impliedAudience = types.size === 1 ? [...types][0] : 'all';
    const wrong = aud === 'all' && impliedAudience !== 'all';
    if (wrong) mismatched++;
    else consistentButCoarse++;
    console.log(
      `${wrong ? '✗' : '·'} [${aySlugForTerm(e.term_id as string)}] ${String(e.start_date)}..${String(e.end_date)}  audience=${aud.padEnd(9)} cat=${String(e.category).padEnd(16)} levels=${lv.join(',').padEnd(12)} "${label}"`
    );
  }
  console.log(
    `\n→ ${mismatched} event(s) name a specific level but are stored whole-school.` +
      `\n→ ${consistentButCoarse} event(s) name a level AND carry a level-type audience` +
      ` (still coarse: it reaches every level of that type).`
  );

  h1('Events whose label names a whole band (Primary / Secondary)');
  for (const e of ev) {
    const label = String(e.label ?? '');
    const hits = GROUP_PATTERNS.filter((g) => g.re.test(label)).map(
      (g) => g.name
    );
    if (hits.length === 0) continue;
    console.log(
      `· [${aySlugForTerm(e.term_id as string)}] audience=${String(e.audience).padEnd(9)} ${hits.join('+')} "${label}"`
    );
  }

  // ── school_calendar day overrides ────────────────────────────────────────
  const { data: days, error: dErr } = await db
    .from('school_calendar')
    .select('term_id, date, day_type, label, audience')
    .not('label', 'is', null);
  if (dErr) throw new Error(dErr.message);
  const dd = days ?? [];
  h1(`school_calendar — ${dd.length} labelled rows`);
  const dayAud: Record<string, number> = {};
  for (const d of dd)
    dayAud[d.audience as string] = (dayAud[d.audience as string] ?? 0) + 1;
  console.log('audience distribution (labelled rows):', dayAud);
  let dayMismatch = 0;
  for (const d of dd) {
    const lv = levelsIn(String(d.label ?? ''));
    if (lv.length === 0) continue;
    const types = new Set(
      LEVEL_PATTERNS.filter((p) => lv.includes(p.code)).map((p) => p.type)
    );
    const wrong = d.audience === 'all' && types.size === 1;
    if (wrong) dayMismatch++;
    console.log(
      `${wrong ? '✗' : '·'} [${aySlugForTerm(d.term_id as string)}] ${String(d.date)} audience=${String(d.audience).padEnd(9)} ${String(d.day_type).padEnd(15)} levels=${lv.join(',').padEnd(10)} "${d.label}"`
    );
  }
  console.log(
    `\n→ ${dayMismatch} labelled DAY row(s) name a level but are stored whole-school.`
  );

  // ── how many sections would a level-scoped event reach? ──────────────────
  const { data: secs, error: sErr } = await db
    .from('sections')
    .select('id, name, level_id, academic_year_id, levels(code)')
    .order('name');
  if (sErr) throw new Error(sErr.message);
  h1('Section fan-out (why level-type scoping is coarse)');
  const perAy: Record<string, Record<string, number>> = {};
  for (const s of secs ?? []) {
    const slug = ayById.get(s.academic_year_id as string)?.ay_code ?? '?';
    const code = (s as { levels?: { code?: string } }).levels?.code ?? '?';
    perAy[slug] ??= {};
    perAy[slug][code] = (perAy[slug][code] ?? 0) + 1;
  }
  for (const [slug, counts] of Object.entries(perAy)) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`${slug}: ${total} sections — ${JSON.stringify(counts)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
