// Phase "wipe": delete every piece of PEOPLE data on the local stack so a
// rebuild starts from the same place every time. Setup data copied from
// production (`npm run local:refresh`) is kept, as are the tables nothing
// local ever writes.
//
// ⚠ THE TABLE LIST IS READ FROM THE LOCAL SCHEMA, NOT HAND-KEPT. A table a
// future migration adds is wiped by default — so a new SETUP table must be
// added to KEEP below, or a rebuild will empty it. The run prints exactly what
// it truncates and what it keeps.

import { service, sql, sqlRows } from '../lib/local';
import { LOCAL_EMAIL_DOMAIN, LOCAL_PARENT_MARK } from '../lib/constants';

/** Setup data copied from production. Never written by the seeder. */
export const SETUP_TABLES = [
  'academic_years',
  'terms',
  'levels',
  'level_aliases',
  'subjects',
  'subject_configs',
  'subject_level_offerings',
  'subject_report_map',
  'sections',
  'section_subjects',
  'school_config',
  'school_calendar',
  'calendar_events',
  'evaluation_terms',
  'role_permissions',
  'houses',
  'house_point_scales',
  'admission_options',
  'approval_stages',
] as const;

/**
 * Out of scope for the seeder and not people data: neither written nor wiped.
 *
 * ⚠ The dormant PTC tables (`evaluation_checklist_*`,
 * `evaluation_subject_comments`, `evaluation_ptc_feedback`) are ALSO never
 * written, but they ARE wiped: they reference `students`, so they must be
 * truncated together with it. They are empty everywhere; the truncate is a
 * no-op on them.
 */
const NEVER_WRITTEN = ['subject_weight_reconciliation_log'] as const;

/** Other systems sharing the database. Never touched. */
const FOREIGN_PREFIXES = ['directus_', 'careers_'] as const;

const STORAGE_BUCKETS = ['parent-portal'] as const;

function isKept(table: string): boolean {
  return (
    (SETUP_TABLES as readonly string[]).includes(table) ||
    (NEVER_WRITTEN as readonly string[]).includes(table) ||
    FOREIGN_PREFIXES.some((p) => table.startsWith(p))
  );
}

/** Every base table in `public`, split into wiped and kept. */
export function classifyTables(): { wipe: string[]; keep: string[] } {
  const all = sqlRows(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`
  ).map((r) => r[0]);
  const wipe = all.filter((t) => !isKept(t));
  const keep = all.filter(isKept);
  // Every setup table must exist — a missing one means the pull-config step
  // did not run, and the seeder would build on nothing.
  const missing = SETUP_TABLES.filter((t) => !all.includes(t));
  if (missing.length) {
    throw new Error(`Setup tables missing locally: ${missing.join(', ')}`);
  }
  return { wipe, keep };
}

/**
 * Every column in a KEPT table with a foreign key to auth.users, read from
 * pg_constraint. A seeded account can end up in one (a local login editing
 * school_config stamps `updated_by`); whatever the FK's ON DELETE rule, it is
 * nulled before the account is deleted — NO ACTION would refuse the delete,
 * CASCADE would delete setup rows. A NOT NULL column here fails loudly.
 */
export function keptUserRefs(
  keep: string[]
): Array<{ table: string; column: string }> {
  return sqlRows(
    `select c.conrelid::regclass::text, a.attname
       from pg_constraint c
       join unnest(c.conkey) as k(attnum) on true
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f'
        and c.confrelid = 'auth.users'::regclass
        and c.connamespace = 'public'::regnamespace
      order by 1, 2`
  )
    .map(([table, column]) => ({
      table: table.replace(/^public\./, '').replace(/^"(.*)"$/, '$1'),
      column,
    }))
    .filter((r) => keep.includes(r.table));
}

async function wipeStorage(): Promise<number> {
  const sb = service();
  let removed = 0;
  for (const bucket of STORAGE_BUCKETS) {
    const names = sqlRows(
      `select name from storage.objects where bucket_id = '${bucket}' order by name`
    ).map((r) => r[0]);
    // Through the Storage API, not SQL: Supabase refuses direct deletes from
    // storage.objects, and the API also removes the files themselves.
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const { error } = await sb.storage.from(bucket).remove(chunk);
      if (error) throw new Error(`storage ${bucket}: ${error.message}`);
      removed += chunk.length;
    }
  }
  return removed;
}

export async function runWipe(): Promise<void> {
  const { wipe, keep } = classifyTables();

  const refs = keptUserRefs(keep);
  // Seeded accounts: the staff (@local.test) and the parent logins the
  // declarations phase creates — those must carry the admissions record's
  // parent address to be linked to a child, so they are marked by
  // `app_metadata.local_seed = 'parent'` instead of by domain.
  const seededWhere = `email like '%@${LOCAL_EMAIL_DOMAIN}' or raw_app_meta_data->>'${LOCAL_PARENT_MARK.key}' = '${LOCAL_PARENT_MARK.value}'`;
  const seeded = `select id from auth.users where ${seededWhere}`;

  // ONE transaction: the people tables, the kept tables' pointers at seeded
  // accounts, and the seeded accounts themselves. Either all of it lands or
  // none of it does — a failure part-way can no longer leave the people
  // tables empty with the old accounts still there.
  //   * No CASCADE: if some KEPT table referenced a wiped one, Postgres would
  //     refuse rather than silently empty the kept table too.
  //   * RESTART IDENTITY: serial ids start from 1 again, so two rebuilds are
  //     comparable row for row.
  //   * session_replication_role = replica for the truncate and the nulling:
  //     user triggers (append-only guards, realtime broadcasts, updated_at
  //     stamps on setup rows) stay quiet.
  //   * Back to `origin` for the auth.users delete, so foreign keys are
  //     enforced and its cascades (identities, sessions, refresh tokens) run.
  //     A kept-table pointer the nulling missed fails the whole transaction.
  const list = wipe.map((t) => `public."${t}"`).join(', ');
  const nulling = refs
    .map(
      (r) =>
        `update public."${r.table}" set "${r.column}" = null where "${r.column}" in (${seeded});`
    )
    .join('\n');
  const users = sql(`begin;
set local session_replication_role = replica;
truncate ${list} restart identity;
${nulling}
set local session_replication_role = origin;
with d as (delete from auth.users where ${seededWhere} returning 1)
  select count(*) from d;
commit;`);

  // Storage goes through the API (not SQL), so it cannot join the
  // transaction; it runs once the database part has committed.
  const files = await wipeStorage();

  console.log(`  wiped ${wipe.length} tables: ${wipe.join(', ')}`);
  console.log(
    `  nulled seeded-account pointers in ${refs.length} kept columns: ${refs.map((r) => `${r.table}.${r.column}`).join(', ') || '(none)'}`
  );
  console.log(
    `  kept ${keep.length} tables (setup, out-of-scope, directus_*, careers_*)`
  );
  console.log(
    `  removed ${users} seeded auth users (@${LOCAL_EMAIL_DOMAIN} staff + seeded parents), ${files} storage objects`
  );
}
