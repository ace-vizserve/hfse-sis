// scripts/verify-teacher-role-grants.ts
//
// Read-only. Confirms that the teaching admins named in the school's
// deployment workbook actually hold `teacher` alongside their admin role, and
// — the part that matters — that the grant is SHAPED CORRECTLY.
//
// ⚠ WHY THIS EXISTS RATHER THAN TRUSTING THE SCREEN. A role list saved with no
// `active_role` is a LOCKOUT, not a cosmetic defect (KD #206). `->> 'role'` on
// a JSON array returns the literal text `["school_admin","teacher"]` rather
// than null, so a naive read hands that back as the role, the account resolves
// to a non-role, and this app reads a non-role as PARENT — which has no surface
// here and is redirected to /login. The person cannot get in, and the screen
// that granted it looked fine.
//
// So this checks three things per account, not one:
//   1. `role` is a LIST (a plain string means the grant did not happen).
//   2. `active_role` is a STRING and is PRESENT.
//   3. `active_role` is a MEMBER of `role` — a list and an active role that
//      disagree is the same lockout wearing a hat.
//
// Run:
//   npx tsx --env-file=.env.local scripts/verify-teacher-role-grants.ts
import { createServiceClient } from '../lib/supabase/service';
import { listAllAuthUsers } from '../lib/supabase/paginate';

// The six the 29 Jun workbook deploys as teachers while their accounts were
// created under an admin role. Koh Suat Hoon was granted earlier and is kept
// here as the known-good control: if she fails, the check itself is wrong.
const EXPECTED: { email: string; label: string }[] = [
  { email: 'mae.juni@hfse.edu.sg', label: 'Marrie Aines Juni' },
  { email: 'melissa.balantac@hfse.edu.sg', label: 'Melissa Balantac' },
  { email: 'lhen.mendoza@hfse.edu.sg', label: 'Hermilita Mendoza' },
  { email: 'chandana.dileep@hfse.edu.sg', label: 'Chandana Dileep' },
  { email: 'muhammad.hanafi@hfse.edu.sg', label: 'Muhammad Hanafi' },
  { email: 'kohsuat.hoon@hfse.edu.sg', label: 'Koh Suat Hoon (control)' },
];

async function main() {
  const service = createServiceClient();
  const users = await listAllAuthUsers(service);
  const byEmail = new Map(
    users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u])
  );

  let bad = 0;

  for (const { email, label } of EXPECTED) {
    const u = byEmail.get(email.toLowerCase());
    if (!u) {
      console.log(`✗ ${label.padEnd(26)} no account for ${email}`);
      bad++;
      continue;
    }

    const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
    const role = meta.role;
    const active = meta.active_role;

    const problems: string[] = [];
    if (!Array.isArray(role)) {
      problems.push(
        `role is ${JSON.stringify(role)} — not a list, so no grant happened`
      );
    } else {
      if (!role.includes('teacher'))
        problems.push('list does not include teacher');
      if (typeof active !== 'string') {
        problems.push('active_role missing — THIS IS A LOCKOUT');
      } else if (!role.includes(active)) {
        problems.push(`active_role "${active}" is not in the list — LOCKOUT`);
      }
    }

    const shown = `role=${JSON.stringify(role)} active_role=${JSON.stringify(active ?? null)}`;
    if (problems.length === 0) {
      console.log(`✓ ${label.padEnd(26)} ${shown}`);
    } else {
      console.log(`✗ ${label.padEnd(26)} ${shown}`);
      problems.forEach((p) => console.log(`    ${p}`));
      bad++;
    }
  }

  console.log(
    bad === 0
      ? '\nAll six grants are correctly shaped. They each need to sign out and back in before the switcher appears — getClaims() verifies the existing JWT locally and never re-mints it.'
      : `\n${bad} account(s) need attention. Nothing was changed; this script only reads.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
