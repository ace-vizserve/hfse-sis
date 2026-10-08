// Refreshes the local baseline from production — the rare job, in one command:
//
//   npm run local:refresh
//
//   1. production's STRUCTURE  → supabase/prod-schema.sql        (supabase db dump)
//   2. production's SETUP data → supabase/prod-config.sql        (pull-prod-config.mjs)
//   3. which migrations production already has → supabase/prod-schema.migrations.txt
//
// Then run `npm run local:rebuild` to rebuild the local database from them.
// Reads only from production (structure + setup tables, never students); all
// three files are git-ignored. Needs PROD_DB_URL in .env.prod-db and Docker
// Desktop running. Run it with your checkout on the commit production is on,
// so step 3 records the right migrations.
import { spawnSync } from 'node:child_process';

const url = process.env.PROD_DB_URL;
if (!url) {
  console.error(
    'Put PROD_DB_URL (the production connection string) in .env.prod-db first.'
  );
  process.exit(1);
}

function run(label, cmd, args, { shell = false } = {}) {
  console.log(`\n▸ ${label}`);
  const res = shell
    ? spawnSync([cmd, ...args].join(' '), { stdio: 'inherit', shell: true })
    : spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`✗ ${label} failed.`);
    process.exit(res.status ?? 1);
  }
}

// npx is a .cmd shim on Windows, which Node only launches through a shell, so
// the arguments are quoted here.
run(
  'Structure: production schema → supabase/prod-schema.sql',
  'npx',
  [
    'supabase',
    'db',
    'dump',
    '--db-url',
    `"${url}"`,
    '-f',
    'supabase/prod-schema.sql',
  ],
  { shell: true }
);
run('Setup data: production setup tables → supabase/prod-config.sql', 'node', [
  'scripts/local/pull-prod-config.mjs',
]);
run(
  'Migrations already in production → supabase/prod-schema.migrations.txt',
  'node',
  ['scripts/local/baseline.mjs']
);

console.log('\nBaseline refreshed. Next: npm run local:rebuild');
