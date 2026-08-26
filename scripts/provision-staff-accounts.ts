// scripts/provision-staff-accounts.ts
// Bulk-provisions HFSE staff accounts ahead of training + live production
// use, and writes an .xlsx credential handout (one tab per role group).
//
// Why a script and not a migration: staff accounts exist ONLY in auth.users
// (there is no staff/profiles table), and auth.users is GoTrue-owned. No
// migration in this repo has ever inserted into it — the only sanctioned SQL
// touch is jsonb_set on raw_app_meta_data for role renames (039, 092).
// Hand-rolling bcrypt + auth.identities rows in SQL risks silent sign-in
// failure on a GoTrue upgrade, and would commit plaintext passwords to git.
// So this calls the exact same Auth Admin API contract the live UI uses at
// app/api/sis/admin/users/route.ts:59-66.
//
// Run (preview — creates nothing):
//   npx tsx --env-file=.env.local scripts/provision-staff-accounts.ts --actor=<superadmin-email>
// Run (apply):
//   npx tsx --env-file=.env.local scripts/provision-staff-accounts.ts --actor=<superadmin-email> --apply
//
// Repair a real account whose temporary password is on no handout:
//   ... --actor=<superadmin-email> --apply --reset-unknown
//
// Idempotent: an account that already exists is SKIPPED, never
// password-reset — clobbering a working password is worse than a gap. The
// sole exception is --reset-unknown, which only touches accounts with NO
// recoverable password (such an account cannot be signed into at all, so a
// reset is the only repair).
//
// Output is ONE workbook, scripts/provision-output/HFSE-Staff-Accounts.xlsx,
// rewritten each run and always complete: passwords issued by earlier runs
// are read back out of the previous handouts rather than left blank, so
// whoever distributes credentials never has to reconcile several files.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

import { logAction } from '../lib/audit/log-action';
import { getUserRole } from '../lib/auth/roles';
import { InviteUserSchema } from '../lib/schemas/user-admin';
import { createServiceClient } from '../lib/supabase/service';
import { listAllAuthUsers } from '../lib/supabase/paginate';
import {
  buildCredentialWorkbook,
  readIssuedPasswords,
  type CredentialRow,
} from '../lib/sis/provisioning/credential-workbook';
import { generateTempPassword } from '../lib/sis/provisioning/temp-password';

type RosterEntry = {
  fullName: string;
  email: string;
  // Must be a member of the Role union in lib/auth/roles.ts. Validated at
  // runtime by InviteUserSchema before any account is created.
  role: string;
  // Tab this person's credentials land on. Every group maps to exactly one
  // role — school_admin is split by department because that is how the
  // sheets are actually handed out.
  group: string;
};

// ─── The roster ───────────────────────────────────────────────────────────
// Group order here decides tab order in the workbook.
const ROSTER: RosterEntry[] = [
  // Superadmin — IT/technical lead + CEO, system config break-glass (KD #2).
  {
    fullName: 'Gary Cacananta',
    email: 'gary.cacananta@hfse.edu.sg',
    role: 'superadmin',
    group: 'Superadmin',
  },
  {
    fullName: 'Ninalyn Cacananta',
    email: 'nina.cacananta@hfse.edu.sg',
    role: 'superadmin',
    group: 'Superadmin',
  },

  // School admin — the consolidated cross-cutting generalist (KD #2/#39).
  // Academics side.
  {
    fullName: 'Christina Labrador',
    email: 'tin.labrador@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Academics',
  },
  {
    fullName: 'Koh Suat Hoon',
    email: 'kohsuat.hoon@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Academics',
  },
  {
    fullName: 'Marrie Aines Juni',
    email: 'mae.juni@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Academics',
  },
  {
    fullName: 'Melissa Balantac',
    email: 'melissa.balantac@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Academics',
  },
  {
    fullName: 'Hermilita Mendoza',
    email: 'lhen.mendoza@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Academics',
  },
  {
    fullName: 'Chandana Dileep',
    email: 'chandana.dileep@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Academics',
  },

  // School admin — admissions + enrollment side. Same role, different desk.
  {
    fullName: 'Jill Sulit',
    email: 'jill.sulit@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Admissions',
  },
  {
    fullName: 'Wynne Lynn Faustino',
    email: 'wynne.faustino@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Admissions',
  },
  {
    fullName: 'Rosella Ronquillo',
    email: 'rosella.ronquillo@hfse.edu.sg',
    role: 'school_admin',
    group: 'School Admin - Admissions',
  },

  // Admissions — the funnel team. Reaches /admissions/* plus the single
  // cross-module discount-codes page, nothing else (KD #133).
  {
    fullName: 'Apple Grace Obias',
    email: 'applegrace.obias@hfse.edu.sg',
    role: 'admissions',
    group: 'Admissions',
  },
  {
    fullName: 'Charlene Pagayon Rosco',
    email: 'charlene.rosco@hfse.edu.sg',
    role: 'admissions',
    group: 'Admissions',
  },

  // P-Files officer — the renewals officer. Module-scoped: reaches /p-files
  // and nothing else (KD #2/#31). Sole holder of this role.
  {
    fullName: 'Louilyn Gutierrez',
    email: 'louilyn.gutierrez@vizserve.hfse.edu.sg',
    role: 'p_file_officer',
    group: 'P-Files Officer',
  },

  // ── Teachers ───────────────────────────────────────────────────────────
  //
  // Added 2026-08-26, from the `Teachers List` sheet of
  // "Teachers Deployment_Updated 29 Jun 26_Teacherscopy (1).xlsx" (26 names,
  // 24 with school addresses). Until these exist, importing that workbook's
  // ~147 assignments resolves almost nothing: a dry run matched 20 of 23
  // classes and still had to skip 90 rows for "no account".
  //
  // ⚠ SIX OF THE 26 ARE DELIBERATELY ABSENT: Koh Suat Hoon, Marrie Aines
  // Juni, Melissa Balantac, Hermilita Mendoza, Chandana Dileep and Muhammad
  // Hanafi Bin Rubaai already hold `school_admin`. This script skips an
  // existing account rather than resetting it, so listing them again would
  // change nothing — but it would read as though they were being demoted to
  // `teacher`, which they are not. They teach AND hold their admin role;
  // teaching assignments are rows in `teacher_assignments`, not a role.
  //
  // ⚠ Mr Hanafi was briefly listed here as a `teacher` on the reasoning that
  // the workbook shows him teaching PE across Sec 1–4 plus primary STAR. The
  // preview caught it: he ALREADY has an account holding `school_admin`, so
  // the entry only produced a MISMATCH warning on every run. It also settles a
  // question raised at the time — booking cover needs `staff.manage_relief`,
  // which `teacher` does not carry and `school_admin` does, so the cover board
  // is already his.
  //
  // ⚠ TWO CANNOT BE PROVISIONED AT ALL: Ms Jasmine Zhou Qi and Ms Li Qun have
  // no address on the roster, so there is nothing to create an account from
  // and no way to recover their legal name (the school convention encodes it
  // as firstname.lastname). They teach Mother Tongue and appear in the
  // timetable; their assignments simply cannot be imported until Mr Hanafi
  // supplies addresses. A third, "Ms Khim", heads a YoungStarters column in
  // the workbook and is on no roster at all.

  // Primary.
  {
    fullName: 'Kristel Ivy Conado',
    email: 'kristel.conado@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Zuraidah Zainal',
    email: 'zuraidah.zainal@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Jenny Wong',
    email: 'jenny.wong@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Low Wai Chung',
    email: 'waichung.low@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Shafika Binti Jasni',
    email: 'shafika.jasni@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Parmithaa Devan Reddy',
    email: 'parmithaa.reddy@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Karen Grace Ledbetter',
    email: 'karengrace.ledbetter@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Arlene Raralio',
    email: 'arlene.raralio@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Yu Jing Lim',
    email: 'jing.lim@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    fullName: 'Lakshmi Radhika Putrevu',
    email: 'radhika.putrevu@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },
  {
    // ⚠ The roster spells the nickname "Mr Jospeh" in the timetable sheets.
    // The name here is the legal one, from his address.
    fullName: 'Joseph Ong Poh Chye',
    email: 'joseph.ong@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Primary',
  },

  // Secondary.
  {
    // Appears throughout the timetable as "Ms Carl" — a middle name, not a
    // surname, which is why the nickname never resolved by inspection.
    fullName: 'Christine Carl Sarmiento',
    email: 'christine.sarmiento@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Secondary',
  },
  {
    fullName: 'Medelyn Ruth Azucena',
    email: 'medelyn.azucena@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Secondary',
  },
  {
    fullName: 'Chong Jun Hien',
    email: 'jun.chong@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Secondary',
  },
  {
    fullName: 'Jocelyn Saguid',
    email: 'jocelyn.saguid@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Secondary',
  },
  {
    // "Ms Elaine" in the workbook. ⚠ NOT the same person as Fong Mei Yin
    // Elaine below — two Elaines now teach here, which is why every nickname
    // in the importer carries its reasoning.
    fullName: 'May Ling Elaine Wee',
    email: 'elaine.wee@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Secondary',
  },
  {
    fullName: 'Natividad Laguyo',
    email: 'natividad.laguyo@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Secondary',
  },
  {
    fullName: 'Sharon Anne Menezes',
    email: 'sharonanne.menezes@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Secondary',
  },

  // Relief, part-time. Two were named on 2026-08-25; only one is new here.
  // ⚠ Mr Chong Jun Hien was named in that same message but is NOT new — he is
  // already on the workbook's `Teachers List` and sits under Secondary above,
  // teaching Science and Global Perspectives, which is exactly what the
  // message said he covers.
  {
    // ⚠ Almost certainly the "Relief Teacher" column in the workbook
    // (Final Update_New C27 — Sec 3 English and Sec 1D2 English). The subject
    // and school half both match, but the workbook names no classes for her,
    // so the assignment itself is still unconfirmed.
    fullName: 'Fong Mei Yin Elaine',
    email: 'elaine.fong@hfse.edu.sg',
    role: 'teacher',
    group: 'Teachers - Relief',
  },
];

const OUTPUT_DIR = resolve(import.meta.dirname, 'provision-output');
// ONE current handout, overwritten each run, always complete — previously
// issued passwords are carried forward from the prior workbook rather than
// left blank. A timestamped file per run meant whoever distributes the
// credentials had to work out which file held whose password.
const OUTPUT_FILE = resolve(OUTPUT_DIR, 'HFSE-Staff-Accounts.xlsx');
// The superseded copy is kept, never discarded — it is the only record of
// the passwords it holds if a carry-forward ever misses.
const ARCHIVE_DIR = resolve(OUTPUT_DIR, 'archive');

const STATUS_CREATED = 'Created — sign in with this password';
const STATUS_EXISTING = 'Existing account — password unchanged';
const STATUS_EXISTING_NO_PW =
  'Existing account — password not on record, reset it if unknown';
const STATUS_RESET = 'Password reset — sign in with this new password';
const STATUS_FAILED = 'FAILED — not created';
const STATUS_MISMATCH = 'NEEDS ATTENTION — existing account has the wrong role';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Recovers previously-issued passwords from every workbook this script has
// written, so a run that skips existing accounts can still emit a complete
// handout. Scans provision-output/ and its archive/, oldest first, so a
// newer file's value wins on conflict.
function harvestIssuedPasswords(): Map<string, string> {
  const merged = new Map<string, string>();
  const files: string[] = [];

  for (const dir of [OUTPUT_DIR, ARCHIVE_DIR]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.xlsx') || name.startsWith('~$')) {
        continue;
      }
      files.push(resolve(dir, name));
    }
  }

  files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);

  for (const file of files) {
    try {
      for (const [email, pw] of readIssuedPasswords(readFileSync(file))) {
        merged.set(email, pw);
      }
    } catch (e) {
      // Never fatal: a run that has already created accounts must still
      // produce a workbook. Worst case a cell is blank and we say so.
      console.warn(
        `  (could not read ${file}: ${e instanceof Error ? e.message : String(e)})`
      );
    }
  }
  return merged;
}

async function main() {
  const apply = process.argv.includes('--apply');
  // Repairs accounts that exist but whose temporary password is on no
  // handout (e.g. created by a run whose workbook write failed). Opt-in
  // because it is the only path in this script that changes a live account.
  const resetUnknown = process.argv.includes('--reset-unknown');
  const actorEmail = arg('actor');

  if (!actorEmail) {
    console.error(
      'Missing --actor=<superadmin-email>. Every account creation writes an\n' +
        'audit row, and the audit trail must name a real person rather than a\n' +
        'fabricated actor.'
    );
    process.exit(1);
  }

  console.log(
    apply
      ? '=== APPLY: accounts will be created ==='
      : '=== PREVIEW: nothing will be created (add --apply to run for real) ==='
  );

  const service = createServiceClient();

  // Must be the paginated helper: staff and ~1000 parent-portal accounts
  // share this Supabase project (KD #1), so a single listUsers({perPage:1000})
  // silently misses everyone past page 1 — and a missed existing account
  // would mean a duplicate-email failure instead of a clean skip.
  console.log('Loading existing auth users…');
  const existing = await listAllAuthUsers(service);
  console.log(`  ${existing.length} auth user(s) in the project.`);

  const byEmail = new Map(
    existing
      .filter((u) => u.email)
      .map((u) => [normalizeEmail(u.email!), u] as const)
  );

  // Resolve the actor to a real auth user so audit rows carry a true
  // actor_id, and confirm they are a superadmin — the same gate the
  // /api/sis/admin/users route enforces.
  const superadmins = existing
    .filter(
      (u) => (u.app_metadata as { role?: string } | null)?.role === 'superadmin'
    )
    .map((u) => u.email)
    .filter((e): e is string => !!e)
    .sort();
  const listSuperadmins = () =>
    superadmins.length
      ? `Available superadmin account(s):\n${superadmins.map((e) => `  - ${e}`).join('\n')}`
      : 'No superadmin account exists in this project yet.';

  const actor = byEmail.get(normalizeEmail(actorEmail));
  if (!actor) {
    console.error(
      `Actor "${actorEmail}" is not an account in this project.\n${listSuperadmins()}`
    );
    process.exit(1);
  }
  const actorRole = (actor.app_metadata as { role?: string } | null)?.role;
  if (actorRole !== 'superadmin') {
    console.error(
      `Actor "${actorEmail}" has role "${actorRole ?? 'none'}" — creating staff\n` +
        `accounts is superadmin-only.\n${listSuperadmins()}`
    );
    process.exit(1);
  }
  console.log(`Actor: ${actor.email} (${actorRole})\n`);

  // Guard the roster itself before touching anything: a duplicated email in
  // the list would create one account and then look like a pre-existing
  // account on the second pass, which reads as success.
  const seen = new Set<string>();
  for (const r of ROSTER) {
    const key = normalizeEmail(r.email);
    if (seen.has(key)) {
      console.error(
        `Roster contains ${r.email} more than once. Fix and re-run.`
      );
      process.exit(1);
    }
    seen.add(key);
  }

  const priorPasswords = harvestIssuedPasswords();
  if (priorPasswords.size > 0) {
    console.log(
      `Recovered ${priorPasswords.size} previously-issued password(s) from earlier handouts.\n`
    );
  }

  const rows: CredentialRow[] = [];
  const passwords = new Set<string>();
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let mismatched = 0;
  let reset = 0;

  for (const entry of ROSTER) {
    const email = normalizeEmail(entry.email);
    const label = `${entry.fullName} <${email}> [${entry.role}]`;

    // "Email exists" is NOT the same as "account is fine". A pre-existing
    // row can be a parent-portal record (null role) or hold the wrong role —
    // in which case a silent skip leaves the person with no access, which
    // reads as success. Compare the roles and refuse to be quiet about it.
    // getUserRole is the app's own resolver (app_metadata.role ??
    // user_metadata.role, validated against ROLES) so this can't drift.
    const found = byEmail.get(email);
    if (found) {
      const foundRole = getUserRole(found);
      if (foundRole === entry.role) {
        // Carry the password forward from the workbook that first issued it
        // so this run's handout is complete. The account itself is NOT
        // touched — no reset, no re-role.
        let priorPassword = priorPasswords.get(email) ?? '';

        // The one sanctioned exception to "never touch an existing account":
        // no recoverable password means nobody can sign in, so the account is
        // unusable and a reset is the only repair. Opt-in, and only for
        // accounts with NOTHING on record — an account whose password IS
        // known is never reset.
        if (!priorPassword && resetUnknown && apply) {
          let fresh = generateTempPassword();
          while (passwords.has(fresh)) fresh = generateTempPassword();
          const { error: resetErr } = await service.auth.admin.updateUserById(
            found.id,
            { password: fresh }
          );
          if (resetErr) {
            console.error(`  RESET-FAIL ${label} — ${resetErr.message}`);
            failed++;
            rows.push({
              ...entry,
              email,
              password: '',
              status: STATUS_EXISTING_NO_PW,
            });
            continue;
          }
          passwords.add(fresh);
          priorPassword = fresh;
          reset++;
          await logAction({
            service,
            actor: { id: actor.id, email: actor.email ?? actorEmail },
            action: 'user.info.update',
            entityType: 'user_account',
            entityId: found.id,
            context: {
              email,
              role: entry.role,
              change: 'password_reset',
              reason:
                'no temporary password was on record in any credential handout, so the account was unusable',
              provisioned_by: 'scripts/provision-staff-accounts.ts',
            },
          });
          console.log(`  RESET    ${label} — new temporary password issued`);
          skipped++;
          rows.push({
            ...entry,
            email,
            password: priorPassword,
            status: STATUS_RESET,
          });
          continue;
        }

        console.log(
          `  SKIP     ${label} — already exists with this role` +
            (priorPassword ? ' (password carried forward)' : '')
        );
        skipped++;
        rows.push({
          ...entry,
          email,
          password: priorPassword,
          status: priorPassword ? STATUS_EXISTING : STATUS_EXISTING_NO_PW,
        });
      } else {
        const held = foundRole ?? 'none — parent-portal record or unset';
        console.error(
          `  MISMATCH ${label} — account exists but holds role "${held}". ` +
            'Left untouched; resolve it by hand before re-running.'
        );
        mismatched++;
        rows.push({
          ...entry,
          email,
          password: '',
          status: `${STATUS_MISMATCH} (holds "${held}")`,
        });
      }
      continue;
    }

    // Distinct per person — two staff sharing a temporary password would let
    // either sign in as the other until both changed it.
    let password = generateTempPassword();
    while (passwords.has(password)) password = generateTempPassword();
    passwords.add(password);

    // Parse through the app's own schema so this script cannot drift from
    // the route's contract: role must be in the Role enum, email is
    // lowercased by the zod transform, password must be 8-72 chars.
    const parsed = InviteUserSchema.safeParse({
      email,
      role: entry.role,
      displayName: entry.fullName,
      password,
    });
    if (!parsed.success) {
      console.error(
        `  INVALID ${label} — ${JSON.stringify(parsed.error.flatten().fieldErrors)}`
      );
      failed++;
      rows.push({ ...entry, email, password: '', status: STATUS_FAILED });
      continue;
    }

    if (!apply) {
      console.log(`  CREATE  ${label} — would create`);
      // No password in the preview sheet: preview writes no workbook, and
      // printing a password for an account that doesn't exist invites
      // handing out a credential that was never provisioned.
      rows.push({ ...entry, email, password: '', status: 'Would be created' });
      continue;
    }

    // Byte-identical to app/api/sis/admin/users/route.ts:59-66.
    const { data, error } = await service.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      email_confirm: true,
      app_metadata: { role: parsed.data.role },
      user_metadata: { display_name: parsed.data.displayName },
    });

    if (error || !data?.user) {
      // Fail soft per row — one bad account must not strand the other 11.
      console.error(
        `  ERROR   ${label} — ${error?.message ?? 'no user returned'}`
      );
      failed++;
      rows.push({ ...entry, email, password: '', status: STATUS_FAILED });
      continue;
    }

    await logAction({
      service,
      actor: { id: actor.id, email: actor.email ?? actorEmail },
      action: 'user.create',
      entityType: 'user_account',
      entityId: data.user.id,
      context: {
        email: parsed.data.email,
        role: parsed.data.role,
        display_name: parsed.data.displayName ?? null,
        provisioned_by: 'scripts/provision-staff-accounts.ts',
      },
    });

    console.log(`  CREATED ${label}`);
    created++;
    rows.push({ ...entry, email, password, status: STATUS_CREATED });
  }

  console.log(
    `\nRoster ${ROSTER.length} — created ${created}, skipped ${skipped}` +
      (reset > 0 ? ` (${reset} password reset)` : '') +
      `, mismatched ${mismatched}, failed ${failed}`
  );

  if (mismatched > 0) {
    console.error(
      `\n${mismatched} account(s) exist under the intended email but hold a\n` +
        'different role. Nothing was changed for them — an existing account is\n' +
        'never re-roled or password-reset by this script. Decide per account\n' +
        'whether to re-role it, delete and recreate it, or use another email.'
    );
  }

  if (!apply) {
    console.log(
      '\nPreview only. No accounts created, no workbook written.\n' +
        'Re-run with --apply to create the accounts and generate the handout.'
    );
    process.exit(failed + mismatched > 0 ? 1 : 0);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Archive the outgoing handout before overwriting. The new file is a
  // superset in every normal case, but the old one is the only record of any
  // password a carry-forward failed to recover, so it is never destroyed.
  if (existsSync(OUTPUT_FILE)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const archived = resolve(ARCHIVE_DIR, `HFSE-Staff-Accounts-${stamp}.xlsx`);
    copyFileSync(OUTPUT_FILE, archived);
    console.log(`\nPrevious handout archived: ${archived}`);
  }

  // A failed write here is the worst outcome in this script: accounts have
  // already been created, and the workbook is the ONLY record of their
  // passwords. Observed once in practice — the write silently did not happen
  // (most likely an Excel/OneDrive lock on the open file; not conclusively
  // identified), leaving a real account whose password existed nowhere.
  // So: fail loudly, and dump the freshly-issued credentials to the console
  // as a last-resort record before exiting.
  try {
    writeFileSync(
      OUTPUT_FILE,
      buildCredentialWorkbook(rows, {
        signInUrl: process.env.NEXT_PUBLIC_SIS_URL ?? null,
      })
    );
  } catch (e) {
    console.error(
      `\n!!! COULD NOT WRITE ${OUTPUT_FILE}\n` +
        `    ${e instanceof Error ? e.message : String(e)}\n` +
        '    If the file is open in Excel or syncing, close it and re-run.\n'
    );
    const fresh = rows.filter((r) => r.status === STATUS_CREATED);
    if (fresh.length > 0) {
      console.error(
        'These accounts WERE created and their passwords exist nowhere else.\n' +
          'Copy them now — this console output is the only record:\n'
      );
      for (const r of fresh) {
        console.error(`    ${r.email}\t${r.password}\t${r.role}`);
      }
      console.error(
        '\nIf this output is lost, reset those passwords with --reset-unknown.'
      );
    }
    process.exit(1);
  }

  console.log(`\nCredential workbook: ${OUTPUT_FILE}`);
  console.log(
    `  ${rows.length} row(s) across every role group — this single file is the\n` +
      '  current handout; it supersedes any earlier copy.'
  );
  console.log(
    'Contains plaintext temporary passwords — gitignored, keep it off shared\n' +
      'drives, and have each person change their password from the Account page\n' +
      'after first sign-in.'
  );

  // A blank password means the account exists but no handout on disk ever
  // recorded its password — say so loudly rather than shipping a sheet with
  // a silently empty cell.
  const blanks = rows.filter((r) => !r.password && r.status !== STATUS_FAILED);
  if (blanks.length > 0) {
    console.warn(
      `\n${blanks.length} account(s) have no password on record (existing accounts\n` +
        'whose original handout is missing). They are listed with an explanatory\n' +
        'status. Re-run with --reset-unknown to issue them a fresh password,\n' +
        'or reset it by hand from /sis/admin/staff:'
    );
    for (const b of blanks) console.warn(`  - ${b.fullName} <${b.email}>`);
  }

  // Staff pickers and approver lists read a 300s cache under the
  // 'teacher-emails' tag (lib/auth/staff-list.ts). A standalone script can't
  // call revalidateTag, so those surfaces lag by up to 5 minutes. The staff
  // Accounts page itself is uncached and shows the new accounts immediately.
  console.log(
    '\nNote: the staff Accounts page shows these immediately; teacher/approver\n' +
      'pickers elsewhere may take up to 5 minutes to catch up.'
  );

  process.exit(failed + mismatched > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
