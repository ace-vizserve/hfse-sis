// scripts/backfill/remove-wrong-admission-sessions.ts
// Undoes the 2026-09-28 backfill that gave every enrolment-form option all
// three sessions.
//
// WHY. That backfill read "whole day is a separate option" as "any level may
// have Whole Day" and added the missing sessions, closed: Whole Day to every
// primary / YoungStarter / IEP Year 1–2 option, Morning + Afternoon to every
// secondary / IEP Year 8–10 option — 82 rows, 41 per AY. The portal's
// `src/lib/schedule-rules.ts` (re-checked with Mr Ace the same day) says
// Whole Day is SECONDARY ONLY and Morning / Afternoon primary only, so those
// rows are switches for sessions no level has. They were never open, so no
// parent was ever offered one.
//
// Matches exactly the rows that backfill wrote: closed, created on
// 2026-09-28, in an option that already had rows before that day, whose
// session is from the OTHER group than those older rows (Whole Day beside
// Morning/Afternoon, or Morning/Afternoon beside Whole Day). Refuses to write
// unless that is exactly 82 rows, all closed.
//
// ⚠ RUNS AS THE SERVICE ROLE, so NO `audit_log` ROW is written. This header is
// the record.
//
// Run:  npx tsx --env-file=.env.local scripts/backfill/remove-wrong-admission-sessions.ts
//       ... --apply   to delete
import { createServiceClient } from '../../lib/supabase/service';

const APPLY = process.argv.includes('--apply');
const BACKFILL_DAY = '2026-09-28';
const EXPECTED = 82;

type Row = {
  id: string;
  academic_year_id: string;
  level_label: string;
  class_type_label: string;
  schedule: 'morning' | 'afternoon' | 'whole_day';
  is_open: boolean;
  created_at: string;
  academic_year: { ay_code: string } | null;
};

const group = (s: Row['schedule']) => (s === 'whole_day' ? 'wd' : 'ma');

async function main() {
  const svc = createServiceClient();
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}\n`);

  const { data, error } = await svc
    .from('admission_options')
    .select(
      'id, academic_year_id, level_label, class_type_label, schedule, is_open, created_at, academic_year:academic_years(ay_code)'
    );
  if (error) throw error;
  const rows = (data ?? []) as unknown as Row[];

  const combos = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.academic_year_id}\u0000${r.level_label}\u0000${r.class_type_label}`;
    (combos.get(key) ?? combos.set(key, []).get(key)!).push(r);
  }

  const doomed: Row[] = [];
  for (const g of combos.values()) {
    const older = g.filter((r) => r.created_at.slice(0, 10) < BACKFILL_DAY);
    if (older.length === 0) continue;
    const olderGroups = new Set(older.map((r) => group(r.schedule)));
    if (olderGroups.size !== 1) continue;
    const [kept] = [...olderGroups];
    for (const r of g) {
      if (
        r.created_at.slice(0, 10) === BACKFILL_DAY &&
        group(r.schedule) !== kept
      ) {
        doomed.push(r);
      }
    }
  }

  for (const r of doomed) {
    console.log(
      `  - ${r.academic_year?.ay_code} | ${r.level_label} | ${r.class_type_label} | ${r.schedule}${r.is_open ? '  ⚠ OPEN' : ''}`
    );
  }
  const open = doomed.filter((r) => r.is_open).length;
  console.log(`\n${doomed.length} row(s) matched (${open} open).`);

  if (doomed.length !== EXPECTED || open > 0) {
    console.log(
      `Refusing: expected exactly ${EXPECTED} closed rows. Someone may have switched one on or changed the table — check before deleting.`
    );
    process.exit(1);
  }
  if (!APPLY) return;

  const { error: delErr } = await svc
    .from('admission_options')
    .delete()
    .in(
      'id',
      doomed.map((r) => r.id)
    )
    .eq('is_open', false);
  if (delErr) throw delErr;
  console.log('Deleted.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
