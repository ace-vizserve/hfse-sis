// Records which migration files production's schema dump already contains.
//
// Step 3 of `npm run local:refresh` (scripts/local/refresh.mjs), right after
// the schema dump and the setup-data pull; run with your checkout at the
// commit production is on. It writes supabase/prod-schema.migrations.txt — every file in
// supabase/migrations at that moment, one per line (git-ignored, like the
// dumps). `npm run local:rebuild` marks exactly those as already applied and
// then runs `npm run local:migrate`, which applies only the newer files.
//
// Touches no database.
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const files = readdirSync(path.resolve('supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const out = path.resolve('supabase/prod-schema.migrations.txt');
writeFileSync(out, `${files.join('\n')}\n`);
console.log(
  `Wrote supabase/prod-schema.migrations.txt: ${files.length} migrations (last ${files.at(-1)}) recorded as already in the schema dump.`
);
