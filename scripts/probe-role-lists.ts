// Read-only: which staff accounts hold a ROLE LIST rather than a single role?
// A list is what makes the module switcher appear (KD #206).
//
// Usage: npx tsx --env-file=.env.local scripts/probe-role-lists.ts

import { createServiceClient } from '../lib/supabase/service';

const sb = createServiceClient();

async function main() {
  const users: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await (sb.auth as any).admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    if (!data.users.length) break;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  const staff = users
    .filter((u) => {
      const r = u.app_metadata?.role ?? u.app_metadata?.roles;
      return r !== undefined && r !== null;
    })
    .sort((a, b) => String(a.email).localeCompare(String(b.email)));

  const lists = staff.filter((u) => {
    const r = u.app_metadata?.role ?? u.app_metadata?.roles;
    return Array.isArray(r) && r.length > 1;
  });

  console.log(`accounts with any role : ${staff.length}`);
  console.log(
    `accounts with a LIST of 2+ (switcher visible) : ${lists.length}\n`
  );
  for (const u of lists) {
    const r = u.app_metadata?.role ?? u.app_metadata?.roles;
    console.log(`  ${String(u.email).padEnd(40)} ${JSON.stringify(r)}`);
  }

  console.log(
    '\nSingle-role accounts that ALSO teach (candidates for a list):'
  );
  for (const u of staff) {
    const r = u.app_metadata?.role ?? u.app_metadata?.roles;
    const single = !Array.isArray(r) || r.length === 1;
    if (single) {
      console.log(`  ${String(u.email).padEnd(40)} ${JSON.stringify(r)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
