// Read-only. Prints the SQL that proves migration 171 landed. Triggers,
// functions and policies live in pg_catalog, which PostgREST cannot read — the
// same wall migration 140's verification hit.
//
// Usage: npx tsx --env-file=.env.local scripts/verify-broadcast-badge-migration.ts

export {}; // force module scope: no import/export otherwise, and this file's
// top-level `SQL`/`main` collide with the same names in
// probe-realtime-publication.ts under tsc's global-script parsing.

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
where schemaname = 'realtime' and tablename = 'messages' and policyname = 'sis badge topics';

-- POST-APPLY SMOKE CHECK. Run this ONLY after touching a row in
-- grade_change_requests (insert or update) within the last 5 minutes. The
-- three queries above prove the catalog objects exist; this is the only one
-- that proves a ping actually LANDS in realtime.messages. Both trigger
-- functions swallow their own exceptions (Hard Rule #6 — a badge ping must
-- never break the write beneath it), so a permissions or signature failure on
-- realtime.send produces no client error and no row here, only a Postgres
-- WARNING in the database logs.
select count(*), max(inserted_at)
from realtime.messages
where topic = 'sis:grade-change-requests'
  and inserted_at > now() - interval '5 minutes';`;

function main() {
  console.log('Run this in the Supabase SQL editor after applying 171:\n');
  console.log(SQL);
  console.log('\nPASS means: 4 triggers, 2 functions both reading true for');
  console.log('swallows_exceptions, and 1 policy. Anything less and Tasks 4-6');
  console.log('will produce badges that never move.');
  console.log('\nFor the smoke check: zero rows means the pipe is DEAD even');
  console.log('though every catalog object above checks out. The likely cause');
  console.log("is the security-definer function's owner being unable to");
  console.log(
    'INSERT into realtime.messages — check the Postgres logs for the'
  );
  console.log(
    '"broadcast_badge_ping failed on topic ...: ..." warning it raises'
  );
  console.log('on every swallowed exception.');
}

main();
