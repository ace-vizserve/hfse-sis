// scripts/probe-query-cost.ts
//
// Phase 0 (app-wide query/write pass) — the production half of the
// measurement toolkit. `__tests__/_utils/counting-supabase.ts` and the
// `scripts/audit/*.ts` scanners can only measure code SHAPE (how many
// queries a function issues, how deeply they nest); neither can see whether
// a table is big enough for any of that to matter, or whether Postgres is
// actually doing a sequential scan. This answers six sizing questions so a
// later phase's fixes are aimed at what is real, not what merely looks bad.
//
// STRICTLY READ-ONLY. Every statement below is a SELECT, a `.head: true`
// count, or an `explain analyze` on a SELECT. Nothing is written, nothing is
// recomputed. Modelled on scripts/probe-masterfile-integrity.ts (the report
// style) and scripts/verify-travel-declaration.ts (the "answer N questions in
// order, print a verdict" structure) — both already establish the read-only
// discipline this script follows.
//
// Run:
//   npx tsx --env-file=.env.local scripts/probe-query-cost.ts
//
// Exit code is always 0 — this reports, it does not gate a build.
import { createServiceClient } from '../lib/supabase/service';
// The one allowlist that lives at module scope AND is exported — see the
// note above EVALUATION_AUDIT_ALLOWLIST etc. below for why the other four
// are copied rather than imported.
import { MARKBOOK_AUDIT_ALLOWLIST } from '../app/(markbook)/markbook/audit-log/page';

// ── Module audit allowlists ──────────────────────────────────────────────
//
// Four of the five module audit-log pages define their allowlist as a
// non-exported `const` (evaluation, SIS) or as a `const` declared INSIDE the
// page component function itself (records, p-files) — neither is importable
// from a standalone script, and this phase's binding constraint is "no
// product code is modified except the one flag-gated addition in
// lib/supabase/service.ts" (0b), so exporting them is not this script's call
// to make. Each of the four below is a literal, dated copy of the source —
// diff against the named file before trusting this list if a while has
// passed since the date given.
//
// Copied 2026-08-29 from app/(evaluation)/evaluation/audit-log/page.tsx:26.
const EVALUATION_AUDIT_ALLOWLIST = [
  'evaluation.writeup.save',
  'evaluation.writeup.submit',
  'evaluation.writeup.resubmit',
  'ay.term_virtue.update',
  'evaluation.checklist_item.create',
  'evaluation.checklist_item.update',
  'evaluation.checklist_item.delete',
  'evaluation.checklist_item.reorder',
  'evaluation.checklist_item.copy_from',
  'evaluation.checklist_response.save',
  'evaluation.subject_comment.save',
  'evaluation.ptc_feedback.save',
] as const;

// Copied 2026-08-29 from app/(sis)/sis/audit-log/page.tsx:16.
const SIS_AUDIT_ALLOWLIST = [
  'approver.assign',
  'approver.revoke',
  'approval_stage.create',
  'approval_stage.update',
  'approval_stage.delete',
  'approval_stage.approver.assign',
  'approval_stage.approver.revoke',
  'subject.create',
  'subject_config.create',
  'subject_config.update',
  'subject_level_offering.toggle',
  'subject_report_map.update',
  'subject.catalog.update',
  'template.section.create',
  'template.section.update',
  'template.section.delete',
  'template.subject_config.create',
  'template.subject_config.update',
  'template.subject_config.delete',
  'template.subject_config.bulk_delete',
  'template.apply',
  'section.create',
  'section.rename',
  'section.delete',
  'section.realphabetize',
  'section.index.generate',
  'section.track.assign',
  'section.schedule.update',
  'section.subject.assign',
  'section.subject.remove',
  'section.subjects.load_defaults',
  'section.subjects.attach_many',
  'assignment.create',
  'assignment.delete',
  'assignment.relief.start',
  'assignment.relief.end',
  'level.create',
  'level.update',
  'level.delete',
  'level.offering.toggle',
  'sis.level.create',
  'attendance.calendar.upsert',
  'attendance.calendar.delete',
  'attendance.calendar.autoseed',
  'attendance.calendar.copy_from_prior_ay',
  'attendance.event.create',
  'attendance.event.update',
  'attendance.event.delete',
  'ay.term_dates.update',
  'ay.term_virtue.update',
  'ay.term_grading_lock.update',
  'school_config.update',
  'user.invite',
  'user.create',
  'user.info.update',
  'user.role.update',
  'role.permissions.update',
  'user.disable',
  'user.enable',
  'user.delete',
  'environment.switch',
  'environment.seed',
  'environment.topup',
  'environment.demo_accounts_removed',
  'user.login',
  'parent.session.issued',
  'parent.session.cleared',
] as const;

// Copied 2026-08-29 from app/(records)/records/audit-log/page.tsx:51 (inside
// the page component, not module scope).
const RECORDS_AUDIT_ALLOWLIST = [
  'sis.profile.update',
  'sis.family.update',
  'sis.stage.update',
  'sis.stp.update',
  'sis.discount_code.create',
  'sis.discount_code.update',
  'sis.discount_code.expire',
  'sis.document.approve',
  'sis.document.reject',
  'sis.documents.auto-expire',
  'sis.documents.auto-revive',
  'sis.allowance.update',
  'sis.vl_allowance.update',
  'sis.house.update',
  'sis.student.assign_section',
  'sis.student.auto_sync_batch',
  'level.alias.create',
  'student.sync',
  'student.add',
  'student.section.transfer',
  'student.withdrawal.cascade',
  'student.reenrolment.cascade',
  'ay.create',
  'ay.switch_current',
  'ay.accepting_applications.toggle',
  'ay.delete',
  'ay.term_dates.update',
  'ay.term_virtue.update',
  'ay.term_grading_lock.update',
  'ay.copy_teacher_assignments',
  'pfile.upload',
  'pfile.reminder.sent',
  'pfile.reminder.bulk',
  'pfile.mark.promised',
  'enrolment.metadata.update',
  'discipline.record.file',
  'discipline.record.update',
] as const;

// Copied 2026-08-29 from app/(p-files)/p-files/audit-log/page.tsx:50 (inside
// the page component, not module scope).
const PFILES_AUDIT_ALLOWLIST = [
  'pfile.upload',
  'pfile.reminder.sent',
  'pfile.reminder.bulk',
  'pfile.mark.promised',
  'sis.document.approve',
  'sis.document.reject',
  'sis.documents.auto-expire',
  'sis.documents.auto-revive',
] as const;

const MODULE_ALLOWLISTS: Record<string, readonly string[]> = {
  evaluation: EVALUATION_AUDIT_ALLOWLIST,
  markbook: MARKBOOK_AUDIT_ALLOWLIST,
  sis: SIS_AUDIT_ALLOWLIST,
  records: RECORDS_AUDIT_ALLOWLIST,
  'p-files': PFILES_AUDIT_ALLOWLIST,
};

// ── small helpers ────────────────────────────────────────────────────────

const heading = (text: string) =>
  console.log(`\n${'─'.repeat(76)}\n${text}\n${'─'.repeat(76)}`);

async function exactCount(
  query: PromiseLike<{
    count: number | null;
    error: { message: string } | null;
  }>
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// PostgREST caps a single response at 1000 rows on this instance — walk pages
// for anything that could plausibly exceed it (same technique as
// lib/supabase/paginate.ts::fetchAllPages, reimplemented here so this script
// has zero dependency on app code beyond the two read-only clients it needs).
const PAGE = 1000;
async function walk<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(JSON.stringify(error));
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  const service = createServiceClient();

  console.log('='.repeat(76));
  console.log('QUERY COST PROBE — Phase 0, app-wide query/write pass');
  console.log('='.repeat(76));
  console.log('Read-only. Every statement is a SELECT / count / explain.');

  // ── Q1 · audit_log volume, per module allowlist, distinct actors ────────
  heading(
    '1 · audit_log — total rows, per-module allowlist hits, distinct actors'
  );

  const totalAuditRows = await exactCount(
    service.from('audit_log').select('id', { count: 'exact', head: true })
  );
  console.log(`  audit_log total rows: ${totalAuditRows}`);
  console.log(
    '\n  Why this matters: decides whether the evaluation audit-log dropdown' +
      "\n  truncates today, and whether the sibling pages' `.limit(200)` on the" +
      '\n  actor-filter dropdown is itself under-sized.\n'
  );
  console.log(
    `  ${'Module'.padEnd(12)}${'Allowlist size'.padStart(15)}${'Rows matching'.padStart(15)}${'Distinct actors'.padStart(18)}`
  );

  for (const [module, allowlist] of Object.entries(MODULE_ALLOWLISTS)) {
    const rowsMatching = await exactCount(
      service
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .in('action', allowlist)
    );
    // Distinct actor_email within the allowlist — walk actor_email only
    // (narrow column, cheap) and dedupe in memory. A `count: 'exact'` on a
    // DISTINCT expression isn't something PostgREST can do without an RPC,
    // and this table is nowhere near the page cap for one module's slice.
    const actorRows = await walk<{ actor_email: string | null }>((from, to) =>
      service
        .from('audit_log')
        .select('actor_email')
        .in('action', allowlist)
        .range(from, to)
    );
    const distinctActors = new Set(
      actorRows.map((r) => r.actor_email ?? '(unknown)')
    ).size;
    const flag =
      distinctActors >= 200 ? '  ← at/near a 200-row dropdown cap' : '';
    console.log(
      `  ${module.padEnd(12)}${String(allowlist.length).padStart(15)}${String(rowsMatching).padStart(15)}${String(distinctActors).padStart(18)}${flag}`
    );
  }

  // ── Q2 · the largest ay*_enrolment_applications table ───────────────────
  heading(
    '2 · largest ay*_enrolment_applications table — row count + a Seq Scan check'
  );

  // Enumerate every ay{YY}_enrolment_applications table via academic_years —
  // the same "which AY tables exist" question probe-masterfile-integrity.ts
  // and verify-travel-declaration.ts both answer by reading academic_years
  // rather than guessing at table names.
  const { data: ayRows, error: ayErr } = await service
    .from('academic_years')
    .select('ay_code')
    .order('ay_code', { ascending: false });
  if (ayErr) {
    console.log(`  academic_years lookup failed: ${ayErr.message}`);
  }
  const ayCodes = ((ayRows ?? []) as { ay_code: string }[]).map(
    (r) => r.ay_code
  );

  type TableSize = { ayCode: string; table: string; rows: number };
  const sizes: TableSize[] = [];
  for (const ayCode of ayCodes) {
    const year = ayCode.replace(/^AY/i, '').toLowerCase();
    const table = `ay${year}_enrolment_applications`;
    try {
      const rows = await exactCount(
        service.from(table).select('id', { count: 'exact', head: true })
      );
      sizes.push({ ayCode, table, rows });
    } catch (e) {
      console.log(
        `  ${table}: could not read (${e instanceof Error ? e.message : String(e)})`
      );
    }
  }
  sizes.sort((a, b) => b.rows - a.rows);
  for (const s of sizes) {
    console.log(`  ${s.table.padEnd(34)}${String(s.rows).padStart(6)} rows`);
  }

  const largest = sizes[0];
  if (!largest) {
    console.log('\n  No ay*_enrolment_applications table could be read.');
  } else {
    console.log(
      `\n  Largest: ${largest.table} (${largest.rows} rows, ${largest.ayCode}).`
    );
    // Docs 11-performance-patterns.md §10 already found this by hand: these
    // per-AY tables carry no index beyond the `id` primary key, despite dozens
    // of `.eq('enroleeNumber', …)` call sites. Confirm with a representative
    // row's real enroleeNumber, since a value that doesn't exist would still
    // report a (trivially fast) Seq Scan and prove nothing.
    const { data: sampleRows } = await service
      .from(largest.table)
      .select('enroleeNumber')
      .not('enroleeNumber', 'is', null)
      .limit(1);
    const sample = (sampleRows ?? [])[0] as
      | { enroleeNumber: string }
      | undefined;

    if (!sample) {
      console.log(
        '  No row with a non-null enroleeNumber to test against — skipping the plan check.'
      );
    } else {
      const sql =
        `explain analyze select * from "${largest.table}" ` +
        `where "enroleeNumber" = '${sample.enroleeNumber}';`;
      console.log(`\n  Representative query:\n    ${sql}`);
      // The supabase-js client speaks PostgREST, which has no `explain`
      // verb — EXPLAIN ANALYZE needs a raw SQL connection (the Dashboard's
      // SQL editor, or a direct Postgres connection string this app does
      // not hold — KD: this app is PostgREST-only, no pg/Prisma client, see
      // docs/context/11-performance-patterns.md §8). Print it for a human to
      // run rather than silently skipping the question, per the brief.
      console.log(
        '  supabase-js/PostgREST has no `explain` verb — this cannot be run' +
          '\n  from this script. Paste the query above into the Supabase SQL' +
          '\n  editor to see whether it is a Seq Scan or an Index Scan.'
      );
    }
  }

  // ── Q3 · grade_entries per unlocked sheet; unlocked sheets per config ───
  heading(
    '3 · write fan-out — grade_entries per UNLOCKED sheet; unlocked sheets per subject_config'
  );

  const unlockedSheets = await walk<{
    id: string;
    subject_config_id: string | null;
  }>((from, to) =>
    service
      .from('grading_sheets')
      .select('id, subject_config_id')
      .eq('is_locked', false)
      .range(from, to)
  );
  console.log(`  ${unlockedSheets.length} unlocked sheet(s) school-wide.`);

  if (unlockedSheets.length === 0) {
    console.log(
      '  Nothing further to size — no unlocked sheets exist right now.'
    );
  } else {
    const byConfig = new Map<string, number>();
    for (const s of unlockedSheets) {
      const key = s.subject_config_id ?? '(no subject_config_id)';
      byConfig.set(key, (byConfig.get(key) ?? 0) + 1);
    }
    const configCounts = [...byConfig.values()].sort((a, b) => b - a);
    console.log(
      `  Spread across ${byConfig.size} subject_config(s) — max ${configCounts[0]} sheet(s) on one config, median ${configCounts[Math.floor(configCounts.length / 2)]}.`
    );

    const sheetIds = unlockedSheets.map((s) => s.id);
    const entryCounts = new Map<string, number>();
    // Chunked, same reasoning as lib/supabase/paginate.ts::fetchInChunks: an
    // unbounded UUID list in `.in()` risks the ~14.3KB URL ceiling.
    const CHUNK = 150;
    for (let i = 0; i < sheetIds.length; i += CHUNK) {
      const slice = sheetIds.slice(i, i + CHUNK);
      const rows = await walk<{ grading_sheet_id: string }>((from, to) =>
        service
          .from('grade_entries')
          .select('grading_sheet_id')
          .in('grading_sheet_id', slice)
          .range(from, to)
      );
      for (const r of rows) {
        entryCounts.set(
          r.grading_sheet_id,
          (entryCounts.get(r.grading_sheet_id) ?? 0) + 1
        );
      }
    }
    const perSheet = [...entryCounts.values()];
    const maxEntries = perSheet.length > 0 ? Math.max(...perSheet) : 0;
    const totalEntries = perSheet.reduce((a, b) => a + b, 0);
    console.log(
      `  Max grade_entries on one unlocked sheet: ${maxEntries} (Hard Rule #5 caps a roster at 50).`
    );
    console.log(
      `  Total grade_entries across every unlocked sheet: ${totalEntries} — the ceiling a school-wide config edit would recompute.`
    );
  }

  // ── Q4 · pending travel/absence declarations ────────────────────────────
  heading('4 · pending declarations — sizes a deferred candidate');

  const pendingDeclarations = await exactCount(
    service
      .from('student_declarations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
  );
  console.log(`  ${pendingDeclarations} declaration(s) currently pending.`);

  // ── Q5 · attendance_daily rows written per teacher per day ──────────────
  heading(
    '5 · attendance_daily rows per (teacher, day) — a proxy for cells marked per sitting'
  );

  const dailyRows = await walk<{ recorded_by: string | null; date: string }>(
    (from, to) =>
      service
        .from('attendance_daily')
        .select('recorded_by, date')
        .range(from, to)
  );
  console.log(
    `  ${dailyRows.length} attendance_daily row(s) total (all of it read, paginated).`
  );

  const perTeacherDay = new Map<string, number>();
  for (const r of dailyRows) {
    const key = `${r.recorded_by ?? '(unknown)'}|${r.date}`;
    perTeacherDay.set(key, (perTeacherDay.get(key) ?? 0) + 1);
  }
  const sittingSizes = [...perTeacherDay.values()].sort((a, b) => b - a);
  if (sittingSizes.length === 0) {
    console.log('  No attendance_daily rows exist yet.');
  } else {
    const top = sittingSizes.slice(0, 5);
    console.log(
      `  ${perTeacherDay.size} distinct (teacher, day) pair(s). Largest sittings: ${top.join(', ')}.`
    );
    const sum = sittingSizes.reduce((a, b) => a + b, 0);
    console.log(
      `  Median ${sittingSizes[Math.floor(sittingSizes.length / 2)]}, mean ${(sum / sittingSizes.length).toFixed(1)}.`
    );
  }

  // ── Q6 · largest historical attendance import batch ─────────────────────
  heading(
    '6 · largest single historical attendance import — sizes a bounded-wave decision'
  );

  // The app self-reports the batch size at write time
  // (app/api/attendance/import/route.ts logs `rows_written` in the audit
  // context for `attendance.import.bulk`). Read from there rather than
  // re-deriving it from raw attendance_daily rows, which would need a
  // reliable "same import" key (recorded_at is shared per call but is not
  // indexed for grouping at this volume).
  const importRows = await walk<{ context: Record<string, unknown> | null }>(
    (from, to) =>
      service
        .from('audit_log')
        .select('context')
        .eq('action', 'attendance.import.bulk')
        .range(from, to)
  );
  console.log(`  ${importRows.length} recorded import batch(es).`);
  if (importRows.length === 0) {
    console.log(
      '  No attendance.import.bulk audit rows exist — nothing to size.'
    );
  } else {
    const batchSizes = importRows
      .map((r) => Number(r.context?.rows_written ?? 0))
      .filter((n) => Number.isFinite(n));
    batchSizes.sort((a, b) => b - a);
    console.log(
      `  Largest recorded batch: ${batchSizes[0]} row(s) written in one import call.`
    );
    console.log(`  Top 5: ${batchSizes.slice(0, 5).join(', ')}`);
  }

  console.log(`\n${'='.repeat(76)}`);
  console.log('Read-only. Nothing was written.');
  console.log('='.repeat(76));
}

main().catch((e) => {
  console.error('Probe failed:', e);
  process.exit(1);
});
