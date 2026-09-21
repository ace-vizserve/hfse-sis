import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/171_realtime_broadcast_badges.sql'),
  'utf8'
);

describe('migration 171 — broadcast badge triggers', () => {
  it('swallows exceptions in every trigger function', () => {
    // A failed broadcast must never roll back the write beneath it. audit_log
    // takes a row on every grade entry (Hard Rule #6, append-only).
    const handlers = SQL.match(/exception\s+when\s+others\s+then/gi) ?? [];
    expect(handlers.length).toBe(2);
  });

  it('gates the audit_log trigger on the six P-Files actions in a WHEN clause', () => {
    // The WHEN clause is what keeps a grade-entry audit row out of the
    // function entirely. Without it the filter would run per row in plpgsql.
    const when = SQL.match(/when\s*\(\s*new\.action\s+in\s*\(([^)]*)\)/i);
    expect(when).not.toBeNull();
    for (const action of [
      'pfile.upload',
      'pfile.reminder.sent',
      'sis.document.approve',
      'sis.document.reject',
      'sis.documents.auto-expire',
      'sis.documents.auto-revive',
    ]) {
      expect(when![1]).toContain(action);
    }
  });

  it('removes nothing from the supabase_realtime publication', () => {
    // Both transports stay live so reverting the client commit is a complete
    // rollback. Publication cleanup is its own migration, gated on a browser
    // verification.
    expect(SQL).not.toMatch(
      /drop\s+table|publication\s+supabase_realtime\s+drop/i
    );
  });

  it('the trigger WHEN clause matches the constant in use-realtime-badges.ts exactly, both directions', () => {
    const hook = readFileSync(
      join(process.cwd(), 'lib/sidebar/use-realtime-badges.ts'),
      'utf8'
    );
    const block = hook.match(/PFILE_VERIFICATION_ACTIONS\s*=\s*\[([\s\S]*?)\]/);
    expect(block).not.toBeNull();
    const actions = new Set(
      [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    );

    const when = SQL.match(/when\s*\(\s*new\.action\s+in\s*\(([^)]*)\)/i);
    expect(when).not.toBeNull();
    const sqlActions = new Set(
      [...when![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    );

    // Set equality, checked both directions, so a divergence in EITHER file
    // fails on its own terms instead of silently passing (an action added to
    // the SQL alone) or reporting a length mismatch that hides which value is
    // wrong (an action added to the TypeScript constant alone).
    const missingFromSQL = [...actions].filter((a) => !sqlActions.has(a));
    const missingFromTS = [...sqlActions].filter((a) => !actions.has(a));

    expect(
      missingFromSQL,
      `Action(s) present in PFILE_VERIFICATION_ACTIONS (use-realtime-badges.ts) but missing from migration 171's WHEN clause: ${missingFromSQL.join(', ')}`
    ).toEqual([]);
    expect(
      missingFromTS,
      `Action(s) present in migration 171's WHEN clause but missing from PFILE_VERIFICATION_ACTIONS (use-realtime-badges.ts): ${missingFromTS.join(', ')}`
    ).toEqual([]);
  });
});

describe('migration 171 — realtime.messages policy role lists', () => {
  // ⚠ THE APPROVAL-STAGES ASYMMETRY IS INTENTIONAL — DO NOT "FIX" IT.
  // `sis:approval-stages` deliberately admits GATE_ROLES *plus* `admissions`,
  // even though `sis:grade-change-requests` admits GATE_ROLES alone. Per the
  // migration's own comment (around line 136) and the design doc §4.2/§4.3:
  // `useStagedApprovalCount` is NOT role-scoped anywhere else in the app —
  // being an approver is decided by sitting ON an approval step, not by
  // holding a role — and both the admissions and p-files layouts seed that
  // count for `admissions` accounts unconditionally. Narrowing this branch to
  // exactly GATE_ROLES would lock admissions accounts out of a badge they are
  // supposed to see.
  it('the grade-change-requests branch matches GATE_ROLES exactly', () => {
    const { gateRoles, sqlRoles } = readGateRolesAndBranch(
      'sis:grade-change-requests'
    );
    assertRoleSetsEqual(
      gateRoles,
      sqlRoles,
      'GATE_ROLES',
      "sis:grade-change-requests' WHEN branch"
    );
  });

  it('the approval-stages branch matches GATE_ROLES plus admissions (deliberate asymmetry)', () => {
    const { gateRoles, sqlRoles } = readGateRolesAndBranch(
      'sis:approval-stages'
    );
    const expected = new Set([...gateRoles, 'admissions']);
    assertRoleSetsEqual(
      expected,
      sqlRoles,
      "GATE_ROLES + 'admissions'",
      "sis:approval-stages' WHEN branch"
    );
  });

  it('the pfile-verification branch matches PFILE_BADGE_ROLES exactly', () => {
    const bell = readFileSync(
      join(process.cwd(), 'lib/sidebar/use-realtime-badges.ts'),
      'utf8'
    );
    const block = bell.match(
      /PFILE_BADGE_ROLES\s*:\s*Role\[\]\s*=\s*\[([\s\S]*?)\]/
    );
    expect(block).not.toBeNull();
    const pfileRoles = new Set(
      [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    );

    const sqlRoles = extractSqlBranchRoles('sis:pfile-verification');
    assertRoleSetsEqual(
      pfileRoles,
      sqlRoles,
      'PFILE_BADGE_ROLES',
      "sis:pfile-verification' WHEN branch"
    );
  });
});

// --- helpers -----------------------------------------------------------

function extractSqlBranchRoles(topic: string): Set<string> {
  // Each branch looks like:
  //   when realtime.topic() = '<topic>'
  //     then public.current_user_role() in (
  //       'role-a', 'role-b'
  //     )
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `when\\s+realtime\\.topic\\(\\)\\s*=\\s*'${escaped}'\\s*\\n?\\s*then\\s+public\\.current_user_role\\(\\)\\s+in\\s*\\(([^)]*)\\)`,
    'i'
  );
  const match = SQL.match(re);
  expect(
    match,
    `Could not find a WHEN branch for topic "${topic}" in migration 171`
  ).not.toBeNull();
  return new Set([...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

function readGateRolesAndBranch(topic: string): {
  gateRoles: Set<string>;
  sqlRoles: Set<string>;
} {
  const bell = readFileSync(
    join(process.cwd(), 'components/notifications/notification-bell.tsx'),
    'utf8'
  );
  const block = bell.match(/GATE_ROLES\s*:\s*Role\[\]\s*=\s*\[([\s\S]*?)\]/);
  expect(block).not.toBeNull();
  const gateRoles = new Set(
    [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  );
  return { gateRoles, sqlRoles: extractSqlBranchRoles(topic) };
}

function assertRoleSetsEqual(
  expected: Set<string>,
  actual: Set<string>,
  expectedLabel: string,
  actualLabel: string
): void {
  const missingFromActual = [...expected].filter((r) => !actual.has(r));
  const missingFromExpected = [...actual].filter((r) => !expected.has(r));

  expect(
    missingFromActual,
    `Role(s) in ${expectedLabel} but missing from ${actualLabel}: ${missingFromActual.join(', ')}`
  ).toEqual([]);
  expect(
    missingFromExpected,
    `Role(s) in ${actualLabel} but missing from ${expectedLabel}: ${missingFromExpected.join(', ')}`
  ).toEqual([]);
}
