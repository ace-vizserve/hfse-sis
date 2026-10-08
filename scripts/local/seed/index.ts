// LOCAL seeder — wipes the local stack's people data and rebuilds a fake,
// production-shaped dataset on top of the real setup data copied from
// production (`npm run local:refresh`).
// Plan: docs/superpowers/plans/2026-10-07-local-seeder.md
//
//   npm run local:seed                    # every phase, in order
//   npm run local:seed -- --only staff    # one phase (after a wipe, for staff)
//   npm run local:seed -- --list          # phase names
//
// The npm script starts Node with `--conditions=react-server` and
// `--import ./scripts/local/seed/harness/register.mjs` so the app's own
// lib/** writers (`import 'server-only'`, `next/cache`) run unmodified — see
// harness/register.mjs.
//
// Refuses anything but a 127.0.0.1 / localhost Supabase URL on the [api] port
// of supabase/config.toml, whose project_id also names the SQL container.

import { TODAY, runDateSg } from './lib/constants';
import { assertLocal } from './lib/local';
import { runAttendance } from './phases/attendance';
import { runClassroomNotes } from './phases/classroom-notes';
import { runDeclarations } from './phases/declarations';
import { runDiscipline } from './phases/discipline';
import { runEvaluation } from './phases/evaluation';
import { runHousePoints } from './phases/house-points';
import { runMarkbook } from './phases/markbook';
import { runPeople } from './phases/people';
import { runPfiles } from './phases/pfiles';
import { runPortalDrafts } from './phases/portal-drafts';
import { runPublication } from './phases/publication';
import { runStaff } from './phases/staff';
import { runTeachers } from './phases/teachers';
import { runVerify } from './phases/verify';
import { runWipe } from './phases/wipe';

type Phase = { name: string; plan: number; run: () => Promise<unknown> };

// Order matters: each phase builds on the ones before it.
const PHASES: Phase[] = [
  { name: 'wipe', plan: 0, run: runWipe },
  { name: 'staff', plan: 0, run: runStaff },
  { name: 'people', plan: 1, run: runPeople },
  { name: 'teachers', plan: 2, run: runTeachers },
  { name: 'markbook', plan: 3, run: runMarkbook },
  { name: 'attendance', plan: 4, run: runAttendance },
  { name: 'evaluation', plan: 5, run: runEvaluation },
  // After evaluation: the publish gate needs the adviser comments for Terms
  // 1..3 (see phases/publication.ts).
  { name: 'publication', plan: 3, run: runPublication },
  // Plan phase 6, one phase per feature (each only adds rows, idempotent on
  // its own — `--only <name>` after a pull). Declarations come after the
  // registers they re-mark.
  { name: 'declarations', plan: 6, run: runDeclarations },
  { name: 'discipline', plan: 6, run: runDiscipline },
  { name: 'classroom-notes', plan: 6, run: runClassroomNotes },
  // Plan phase 7, one phase per feature again. Discount codes and the AY2027
  // funnel are written by `people`; `verify` checks them.
  { name: 'pfiles', plan: 7, run: runPfiles },
  { name: 'house-points', plan: 7, run: runHousePoints },
  { name: 'portal-drafts', plan: 7, run: runPortalDrafts },
  { name: 'verify', plan: 0, run: runVerify },
];

function parseArgs(argv: string[]): { only: string | null; list: boolean } {
  let only: string | null = null;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') list = true;
    else if (a === '--only') only = argv[++i] ?? null;
    else if (a.startsWith('--only=')) only = a.slice('--only='.length);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (only !== null && !PHASES.some((p) => p.name === only)) {
    throw new Error(
      `Unknown phase "${only}". Phases: ${PHASES.map((p) => p.name).join(', ')}`
    );
  }
  return { only, list };
}

async function main(): Promise<void> {
  const { only, list } = parseArgs(process.argv.slice(2));
  if (list) {
    for (const p of PHASES) console.log(`${p.name} (plan phase ${p.plan})`);
    return;
  }

  // harness/register.mjs empties RESEND_API_KEY before anything loads; refuse
  // to run if the runner was started without it.
  if (process.env.RESEND_API_KEY) {
    throw new Error(
      'RESEND_API_KEY is set — start the seeder through `npm run local:seed` (the harness empties it).'
    );
  }

  // The run-date-relative data (live covers, registers, promises, drafts —
  // lib/constants.ts) assumes the real date is on or after TODAY. A clock
  // behind it would date "today's" registers and covers before the year the
  // fake data describes.
  const runDate = runDateSg();
  if (runDate < TODAY) {
    throw new Error(
      `Refusing to seed: this computer's date (${runDate}, Singapore) is before the seeder's anchor date ${TODAY}. Check the system clock and time zone, then run again.`
    );
  }

  const { url } = assertLocal();
  console.log(`Local seeder → ${url} (run date ${runDate})`);

  const started = Date.now();
  for (const p of PHASES) {
    if (only && p.name !== only) continue;
    const t = Date.now();
    console.log(`▸ ${p.name}`);
    await p.run();
    console.log(`  (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
