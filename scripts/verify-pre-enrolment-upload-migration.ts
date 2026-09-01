// scripts/verify-pre-enrolment-upload-migration.ts
//
// Read-only. Checks that migration 139 is actually applied, the way the app
// will meet it — through PostgREST, with the same client the app uses. Follows
// scripts/verify-subject-name-migrations.ts.
//
// WHY THIS ONE NEEDS CHECKING RATHER THAN ASSUMING. `getCapabilitiesForRole`
// falls back to DEFAULT_ROLE_CAPABILITIES on ANY failure — table missing, query
// error, empty table (lib/auth/permission-map.ts). That fallback is what makes
// the code safe to deploy before the migration, and it is also what would hide
// a half-applied migration: the app would answer from the built-in defaults and
// look correct while `role_permissions` disagreed. So the only honest check is
// to read the TABLE, not to ask the app.
//
// Run: npx tsx --env-file=.env.local scripts/verify-pre-enrolment-upload-migration.ts
import { createServiceClient } from '../lib/supabase/service';

const EXPECTED_HOLDERS = ['p_file_officer', 'school_admin', 'superadmin'];

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];

function record(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
}

async function main() {
  const service = createServiceClient();

  const { data, error } = await service
    .from('role_permissions')
    .select('role, capability')
    .in('capability', [
      'documents_pre_enrolment.upload',
      'documents_post_enrolment.upload',
    ]);

  if (error) {
    record('role_permissions readable', false, error.message);
    report();
    return;
  }

  const rows = (data ?? []) as Array<{ role: string; capability: string }>;
  const holders = (capability: string) =>
    rows
      .filter((r) => r.capability === capability)
      .map((r) => r.role)
      .sort();

  const pre = holders('documents_pre_enrolment.upload');
  const post = holders('documents_post_enrolment.upload');

  // ── 139: the three grants exist ──────────────────────────────────────────
  record(
    '139 — documents_pre_enrolment.upload granted to the three roles',
    EXPECTED_HOLDERS.every((r) => pre.includes(r)),
    pre.length ? pre.join(', ') : '(no rows — migration not applied)'
  );

  // ── The point of the grant: nobody new can upload ────────────────────────
  // If these two sets ever differ in production, someone has been editing
  // /sis/admin/roles and it is a real permission decision, not drift.
  record(
    'the two upload capabilities have the same holders',
    JSON.stringify(pre) === JSON.stringify(post),
    `pre: [${pre.join(', ')}] · post: [${post.join(', ')}]`
  );

  // ── admissions deliberately excluded (KD #204) ───────────────────────────
  // They own the applicant side, but /p-files excludes them at ROUTE_ACCESS
  // and the applicant file has no upload control — the grant would enforce
  // nothing. Flagged rather than asserted: if someone has since built them a
  // control and ticked the box, this line is the record of it, not a failure.
  record(
    'admissions does NOT hold the pre-enrolment upload',
    !pre.includes('admissions'),
    pre.includes('admissions')
      ? 'admissions HOLDS it — intended only if an upload surface now exists for them'
      : 'absent, as designed'
  );

  report();
}

function report() {
  let failed = 0;
  for (const c of checks) {
    const mark = c.passed ? 'PASS' : 'FAIL';
    if (!c.passed) failed += 1;
    console.log(`[${mark}] ${c.name}\n       ${c.detail}`);
  }
  console.log(
    `\n${checks.length - failed}/${checks.length} checks passed${
      failed ? ' — migration 139 is NOT fully applied' : ''
    }`
  );
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
