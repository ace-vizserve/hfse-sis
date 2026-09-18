// scripts/verify-reason-category-reassessment.ts
// Confirms migration 170 landed: `reassessment` is accepted, junk still isn't.
//
// HOW THIS TESTS A CHECK CONSTRAINT WITHOUT WRITING ANYTHING. Every attempt
// below carries a random `grading_sheet_id` that no row owns, so the insert can
// never succeed. What matters is WHICH error comes back:
//
//   23514 check_violation        → the CHECK rejected the reason_category
//   23503 foreign_key_violation  → the CHECK PASSED and the FK stopped it
//
// Postgres evaluates CHECK constraints while forming the tuple and fires
// foreign-key triggers afterwards, so a row violating both reports the check
// first. A foreign-key error is therefore proof the value was accepted.
//
// ⚠ THE JUNK CASE IS THE CONTROL, and it is not optional. Without it a passing
// result could equally mean the constraint is missing altogether — which is
// exactly the failure 170 was written to avoid, since dropping the old
// constraint by a guessed name would have left the column unchecked or
// double-checked with no visible difference.
//
// Usage: npx tsx --env-file=.env.local scripts/verify-reason-category-reassessment.ts

import { randomUUID } from 'node:crypto';

import { REASON_CATEGORIES } from '../lib/schemas/change-request';
import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

async function attempt(reason: string) {
  const { error } = await sb.from('grade_change_requests').insert({
    grading_sheet_id: randomUUID(),
    grade_entry_id: randomUUID(),
    field_changed: 'qa_score',
    slot_index: null,
    current_value: '0',
    proposed_value: '1',
    reason_category: reason,
    justification:
      'verification probe — never committed, FK guarantees rollback',
    requested_by: randomUUID(),
    requested_by_email: 'verify@example.invalid',
  });
  return error;
}

let failures = 0;

async function main() {
  console.log('Migration 170 — reason_category accepts `reassessment`\n');

  for (const reason of REASON_CATEGORIES) {
    const error = await attempt(reason);
    const code = error?.code ?? '(inserted?!)';
    if (code === '23503') {
      console.log(
        `  ✅ ${reason.padEnd(17)} accepted by the CHECK (stopped by the foreign key)`
      );
    } else if (code === '23514') {
      console.log(
        `  🔴 ${reason.padEnd(17)} REFUSED by the CHECK — migration 170 did not take`
      );
      failures++;
    } else {
      console.log(
        `  ⚠ ${reason.padEnd(17)} unexpected: ${code} ${error?.message ?? ''}`
      );
      failures++;
    }
  }

  // The control: a value no version of the constraint ever allowed.
  const junk = await attempt('definitely_not_a_reason');
  if (junk?.code === '23514') {
    console.log(
      '\n  ✅ control: junk is still refused, so the column IS checked ' +
        '(the test can tell the difference)'
    );
  } else {
    console.log(
      `\n  🔴 control FAILED: junk returned ${junk?.code ?? '(inserted!)'} — ` +
        'the column is not checked at all. The old constraint was dropped and ' +
        'the new one is missing.'
    );
    failures++;
  }

  // Nothing above can have written a row, but say so from the data rather
  // than from the argument.
  const { count } = await sb
    .from('grade_change_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by_email', 'verify@example.invalid');
  console.log(`\n  rows this probe left behind: ${count ?? 0}`);
  if ((count ?? 0) !== 0) failures++;

  console.log(
    failures === 0
      ? '\n✅ ALL CHECKS PASSED'
      : `\n🔴 ${failures} CHECK(S) FAILED`
  );
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
