// Phase "verify": the Phase 0 check, runnable on its own any time.
//
//   1. The harness reaches the app's real lib/** code:
//        * `server-only` modules import (lib/approvals/config.ts was already
//          used by the staff phase; lib/auth/staff-list.ts is imported here);
//        * `unstable_cache` runs (getTeacherList wraps its auth read in it)
//          and returns the seeded teachers from the LOCAL stack;
//        * `revalidateTag` runs (invalidateDrillTags) without throwing.
//   2. A seeded teacher signs in with a password against the local stack.
//   3. Row counts for every public table + seeded auth users + storage
//      objects, with a fingerprint — two rebuilds must print the same one —
//      and an audit_log content fingerprint over its stable columns (not
//      id / created_at / entity_id, which come from database defaults).
//   4. The Phase 1 people/admissions check (./verify-people.ts).
//   5. The Phase 2 teacher-assignment + cover check (./verify-teachers.ts).
//   6. The Phase 3 markbook + publication check (./verify-markbook.ts).
//   7. The Phase 4 attendance check (./verify-attendance.ts).
//   8. The Phase 5 evaluation check (./verify-evaluation.ts).
//   9. The Phase 6 check — declarations + approvals, discipline, class notes
//      (./verify-governance.ts).
//  10. The Phase 7 check — P-Files history + outreach, house points, portal
//      drafts + recovery tokens, discount codes (./verify-pfiles-houses.ts).

import { createHash } from 'node:crypto';

import { getTeacherList } from '@/lib/auth/staff-list';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';

import {
  LOCAL_EMAIL_DOMAIN,
  LOCAL_PARENT_MARK,
  LOCAL_PASSWORD,
  RUN_DATE_AUDIT_MASK,
  maskApprovalDate,
} from '../lib/constants';
import { anon, sql, sqlRows } from '../lib/local';
import { runDependentRegisterKeys } from './attendance';
import { verifyAttendance } from './verify-attendance';
import { verifyEvaluation } from './verify-evaluation';
import { verifyGovernance } from './verify-governance';
import { verifyMarkbook } from './verify-markbook';
import { verifyPeople } from './verify-people';
import { verifyPfilesHouses } from './verify-pfiles-houses';
import { verifyTeachers } from './verify-teachers';

export async function runVerify(): Promise<void> {
  // ── 1. lib/** through the harness ─────────────────────────────────────
  const teachers = await getTeacherList();
  const local = teachers.filter((t) =>
    t.email.endsWith(`@${LOCAL_EMAIL_DOMAIN}`)
  );
  if (local.length === 0) {
    throw new Error('getTeacherList() returned no seeded teachers');
  }
  invalidateDrillTags('markbook', 'AY2026');
  console.log(
    `  lib proof: getTeacherList() [server-only + unstable_cache] -> ${local.length} local teachers; invalidateDrillTags() [revalidateTag] ok`
  );

  // ── 2. a teacher signs in ─────────────────────────────────────────────
  const email = `teacher01@${LOCAL_EMAIL_DOMAIN}`;
  const { data, error } = await anon().auth.signInWithPassword({
    email,
    password: LOCAL_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(
      `sign-in as ${email} failed: ${error?.message ?? 'no session'}`
    );
  }
  const meta = data.user.app_metadata as {
    role?: string[];
    active_role?: string;
  };
  console.log(
    `  sign-in: ${email} ok (user ${data.user.id}, role ${JSON.stringify(meta.role)}, active_role ${meta.active_role})`
  );

  // ── 3. counts ─────────────────────────────────────────────────────────
  const tables = sqlRows(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname not like 'directus\\_%' and c.relname not like 'careers\\_%'
      order by 1`
  ).map((r) => r[0]);
  const union = tables
    .map((t) => `select '${t}', count(*) from public."${t}"`)
    .concat([
      `select 'auth.users(@${LOCAL_EMAIL_DOMAIN})', count(*) from auth.users where email like '%@${LOCAL_EMAIL_DOMAIN}'`,
      `select 'auth.users(seeded parents)', count(*) from auth.users where raw_app_meta_data->>'${LOCAL_PARENT_MARK.key}' = '${LOCAL_PARENT_MARK.value}'`,
      `select 'storage.objects(parent-portal)', count(*) from storage.objects where bucket_id = 'parent-portal'`,
    ])
    .join('\nunion all\n');
  // Ordered: a UNION ALL of this size can come back in any order (parallel
  // plans), and the fingerprint below hashes the rows in order.
  const counts = sqlRows(`select * from (${union}) c order by 1`);
  const nonEmpty = counts.filter(([, n]) => n !== '0');

  // The registers that exist only because the real run date reached them
  // (lib/constants.ts; phases/attendance.ts `runDependentRegisterKeys`) add
  // attendance_daily rows and their audit rows — counted here per (class,
  // day) key and left out of the fingerprinted counts.
  const runDependent = await runDependentRegisterKeys();
  const maskedBy = (rows: string[][]) =>
    rows.reduce((s, [k, n]) => s + (runDependent.has(k) ? Number(n) : 0), 0);
  const masked: Record<string, number> = {
    attendance_daily: maskedBy(
      sqlRows(`select ss.section_id || '|' || d.date, count(*) from attendance_daily d
                 join section_students ss on ss.id = d.section_student_id group by 1`)
    ),
    audit_log: maskedBy(
      sqlRows(`select (context->>'section_id') || '|' || (context->>'date'), count(*) from audit_log
                where action like 'attendance.daily.%' group by 1`)
    ),
  };
  const pinnedCounts = counts.map(([t, n]) => [
    t,
    String(Number(n) - (masked[t] ?? 0)),
  ]);
  const fingerprint = createHash('sha256')
    .update(pinnedCounts.map((r) => r.join('=')).join('\n'))
    .digest('hex')
    .slice(0, 16);
  console.log(`  counts (non-zero of ${counts.length}):`);
  for (const [t, n] of nonEmpty)
    console.log(
      `    ${t.padEnd(40)} ${n}${masked[t] ? `  (${masked[t]} run-date dependent)` : ''}`
    );
  console.log(
    `  counts fingerprint (excl. the run-date-dependent registers): ${fingerprint}`
  );

  // audit_log CONTENT, stable columns only. `id` and `created_at` come from
  // the database defaults (gen_random_uuid(), now()) and `logAction` cannot
  // set them, and `entity_id` is a fresh default uuid for rows such as
  // approval_stage_approvers — so those three are left out. The same goes for
  // uuids INSIDE context (a students.id or section_students.id the route
  // records, e.g. `student_id` on sis.house.update), which are blanked.
  // Everything else (actor, action, entity type, context) must match between
  // rebuilds — except the run-relative dates lib/constants.ts documents (the
  // live/scheduled cover dates, the approval reference's date), masked by
  // RUN_DATE_AUDIT_MASK / maskApprovalDate so rebuilds on different days agree.
  //
  // One list inside a context is order-free: `subject_config.term_weights`
  // logs its `before` classes in the order the route's unordered sheet read
  // returned them (as the real route does), which differs between rebuilds —
  // so that list is sorted here, by content, before hashing.
  //
  // The run-date-dependent registers' audit rows (above) are left out by
  // their (class, day) key, carried as a leading column and dropped here.
  const auditLines = sql(
    `select case when action like 'attendance.daily.%'
                 then coalesce(context->>'section_id', '') || '@' || coalesce(context->>'date', '') else '' end,
                coalesce(actor_id::text, ''), coalesce(actor_email, ''), coalesce(actor_role, ''),
                action, entity_type,
                regexp_replace(${maskApprovalDate(RUN_DATE_AUDIT_MASK)}, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'g')
           from (select actor_id, actor_email, actor_role, action, entity_type,
                   case when action = 'subject_config.term_weights'
                         and jsonb_typeof(context->'before') = 'array'
                        then jsonb_set(context, '{before}', coalesce((
                          select jsonb_agg(e order by (e - 'grading_sheet_id')::text)
                            from jsonb_array_elements(context->'before') e), '[]'::jsonb))
                        else context end as context
                   from public.audit_log) audit_log
          order by 2, 3, 4, 5, 6, 7`
  )
    .split('\n')
    .filter((line) => {
      const key = line.slice(0, line.indexOf('|'));
      return !runDependent.has(key.replace('@', '|'));
    })
    .map((line) => line.slice(line.indexOf('|') + 1));
  const auditFingerprint = createHash('sha256')
    .update(auditLines.join('\n'))
    .digest('hex')
    .slice(0, 16);
  console.log(
    `  audit_log fingerprint (excl. id, created_at, entity_id and the run-date-dependent registers): ${auditFingerprint}`
  );

  // ── 4. Phase 1: people + admissions ───────────────────────────────────
  await verifyPeople();

  // ── 5. Phase 2: teacher assignments + cover ───────────────────────────
  await verifyTeachers();

  // ── 6. Phase 3: markbook + publication ────────────────────────────────
  await verifyMarkbook();

  // ── 7. Phase 4: attendance ────────────────────────────────────────────
  await verifyAttendance();

  // ── 8. Phase 5: evaluation write-ups ──────────────────────────────────
  await verifyEvaluation();

  // ── 9. Phase 6: declarations + approvals, discipline, class notes ─────
  await verifyGovernance();

  // ── 10. Phase 7: P-Files, house points, portal drafts ─────────────────
  await verifyPfilesHouses();
}
