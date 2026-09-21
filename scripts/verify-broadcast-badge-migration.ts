// Read-only. Prints the SQL that proves migration 171 landed. Triggers,
// functions and policies live in pg_catalog, which PostgREST cannot read — the
// same wall migration 140's verification hit.
//
// Usage: npx tsx --env-file=.env.local scripts/verify-broadcast-badge-migration.ts

const SQL = `-- expect 4 rows
select tgname, tgrelid::regclass as table_name
from pg_trigger
where tgname like 'broadcast_badge_%' and not tgisinternal
order by tgname;

-- expect 2 rows, both with an EXCEPTION block
select proname, prosrc ilike '%exception when others%' as swallows_exceptions
from pg_proc
where proname in ('broadcast_badge_ping', 'broadcast_badge_ping_for_user')
order by proname;

-- expect 1 row
select policyname, cmd
from pg_policies
where schemaname = 'realtime' and tablename = 'messages' and policyname = 'sis badge topics';`;

function main() {
  console.log('Run this in the Supabase SQL editor after applying 171:\n');
  console.log(SQL);
  console.log('\nPASS means: 4 triggers, 2 functions both reading true for');
  console.log('swallows_exceptions, and 1 policy. Anything less and Tasks 4-6');
  console.log('will produce badges that never move.');
}

main();
