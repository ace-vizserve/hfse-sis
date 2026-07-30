// scripts/audit-role-permissions.ts
//
// Compares the LIVE `public.role_permissions` table against
// DEFAULT_ROLE_CAPABILITIES in lib/auth/capabilities.ts, and reports every
// difference in both directions.
//
// Why this exists. Once role_permissions holds rows it is authoritative and is
// NOT merged with the code defaults (KD #166 — merging would make a
// deliberately-revoked capability un-revokable). That is the right behaviour,
// but it means the live authorization model can drift away from every file in
// this repo and nothing notices: the existing test only proves the SEED
// MIGRATIONS match the defaults, which says nothing about what the table
// actually holds after someone edits grants in /sis/admin/roles — or runs a
// throwaway script. A `scripts/tmp-grant-coord-full.ts` appears in this repo's
// command allowlist, was never committed, and is not on disk; if it ever ran
// against production, this is the only thing that would surface it.
//
// STRICTLY READ-ONLY. It issues one SELECT and writes nothing, so it is safe
// to point at production.
//
// Run:
//   npx tsx --env-file=.env.local scripts/audit-role-permissions.ts
//
// Exit code is 0 when the table matches the defaults, 1 when it does not, so
// it can be wired into CI or a cron later without modification.
import {
  DEFAULT_ROLE_CAPABILITIES,
  isCapability,
} from '../lib/auth/capabilities';
import { ROLES } from '../lib/auth/roles';
import { createServiceClient } from '../lib/supabase/service';

type Row = { role: string; capability: string };

const key = (role: string, capability: string) => `${role}|${capability}`;

async function main() {
  const service = createServiceClient();
  const { data, error } = await service
    .from('role_permissions')
    .select('role, capability');

  if (error) {
    console.error(`\n  Could not read role_permissions: ${error.message}`);
    console.error(
      '  If the table does not exist, migration 101 has not been applied —\n' +
        '  in which case every gate is running on the built-in defaults.\n'
    );
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];

  if (rows.length === 0) {
    console.log(
      '\n  role_permissions is EMPTY.\n\n' +
        '  Not an error in itself — the permission map falls back to the code\n' +
        '  defaults when the table has no rows, so the app behaves exactly as\n' +
        '  DEFAULT_ROLE_CAPABILITIES describes. But no grant made in\n' +
        '  /sis/admin/roles has ever been saved, and the seed migrations have\n' +
        '  not been applied.\n'
    );
    process.exit(1);
  }

  const live = new Set(rows.map((r) => key(r.role, r.capability)));
  const expected = new Set(
    ROLES.flatMap((role) =>
      DEFAULT_ROLE_CAPABILITIES[role].map((c) => key(role, c))
    )
  );

  // In the code, absent from the table. These are NOT in force: the table wins.
  const missing = [...expected].filter((k) => !live.has(k)).sort();
  // In the table, absent from the code. These ARE in force, and no file in the
  // repo says so.
  const extra = [...live].filter((k) => !expected.has(k)).sort();
  // Granted in the table but naming a capability nothing gates on — a
  // permission that looks granted and enforces nothing.
  const unknown = rows
    .filter((r) => !isCapability(r.capability))
    .map((r) => key(r.role, r.capability))
    .sort();
  // A role the code no longer knows. getCapabilitiesForRole ignores these.
  const unknownRoles = [
    ...new Set(
      rows.filter((r) => !ROLES.includes(r.role as never)).map((r) => r.role)
    ),
  ].sort();

  console.log(
    `\n  role_permissions: ${rows.length} rows across ${
      new Set(rows.map((r) => r.role)).size
    } roles`
  );
  console.log(`  code defaults:    ${expected.size} grants\n`);

  const show = (label: string, items: string[], note: string) => {
    if (items.length === 0) return;
    console.log(`  ${label} (${items.length})`);
    console.log(`    ${note}`);
    for (const item of items) {
      const [role, capability] = item.split('|');
      console.log(`      ${role.padEnd(22)} ${capability}`);
    }
    console.log('');
  };

  show(
    'IN THE TABLE, NOT IN THE CODE',
    extra,
    'These are LIVE and no file in the repo declares them. Either add them to\n' +
      '    DEFAULT_ROLE_CAPABILITIES with a seed migration, or revoke them.'
  );
  show(
    'IN THE CODE, NOT IN THE TABLE',
    missing,
    'These are NOT in force — the table wins. Either a seed migration was\n' +
      '    never applied, or someone revoked them in /sis/admin/roles.'
  );
  show(
    'GRANTED BUT UNGATED',
    unknown,
    'The capability string matches nothing the code checks, so it enforces\n' +
      '    nothing. Left over from a rename or a typo.'
  );

  if (unknownRoles.length > 0) {
    console.log(`  UNKNOWN ROLES (${unknownRoles.length})`);
    console.log(
      '    Rows for roles the code no longer knows; they are ignored.'
    );
    for (const role of unknownRoles) console.log(`      ${role}`);
    console.log('');
  }

  const clean =
    extra.length === 0 &&
    missing.length === 0 &&
    unknown.length === 0 &&
    unknownRoles.length === 0;

  console.log(
    clean
      ? '  MATCHES. The live permission model is exactly what the code declares.\n'
      : '  DRIFT. The live permission model differs from the code — see above.\n'
  );
  process.exit(clean ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
