// scripts/backfill/verify-index-swap-and-preview.ts
//
// Verifies migration 147 against the live database. The SQL in that migration
// could not be executed while it was being written, so everything below is a
// claim the file makes that nothing had yet checked:
//
//   1. PostgREST resolves `generate_section_index_numbers` with ONLY
//      p_section_id, now that the 1-arg signature is dropped and the 2-arg one
//      carries `p_dry_run boolean default false`. If this is wrong, every
//      existing caller of Generate breaks.
//   2. p_dry_run = true genuinely writes nothing.
//   3. The preview is coherent: numbers unique, withdrawn numbers never
//      handed out, and rows_changed equal to the rows that actually differ.
//   4. `swap_section_index_numbers` exchanges two numbers and is its own
//      inverse — this exercises the negative-index staging and the
//      SELECT ... FOR UPDATE path that no unit test can reach.
//   5. Neither function is callable with the anon key (migrations 103/104
//      exist because a `security definer` function left at Supabase's default
//      grants is reachable by any parent holding a JWT).
//
// WRITES: only checks 1 and 4 write, and both restore the exact prior state —
// (1) runs the real renumber ONLY on a section the dry-run just proved is a
// no-op, and (4) swaps a pair and swaps it straight back, on AY9999 and never
// on a real year. Everything else is read-only.
//
// ⚠ AS OF 2026-09-14 CHECK 4 DOES NOT RUN: AY9999 no longer exists, so there
// is no write-safe year and the swap round-trip skips. `swap_section_index_
// numbers` therefore has unit tests behind it but has never been executed
// against a database — the negative-index staging and the SELECT ... FOR UPDATE
// path are unproven. Closing that needs either a restored test year or explicit
// approval to swap-and-swap-back one pair on a real section (the function is a
// single transaction and swapping twice is the identity, so it self-restores).
// Do not quietly point this at a real year to make the check pass.
//
// Run: npx tsx --env-file=.env.local scripts/backfill/verify-index-swap-and-preview.ts
import { createClient } from '@supabase/supabase-js';

import { createServiceClient } from '../../lib/supabase/service';

const PROD_AY = 'AY2026';
const TEST_AY = 'AY9999';

type IndexRow = { id: string; index_number: number; enrollment_status: string };
type PreviewResult = {
  rows_renumbered: number;
  rows_changed: number;
  dry_run: boolean;
  before: Array<{ id: string; old_index: number | null; name: string }>;
  after: Array<{
    id: string;
    old_index: number | null;
    new_index: number;
    name: string;
  }>;
};

let failures = 0;
function check(ok: boolean, label: string, detail = '') {
  if (ok) {
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function rosterOf(
  svc: ReturnType<typeof createServiceClient>,
  sectionId: string
): Promise<IndexRow[]> {
  const { data } = await svc
    .from('section_students')
    .select('id, index_number, enrollment_status')
    .eq('section_id', sectionId)
    .order('index_number');
  return (data ?? []) as IndexRow[];
}

/** Stable "id:index" fingerprint, so a comparison is order-independent. */
function fingerprint(rows: IndexRow[]): string {
  return [...rows]
    .map((r) => `${r.id}:${r.index_number}`)
    .sort()
    .join('|');
}

async function sectionsForAy(
  svc: ReturnType<typeof createServiceClient>,
  ayCode: string
): Promise<Array<{ id: string; name: string }>> {
  const { data: ay } = await svc
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ay) return [];
  const { data } = await svc
    .from('sections')
    .select('id, name')
    .eq('academic_year_id', (ay as { id: string }).id)
    .order('name');
  return (data ?? []) as Array<{ id: string; name: string }>;
}

async function main() {
  const svc = createServiceClient();

  // ── 1 + 2 + 3. Preview on real sections ───────────────────────────────────
  console.log(`\n[1] Preview (p_dry_run) across ${PROD_AY}`);
  const prodSections = await sectionsForAy(svc, PROD_AY);
  if (prodSections.length === 0) {
    console.log(`  SKIP  no sections found for ${PROD_AY}`);
  }

  let noOpSection: { id: string; name: string } | null = null;
  let previewed = 0;

  for (const section of prodSections) {
    const before = await rosterOf(svc, section.id);
    const beforePrint = fingerprint(before);

    const { data, error } = await svc.rpc('generate_section_index_numbers', {
      p_section_id: section.id,
      p_dry_run: true,
    });
    if (error) {
      check(false, `${section.name}: preview call`, error.message);
      continue;
    }
    previewed++;
    const result = data as PreviewResult;

    // The new fields exist and the flag came back honoured.
    if (previewed === 1) {
      check(
        typeof result.rows_changed === 'number' && result.dry_run === true,
        'RPC returns rows_changed + dry_run',
        `rows_changed=${result.rows_changed}`
      );
    }

    // Wrote nothing.
    const after = await rosterOf(svc, section.id);
    if (fingerprint(after) !== beforePrint) {
      check(false, `${section.name}: dry-run wrote to the roster`);
      continue;
    }

    // Numbers are unique.
    const assigned = result.after.map((r) => r.new_index);
    const unique = new Set(assigned).size === assigned.length;

    // Withdrawn numbers are never handed out.
    const burned = new Set(
      before
        .filter((r) => r.enrollment_status === 'withdrawn')
        .map((r) => r.index_number)
    );
    const reusedBurned = assigned.filter((n) => burned.has(n));

    // rows_changed matches the rows that actually differ.
    const differing = result.after.filter(
      (r) => r.old_index !== r.new_index
    ).length;

    const ok =
      unique && reusedBurned.length === 0 && differing === result.rows_changed;
    if (!ok) {
      check(
        false,
        `${section.name}: preview coherent`,
        `unique=${unique} reusedBurned=[${reusedBurned.join(',')}] differing=${differing} rows_changed=${result.rows_changed}`
      );
    }

    if (result.rows_changed === 0 && !noOpSection) noOpSection = section;
    if (result.rows_changed > 0) {
      console.log(
        `  note  ${section.name}: ${result.rows_changed} of ${result.rows_renumbered} would move`
      );
    }
  }

  check(
    previewed === prodSections.length,
    `previewed every ${PROD_AY} section`,
    `${previewed}/${prodSections.length}`
  );

  // ── 4. One-argument call still resolves ───────────────────────────────────
  // Proves PostgREST picks the 2-arg function when p_dry_run is omitted — the
  // thing that breaks every existing Generate caller if the default is wrong.
  // Run ONLY against a section the dry-run above proved is already correct, so
  // the "write" rewrites the identical values.
  console.log('\n[2] One-argument call (the shape every existing caller uses)');
  if (!noOpSection) {
    console.log(
      '  SKIP  no already-correct section available to test against safely'
    );
  } else {
    const before = fingerprint(await rosterOf(svc, noOpSection.id));
    const { data, error } = await svc.rpc('generate_section_index_numbers', {
      p_section_id: noOpSection.id,
    });
    if (error) {
      check(false, 'p_section_id alone resolves', error.message);
    } else {
      const result = data as PreviewResult;
      const after = fingerprint(await rosterOf(svc, noOpSection.id));
      check(
        result.dry_run === false,
        'p_section_id alone resolves and defaults p_dry_run to false',
        `${noOpSection.name}, rows_changed=${result.rows_changed}`
      );
      check(after === before, 'the no-op run left the roster identical');
    }
  }

  // ── 5. Swap round-trip, on the test year only ─────────────────────────────
  console.log(`\n[3] Swap round-trip (${TEST_AY} only)`);
  const testSections = await sectionsForAy(svc, TEST_AY);
  let swapTarget: {
    section: { id: string; name: string };
    a: IndexRow;
    b: IndexRow;
  } | null = null;
  for (const section of testSections) {
    const roster = (await rosterOf(svc, section.id)).filter(
      (r) => r.enrollment_status !== 'withdrawn'
    );
    if (roster.length >= 2) {
      swapTarget = { section, a: roster[0], b: roster[1] };
      break;
    }
  }

  if (!swapTarget) {
    console.log(
      `  SKIP  no ${TEST_AY} section with two students on the roster — swap left unexercised`
    );
  } else {
    const { section, a, b } = swapTarget;
    const before = fingerprint(await rosterOf(svc, section.id));

    const { data, error } = await svc.rpc('swap_section_index_numbers', {
      p_section_id: section.id,
      p_enrolment_a: a.id,
      p_enrolment_b: b.id,
    });
    if (error) {
      check(false, 'swap executes', error.message);
    } else {
      const res = data as {
        a: { old_index: number; new_index: number };
        b: { old_index: number; new_index: number };
      };
      check(
        res.a.new_index === b.index_number &&
          res.b.new_index === a.index_number,
        'swap returns the exchanged numbers',
        `#${a.index_number} <-> #${b.index_number} in ${section.name}`
      );

      const mid = await rosterOf(svc, section.id);
      const newA = mid.find((r) => r.id === a.id)?.index_number;
      const newB = mid.find((r) => r.id === b.id)?.index_number;
      check(
        newA === b.index_number && newB === a.index_number,
        'the roster really holds the exchanged numbers'
      );

      // Swapping the same pair again must restore the original state exactly.
      const { error: backErr } = await svc.rpc('swap_section_index_numbers', {
        p_section_id: section.id,
        p_enrolment_a: a.id,
        p_enrolment_b: b.id,
      });
      if (backErr) {
        check(false, 'swap back', backErr.message);
      } else {
        const after = fingerprint(await rosterOf(svc, section.id));
        check(after === before, 'swapping twice restored the roster exactly');
      }
    }

    // A withdrawn student's number is retired — the RPC must refuse, not just
    // the route. Only checked when the test year actually has one.
    const withdrawn = (await rosterOf(svc, section.id)).find(
      (r) => r.enrollment_status === 'withdrawn'
    );
    if (withdrawn) {
      const { error: wErr } = await svc.rpc('swap_section_index_numbers', {
        p_section_id: section.id,
        p_enrolment_a: a.id,
        p_enrolment_b: withdrawn.id,
      });
      check(
        !!wErr,
        'refuses to swap with a student who has left',
        wErr ? `rejected (${wErr.code})` : 'IT ALLOWED IT'
      );
    } else {
      console.log('  SKIP  no withdrawn row in that section to test against');
    }

    // Same student twice.
    const { error: sameErr } = await svc.rpc('swap_section_index_numbers', {
      p_section_id: section.id,
      p_enrolment_a: a.id,
      p_enrolment_b: a.id,
    });
    check(
      !!sameErr,
      'refuses the same student twice',
      sameErr ? `rejected (${sameErr.code})` : 'IT ALLOWED IT'
    );
  }

  // ── 6. Anon lockdown ──────────────────────────────────────────────────────
  // Migrations 103/104 exist because these grants silently did not apply the
  // first time. `authenticated` includes parents in this system.
  console.log('\n[4] Anon key must be refused');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.log(
      '  SKIP  NEXT_PUBLIC_SUPABASE_ANON_KEY not set in this environment'
    );
  } else {
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const probeSection = prodSections[0]?.id ?? testSections[0]?.id;

    // Must be refused by PRIVILEGE, not by the function's own validation.
    // "some error came back" is not good enough: if the grants failed the body
    // would run and raise 22023 from its own guards, which would read as a pass
    // while an anonymous caller was in fact executing the function.
    //   42501   = insufficient_privilege (the expected refusal)
    //   PGRST202 = not exposed to this role at all (also fine)
    const refusedForPrivilege = (code: string | undefined) =>
      code === '42501' || code === 'PGRST202';

    const { error: genErr } = await anon.rpc('generate_section_index_numbers', {
      p_section_id: probeSection,
      p_dry_run: true,
    });
    check(
      refusedForPrivilege(genErr?.code),
      'anon cannot call generate_section_index_numbers',
      genErr
        ? `refused (${genErr.code})`
        : 'IT RAN — grants did not apply (see migrations 103/104)'
    );

    const { error: swapErr } = await anon.rpc('swap_section_index_numbers', {
      p_section_id: probeSection,
      p_enrolment_a: probeSection,
      p_enrolment_b: probeSection,
    });
    check(
      refusedForPrivilege(swapErr?.code),
      'anon cannot call swap_section_index_numbers',
      swapErr
        ? `refused (${swapErr.code})`
        : 'IT RAN — grants did not apply (see migrations 103/104)'
    );
  }

  console.log(
    failures === 0
      ? '\nAll checks passed.\n'
      : `\n${failures} check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
