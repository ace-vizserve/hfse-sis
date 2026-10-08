// Applies supabase/migrations/*.sql files the LOCAL database hasn't run yet.
// Run it after `git pull`: you get new tables, and your local test data stays.
//
//   npm run local:migrate            apply every new migration, in filename order
//   npm run local:migrate -- --list  show what is applied / pending
//
// Bookkeeping lives in its own schema, `local_dev`, so the seeder's wipe (public
// only) and a schema dump of production never see it. The first run has nothing
// recorded, so it marks every migration file present at that moment as already
// applied: the local DB was built from a dump of production, which already
// contains them. Only files added after that get applied.
//
// Local only: it talks to the local database container, never to a URL.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const projectId = /project_id\s*=\s*"([^"]+)"/.exec(
  readFileSync(path.resolve('supabase/config.toml'), 'utf8')
)?.[1];
if (!projectId) {
  console.error('No project_id in supabase/config.toml.');
  process.exit(1);
}
const CONTAINER = `supabase_db_${projectId}`;
const DIR = path.resolve('supabase/migrations');

function psql(input) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-tAq',
    ],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }
  );
}
const quote = (s) => `'${s.replace(/'/g, "''")}'`;

psql(
  'set client_min_messages = warning;\n' +
    'create schema if not exists local_dev;\n' +
    'create table if not exists local_dev.applied_migrations (name text primary key, applied_at timestamptz not null default now(), baseline boolean not null default false);\n'
);

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
const applied = new Set(
  psql('select name from local_dev.applied_migrations;\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
);

if (applied.size === 0) {
  psql(
    `insert into local_dev.applied_migrations (name, baseline) values ${files.map((f) => `(${quote(f)}, true)`).join(',')};\n`
  );
  console.log(
    `First run: marked ${files.length} existing migrations as already in the local DB (it was built from production's schema).`
  );
  process.exit(0);
}

const pending = files.filter((f) => !applied.has(f));

if (process.argv.includes('--list')) {
  console.log(`${applied.size} applied, ${pending.length} pending`);
  for (const f of pending) console.log(`  pending  ${f}`);
  process.exit(0);
}

if (pending.length === 0) {
  console.log('Local DB is up to date: no new migrations.');
  process.exit(0);
}

for (const f of pending) {
  process.stdout.write(`Applying ${f} … `);
  try {
    // One transaction per file: it either fully applies and is recorded, or
    // nothing from it lands.
    psql(
      `begin;\n${readFileSync(path.join(DIR, f), 'utf8')}\n;\ninsert into local_dev.applied_migrations (name) values (${quote(f)});\ncommit;\n`
    );
    console.log('ok');
  } catch {
    console.log('FAILED (rolled back; nothing from this file was applied)');
    process.exit(1);
  }
}
console.log(`Applied ${pending.length} migration(s).`);
