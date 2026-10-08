// Rebuilds the LOCAL database from nothing, in one command:
//
//   npm run local:rebuild
//
//   1. Docker running, the local Supabase stack up (`npx supabase start` if not);
//   2. the local database reset to empty (`npx supabase db reset` — config.toml
//      turns migrations and the seed file off, so it yields a bare database);
//   3. production's schema (supabase/prod-schema.sql) + the post-dump fixups
//      (scripts/local/post-schema-fixups.sql);
//   4. production's setup data (supabase/prod-config.sql), triggers off;
//   5. the `parent-portal` storage bucket;
//   6. the migration baseline (supabase/prod-schema.migrations.txt, written by
//      `npm run local:refresh` when the dump was taken), then
//      `npm run local:migrate` for anything newer;
//   7. the full seeder, then a one-screen summary.
//
// Everything you had locally is replaced. To keep your data and only pick up
// new tables, use `npm run local:migrate` instead.
//
// LOCAL ONLY: it talks to the Postgres container `supabase_db_<project_id>`
// (supabase/config.toml) through `docker exec`, and to the API URL in
// .env.development.local only after checking it is 127.0.0.1 / localhost on
// config.toml's [api] port. It never reads .env.prod-db and never connects to
// production.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const started = Date.now();
const timings = [];

function fail(message) {
  console.error(`\nlocal:rebuild stopped: ${message}`);
  process.exit(1);
}

/** Runs one step, timing it under `short` (the summary's label). */
async function step(name, short, fn) {
  const t = Date.now();
  console.log(`\n=== ${name}`);
  const out = await fn();
  timings.push([short, (Date.now() - t) / 1000]);
  return out;
}

// ── The local stack, as supabase/config.toml defines it ──────────────────
function readStack() {
  let toml;
  try {
    toml = readFileSync(path.resolve('supabase/config.toml'), 'utf8');
  } catch {
    fail('cannot read supabase/config.toml — run this from the repo root.');
  }
  let section = '';
  let projectId = null;
  let apiPort = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const kv = line.match(/^([\w-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    if (section === '' && kv[1] === 'project_id')
      projectId = kv[2].replace(/^"(.*)"$/, '$1');
    if (section === 'api' && kv[1] === 'port') apiPort = Number(kv[2]);
  }
  if (!projectId || !/^[\w-]+$/.test(projectId))
    fail('no usable project_id in supabase/config.toml.');
  if (!apiPort) fail('no [api] port in supabase/config.toml.');
  return { projectId, apiPort };
}

function readEnvFile(file) {
  const env = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const { projectId, apiPort } = readStack();
const CONTAINER = `supabase_db_${projectId}`;
const FILES = {
  schema: 'supabase/prod-schema.sql',
  config: 'supabase/prod-config.sql',
  manifest: 'supabase/prod-schema.migrations.txt',
  fixups: 'scripts/local/post-schema-fixups.sql',
  env: '.env.development.local',
};

/** psql inside the local container, as `postgres`; stops on the first error. */
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
      '-q',
      '-t',
      '-A',
    ],
    {
      input,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'inherit'],
    }
  ).trim();
}

/** A command line through the shell (npx / npm are .cmd shims on Windows). Fixed strings only. */
const run = (cmdline, opts = {}) =>
  spawnSync(cmdline, { stdio: 'inherit', shell: true, ...opts });

// ── 0. Everything this needs is present, before anything is touched ──────
if (!existsSync(FILES.env))
  fail(
    `${FILES.env} is missing. It points \`next dev\` and the seeder at the local stack — see docs/context/24-local-dev.md ("One-time setup").`
  );
const env = readEnvFile(FILES.env);
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const local = url.match(/^http:\/\/(127\.0\.0\.1|localhost):(\d+)\/?$/);
if (!local || Number(local[2]) !== apiPort)
  fail(
    `${FILES.env} sets NEXT_PUBLIC_SUPABASE_URL=${url || '(nothing)'}, which is not this repo's local stack (http://127.0.0.1:${apiPort}). Refusing to run.`
  );
const serviceKey = env.SUPABASE_SERVICE_KEY;
if (!serviceKey) fail(`${FILES.env} has no SUPABASE_SERVICE_KEY.`);
if (!existsSync(FILES.schema))
  fail(
    `${FILES.schema} is missing — run \`npm run local:refresh\` first (it needs PROD_DB_URL in .env.prod-db; docs/context/24-local-dev.md, "One-time setup").`
  );
if (!existsSync(FILES.config))
  fail(
    `${FILES.config} is missing — run \`npm run local:refresh\` first (it needs PROD_DB_URL in .env.prod-db; docs/context/24-local-dev.md).`
  );

// ── 1. Docker + the local stack ──────────────────────────────────────────
await step('1. Docker and the local Supabase stack', 'stack', () => {
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0)
    fail(
      'Docker is not running. Start Docker Desktop, wait for it to settle, and run again.'
    );
  const up = () => run('npx supabase status', { stdio: 'ignore' }).status === 0;
  if (!up()) {
    console.log(
      'Local stack is not running — starting it (npx supabase start)…'
    );
    if (run('npx supabase start').status !== 0 || !up())
      fail('`npx supabase start` did not bring the local stack up.');
  }
  const running = spawnSync(
    'docker',
    ['inspect', '-f', '{{.State.Running}}', CONTAINER],
    { encoding: 'utf8' }
  ).stdout?.trim();
  if (running !== 'true')
    fail(`the database container ${CONTAINER} is not running.`);
  console.log(`Local stack up (${CONTAINER}, API port ${apiPort}).`);
});

// ── 2. Reset to an empty database ────────────────────────────────────────
await step('2. Reset the local database to empty', 'reset', () => {
  if (run('npx supabase db reset --local --no-seed').status !== 0)
    fail('`npx supabase db reset` failed.');
  const left =
    psql(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f');`);
  if (left !== '0')
    fail(
      `the reset left ${left} relations in schema public — expected an empty database.`
    );
  console.log('public is empty (auth and storage are fresh).');
});

// ── 3. Production's schema + the post-dump fixups ────────────────────────
await step('3. Load the schema (prod-schema.sql + fixups)', 'schema', () => {
  psql(readFileSync(FILES.schema, 'utf8'));
  psql(readFileSync(FILES.fixups, 'utf8'));
  const tables =
    psql(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'public' and c.relkind in ('r', 'p');`);
  console.log(`${tables} tables in public.`);
});

// ── 4. Production's setup data ───────────────────────────────────────────
await step('4. Load the setup data (prod-config.sql)', 'setup data', () => {
  // Triggers off: the dump's rows are already in their final shape.
  psql(
    `set session_replication_role = replica;\n${readFileSync(FILES.config, 'utf8')}\nset session_replication_role = origin;\n`
  );
  console.log(
    psql(
      `select 'academic years ' || (select count(*) from academic_years) || ', sections ' || (select count(*) from sections) || ', school days ' || (select count(*) from school_calendar where day_type = 'school_day');`
    )
  );
});

// ── 5. Storage bucket ────────────────────────────────────────────────────
await step('5. Storage bucket parent-portal', 'bucket', () => {
  psql(`insert into storage.buckets (id, name, public) values ('parent-portal', 'parent-portal', true)
        on conflict (id) do update set public = true;`);
  console.log('parent-portal bucket present (public).');
});

// ── 6. Migration baseline, then anything newer ───────────────────────────
await step('6. Migration baseline + local:migrate', 'migrations', () => {
  const files = readdirSync(path.resolve('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let baseline;
  if (existsSync(FILES.manifest)) {
    baseline = readFileSync(FILES.manifest, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.endsWith('.sql'));
    console.log(
      `Baseline from ${FILES.manifest}: ${baseline.length} migrations already in the dump.`
    );
  } else {
    baseline = files;
    console.log(
      `No ${FILES.manifest}: treating all ${files.length} current migration files as already in the dump. \`npm run local:refresh\` writes it next time.`
    );
  }
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  psql(
    'set client_min_messages = warning;\n' +
      'create schema if not exists local_dev;\n' +
      'create table if not exists local_dev.applied_migrations (name text primary key, applied_at timestamptz not null default now(), baseline boolean not null default false);\n' +
      'delete from local_dev.applied_migrations;\n' +
      (baseline.length
        ? `insert into local_dev.applied_migrations (name, baseline) values ${baseline.map((f) => `(${q(f)}, true)`).join(',')};\n`
        : '')
  );
  if (run('node scripts/local/migrate.mjs').status !== 0)
    fail('`npm run local:migrate` failed.');
  // PostgREST must see the new schema before the seeder talks to it.
  psql(`notify pgrst, 'reload schema';`);
});

await step(
  '   (waiting for the API to see the schema)',
  'API reload',
  async () => {
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        const res = await fetch(
          `${url.replace(/\/$/, '')}/rest/v1/academic_years?select=id&limit=1`,
          {
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
          }
        );
        if (res.ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline)
        fail('the local API did not pick up the schema within 90 seconds.');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
);

// ── 7. The seeder ────────────────────────────────────────────────────────
const seedOutput = await step(
  '7. Seed (npm run local:seed)',
  'seed',
  async () => {
    let buffer = '';
    const code = await new Promise((resolve) => {
      const child = spawn('npm run local:seed', {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const tee = (stream, sink) =>
        stream.on('data', (chunk) => {
          const s = chunk.toString();
          buffer += s;
          sink.write(s);
        });
      tee(child.stdout, process.stdout);
      tee(child.stderr, process.stderr);
      child.on('close', resolve);
    });
    if (code !== 0) fail(`the seeder failed (exit ${code}) — see above.`);
    return buffer;
  }
);

// ── Summary ──────────────────────────────────────────────────────────────
const rows = (sql) =>
  psql(sql)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split('|'));

const staff =
  rows(`select coalesce(raw_app_meta_data->'role'->>0, '?'), email from auth.users
                     where email like '%@local.test' order by 1, 2;`);
const byRole = new Map();
for (const [role, email] of staff)
  byRole.set(role, [
    ...(byRole.get(role) ?? []),
    email.replace(/@local\.test$/, ''),
  ]);
const compact = (names) => {
  const teachers = names.filter((n) => /^teacher\d+$/.test(n)).sort();
  const others = names.filter((n) => !/^teacher\d+$/.test(n));
  return [
    ...others,
    ...(teachers.length
      ? [`${teachers[0]}..${teachers.at(-1)} (${teachers.length})`]
      : []),
  ].join(', ');
};
const [[parents, parentExample]] =
  rows(`select count(*), coalesce(min(email), '-') from auth.users
                                           where raw_app_meta_data->>'local_seed' = 'parent';`);
const counts = rows(`select 'students', count(*) from students
  union all select 'class-list rows', count(*) from section_students
  union all select 'grade entries', count(*) from grade_entries
  union all select 'attendance marks', count(*) from attendance_daily
  union all select 'evaluation writeups', count(*) from evaluation_writeups
  union all select 'declarations', count(*) from student_declarations
  union all select 'P-Files revisions', count(*) from p_file_revisions
  union all select 'house point entries', count(*) from house_point_entries
  union all select 'audit_log', count(*) from audit_log;`);
const checks = seedOutput
  .split(/\r?\n/)
  .filter((l) => /check: (PASS|FAIL)|fingerprint/.test(l))
  .map((l) => l.trim());

const total = (Date.now() - started) / 1000;
const line = '-'.repeat(72);
console.log(`\n${line}\nlocal:rebuild done in ${total.toFixed(0)}s\n${line}`);
console.log(`Logins (password localdev123):`);
for (const [role, names] of byRole)
  console.log(`  ${role.padEnd(21)} ${compact(names)}  @local.test`);
console.log(
  `  ${'parent'.padEnd(21)} ${parents} accounts @example.com (e.g. ${parentExample})`
);
console.log(
  `Rows: ${counts.map(([k, n]) => `${k} ${Number(n).toLocaleString('en-US')}`).join(' · ')}`
);
console.log('Checks:');
for (const c of checks) console.log(`  ${c}`);
console.log(
  `Timings: ${timings.map(([n, s]) => `${n} ${s.toFixed(0)}s`).join(' · ')}`
);
if (checks.some((c) => /FAIL/.test(c))) fail('a check failed (see above).');
console.log(line);
