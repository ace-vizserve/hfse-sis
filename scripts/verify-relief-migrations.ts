// scripts/verify-relief-migrations.ts
//
// Checks that migrations 117 and 118 actually landed, against a live database.
//
// STRICTLY READ-ONLY. Every statement below is a SELECT; nothing is written,
// so it is safe to point at production.
//
// WHAT THIS CANNOT TELL YOU. It reads with the SERVICE client, which bypasses
// row-level security entirely. So it proves the SHAPE of the database is right
// and says nothing about whether a teacher signing in can read their own
// assignments. That distinction is not academic: migration 116 exists because
// 114 broke exactly that, and the symptom was a blank Teachers tab for
// teachers while this kind of service-role read went on reporting the same
// rows correctly. Two screens disagreeing about whether a teacher exists.
// A green run here still needs a browser pass as a teacher.
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-relief-migrations.ts
//
// Exit code 0 when everything checks out, 1 when it does not.
import { createServiceClient } from '../lib/supabase/service';

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) =>
  checks.push({ name, ok, detail });

async function main() {
  const service = createServiceClient();

  // ── 117 · the column exists ───────────────────────────────────────────────
  const col = await service
    .from('teacher_assignments')
    .select('id, relief_teacher_user_id')
    .limit(1);
  record(
    '117 · teacher_assignments.relief_teacher_user_id exists',
    !col.error,
    col.error
      ? `read failed: ${col.error.message}`
      : 'column is readable, so it is on the table'
  );

  // ── 117 · the old table is gone ───────────────────────────────────────────
  // A dropped table answers PGRST205 ("Could not find the table"). Anything
  // else — rows, or a permissions error — means it is still there.
  const oldTable = await service
    .from('assignment_reliefs')
    .select('id')
    .limit(1);
  const tableGone = Boolean(
    oldTable.error &&
    /could not find the table|does not exist|schema cache/i.test(
      oldTable.error.message
    )
  );
  record(
    '117 · assignment_reliefs table dropped',
    tableGone,
    tableGone
      ? 'the table is no longer in the schema'
      : oldTable.error
        ? `still present, and reading it failed for another reason: ${oldTable.error.message}`
        : `STILL PRESENT — it returned ${oldTable.data?.length ?? 0} row(s)`
  );

  // ── 117 · the window helper is gone ───────────────────────────────────────
  const helper = await service.rpc('has_active_relief_for_assignment', {
    p_assignment_id: '00000000-0000-4000-8000-000000000000',
  });
  const helperGone = Boolean(
    helper.error &&
    /could not find the function|does not exist|schema cache/i.test(
      helper.error.message
    )
  );
  record(
    '117 · has_active_relief_for_assignment dropped',
    helperGone,
    helperGone
      ? 'the function is gone, and with it the 116 class of failure'
      : `STILL PRESENT — it answered ${JSON.stringify(helper.data)}`
  );

  // ── 117 · the live cover that was migrated ────────────────────────────────
  const cover = await service
    .from('teacher_assignments')
    .select(
      'id, teacher_user_id, relief_teacher_user_id, role, subject:subjects(name), section:sections(name)'
    )
    .not('relief_teacher_user_id', 'is', null);

  if (cover.error) {
    record('117 · cover rows readable', false, cover.error.message);
  } else {
    const rows = cover.data ?? [];
    record(
      '117 · cover carried over',
      true,
      rows.length === 0
        ? 'nobody is on cover right now — correct if no cover was running when 117 ran'
        : `${rows.length} class(es) currently covered`
    );

    // Nobody may cover their own class. A CHECK constraint since 117, so this
    // can only fail if the constraint was not created.
    const selfCover = rows.filter(
      (r) =>
        (r as { teacher_user_id: string }).teacher_user_id ===
        (r as { relief_teacher_user_id: string }).relief_teacher_user_id
    );
    record(
      '117 · nobody covers their own class',
      selfCover.length === 0,
      selfCover.length === 0
        ? 'no self-cover rows'
        : `${selfCover.length} row(s) — the CHECK constraint is missing`
    );

    for (const r of rows) {
      const row = r as unknown as {
        role: string;
        subject: { name: string } | { name: string }[] | null;
        section: { name: string } | { name: string }[] | null;
      };
      const one = <T>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
      console.log(
        `      · ${one(row.section)?.name ?? '—'} — ${
          row.role === 'form_adviser'
            ? 'form adviser'
            : (one(row.subject)?.name ?? '—')
        }`
      );
    }
  }

  // ── 118 · one subject teacher per (section, subject) ──────────────────────
  // The migration aborts if this is violated, so a clean result here is also
  // evidence it ran. Re-checked rather than assumed, because a class doubled
  // up AFTER the migration would mean the index was never created.
  const subj = await service
    .from('teacher_assignments')
    .select(
      'section_id, subject_id, section:sections(name), subject:subjects(name)'
    )
    .eq('role', 'subject_teacher');

  if (subj.error) {
    record('118 · subject assignments readable', false, subj.error.message);
  } else {
    const seen = new Map<string, number>();
    const label = new Map<string, string>();
    for (const r of subj.data ?? []) {
      const row = r as unknown as {
        section_id: string;
        subject_id: string;
        section: { name: string } | { name: string }[] | null;
        subject: { name: string } | { name: string }[] | null;
      };
      const one = <T>(v: T | T[] | null) => (Array.isArray(v) ? v[0] : v);
      const k = `${row.section_id}|${row.subject_id}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
      label.set(
        k,
        `${one(row.section)?.name ?? '—'} — ${one(row.subject)?.name ?? '—'}`
      );
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    record(
      '118 · one teacher per (class, subject)',
      dupes.length === 0,
      dupes.length === 0
        ? `${subj.data?.length ?? 0} subject assignment(s), no class doubled up`
        : `${dupes.length} doubled up: ${dupes.map(([k, n]) => `${label.get(k)} (${n})`).join('; ')}`
    );
  }

  // ── 003 · one adviser per section, unchanged ──────────────────────────────
  const adv = await service
    .from('teacher_assignments')
    .select('section_id, section:sections(name)')
    .eq('role', 'form_adviser');
  if (!adv.error) {
    const bySection = new Map<string, number>();
    for (const r of adv.data ?? []) {
      const id = (r as { section_id: string }).section_id;
      bySection.set(id, (bySection.get(id) ?? 0) + 1);
    }
    const dupes = [...bySection.values()].filter((n) => n > 1).length;
    record(
      '003 · one form adviser per class',
      dupes === 0,
      `${adv.data?.length ?? 0} adviser assignment(s), ${dupes} class(es) with more than one`
    );
  }

  console.log('');
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log('');
  if (failed.length > 0) {
    console.log(`  ${failed.length} check(s) FAILED.\n`);
    process.exit(1);
  }
  console.log(
    '  All checks passed.\n\n' +
      '  This proves the SHAPE of the database only. It read with the service\n' +
      '  client, which bypasses row-level security, so it cannot tell you\n' +
      '  whether a teacher signing in can see their own classes — the exact\n' +
      '  thing migration 116 had to repair. Open a class Teachers tab as a\n' +
      '  teacher before calling this done.\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
