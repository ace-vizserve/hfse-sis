// Read-only: are migrations 173, 175 and 176 applied to production?
// Each check reads the end state its migration leaves behind.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-migrations-173-175-176.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

async function main() {
  // 173 — a YS level at sort_order 3 whose next level is P1.
  const { data: levels, error: lErr } = await sb
    .from('levels')
    .select('id, code, label, sort_order, next_level_id')
    .in('code', ['YS', 'P1']);
  if (lErr) throw lErr;
  const ys = levels?.find((l) => l.code === 'YS');
  const p1 = levels?.find((l) => l.code === 'P1');
  console.log('173 YS level:', ys ?? 'MISSING');
  console.log(
    '173 applied:',
    !!ys && ys.sort_order === 3 && !!p1 && ys.next_level_id === p1.id
  );

  // 175 — admissions holds all four sections.* capabilities.
  const { data: perms, error: pErr } = await sb
    .from('role_permissions')
    .select('capability')
    .eq('role', 'admissions')
    .like('capability', 'sections.%');
  if (pErr) throw pErr;
  const caps = (perms ?? []).map((p) => p.capability).sort();
  console.log('175 admissions sections caps:', caps);
  console.log(
    '175 applied:',
    [
      'sections.create',
      'sections.delete',
      'sections.edit',
      'sections.read',
    ].every((c) => caps.includes(c))
  );

  // 176 — the column exists (a select on it errors otherwise) and AY2026 is on.
  const { data: ays, error: aErr } = await sb
    .from('academic_years')
    .select('ay_code, vizschool_accepting_applications')
    .order('ay_code');
  if (aErr) {
    console.log('176 applied: false —', aErr.message);
  } else {
    console.log('176 rows:', ays);
    console.log('176 applied: true (column present)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
