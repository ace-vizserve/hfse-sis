// Read-only. Prints the SQL that answers spec §3.1 — is `audit_log` in the
// `supabase_realtime` publication? `pg_publication_tables` lives in
// pg_catalog, which PostgREST cannot read, so this prints rather than queries.
//
// Usage: npx tsx --env-file=.env.local scripts/probe-realtime-publication.ts

const SQL = `select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;`;

function main() {
  console.log('Run this in the Supabase SQL editor:\n');
  console.log(SQL);
  console.log(
    '\nThe repo adds exactly three tables (migrations 010, 129, 145):'
  );
  console.log(
    '  grade_change_requests, approval_request_stages, approval_request_stage_decisions'
  );
  console.log('\nWhat the answer means:');
  console.log(
    '  audit_log ABSENT  -> the P-Files awaiting-verification badge has never'
  );
  console.log(
    '                       updated live. Migration 171 fixes it for free, because'
  );
  console.log(
    '                       a trigger does not need the publication at all.'
  );
  console.log(
    '  audit_log PRESENT -> it was added by hand in the dashboard. The publication'
  );
  console.log(
    '                       has drifted from the migrations, and Task 8 must drop'
  );
  console.log(
    '                       what is actually there, not the three statements in the repo.'
  );
  console.log('\nRecord the answer in spec §3.1 before starting Task 8.');
}

main();
