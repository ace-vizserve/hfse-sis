// Copies production's SETUP tables (levels, subjects, sections, terms, calendar,
// permissions, …) into supabase/prod-config.sql for the local Supabase stack.
// No students, applications, grades or accounts — only the tables listed below.
//
// The production connection string comes from PROD_DB_URL in .env.prod-db
// (git-ignored; step 2 of `npm run local:refresh`, which loads it):
//   PROD_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
//
// Needs Docker Desktop running (pg_dump runs in the supabase/postgres image).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const url = process.env.PROD_DB_URL;
if (!url) {
  console.error(
    'Put PROD_DB_URL (the production connection string) in .env.prod-db first.'
  );
  process.exit(1);
}

const TABLES = [
  'academic_years',
  'terms',
  'levels',
  'level_aliases',
  'subjects',
  'subject_configs',
  'subject_level_offerings',
  'subject_report_map',
  'sections',
  'section_subjects',
  'school_config',
  'school_calendar',
  'calendar_events',
  'evaluation_terms',
  'role_permissions',
  'houses',
  'house_point_scales',
  'admission_options',
  'approval_stages',
];

const outDir = path.resolve('supabase');
const args = [
  'run',
  '--rm',
  '-e',
  'PGURL',
  '-v',
  `${outDir}:/out`,
  'public.ecr.aws/supabase/postgres:17.11.0.002',
  'sh',
  '-c',
  `pg_dump "$PGURL" --data-only --no-owner -f /out/prod-config.sql ${TABLES.map((t) => `-t public.${t}`).join(' ')}`,
];

// The URL goes in through the container's environment, not its arguments.
const res = spawnSync('docker', args, {
  stdio: 'inherit',
  env: { ...process.env, PGURL: url },
});
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(
  `Wrote supabase/prod-config.sql (${TABLES.length} setup tables, no personal data).`
);
