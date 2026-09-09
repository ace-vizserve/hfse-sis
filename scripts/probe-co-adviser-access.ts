// scripts/probe-co-adviser-access.ts
//
// Why does Evaluation tell a co-adviser they have no sections?
//
// STRICTLY READ-ONLY. Every statement is a SELECT.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-co-adviser-access.ts
import { createServiceClient } from '../lib/supabase/service';

async function main() {
  const svc = createServiceClient();

  const { data: users, error: uErr } = await svc.auth.admin.listUsers({
    perPage: 200,
  });
  if (uErr) throw uErr;

  const { data: sections } = await svc
    .from('sections')
    .select('id, name, academic_year_id');
  const { data: ays } = await svc
    .from('academic_years')
    .select('id, ay_code, is_current');
  const ayById = new Map((ays ?? []).map((a) => [a.id as string, a]));
  const sectionById = new Map((sections ?? []).map((s) => [s.id as string, s]));

  const { data: assignments } = await svc
    .from('teacher_assignments')
    .select('id, teacher_user_id, section_id, subject_id, role');

  // 1 · Every co_adviser / co_teacher row in the system.
  console.log('\n── co_ assignment rows ─────────────────────────────────');
  for (const a of assignments ?? []) {
    if (!String(a.role).startsWith('co_')) continue;
    const u = users.users.find((x) => x.id === a.teacher_user_id);
    const s = sectionById.get(a.section_id as string);
    const ay = s ? ayById.get(s.academic_year_id as string) : null;
    console.log(
      `  ${(u?.email ?? a.teacher_user_id).padEnd(34)} ${String(a.role).padEnd(15)} ${s?.name ?? '?'} · ${ay?.ay_code ?? '?'}${ay?.is_current ? ' (current)' : ''}`
    );
  }

  // 2 · Ace Guevarra specifically — every assignment row he holds.
  console.log('\n── ace.guevarra assignments ────────────────────────────');
  const ace = users.users.find((u) =>
    (u.email ?? '').toLowerCase().includes('ace.guevarra')
  );
  if (!ace) {
    console.log('  no ace.guevarra account found');
  } else {
    console.log(
      `  ${ace.email} · id ${ace.id}\n  app_metadata.role = ${JSON.stringify(ace.app_metadata?.role)} · active_role = ${JSON.stringify(ace.app_metadata?.active_role)}`
    );
    const mine = (assignments ?? []).filter(
      (a) => a.teacher_user_id === ace.id
    );
    if (mine.length === 0) console.log('  (no teacher_assignments rows)');
    for (const a of mine) {
      const s = sectionById.get(a.section_id as string);
      const ay = s ? ayById.get(s.academic_year_id as string) : null;
      let subject = '—';
      if (a.subject_id) {
        const { data: sub } = await svc
          .from('subjects')
          .select('name')
          .eq('id', a.subject_id)
          .maybeSingle();
        subject = (sub?.name as string) ?? '?';
      }
      console.log(
        `  ${String(a.role).padEnd(16)} ${(s?.name ?? '?').padEnd(16)} ${(ay?.ay_code ?? '?').padEnd(8)}${ay?.is_current ? '(current) ' : '          '}subject=${subject}`
      );
    }
  }
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
