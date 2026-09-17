// scripts/backfill/resync-withdrawals-records-admissions.ts
//
// BRING ADMISSIONS INTO LINE WITH THE CLASS LIST FOR EVERY CHILD WHO HAS LEFT.
//
// Mr Ace, 2026-09-17: "make it sync both ways" and then "resync records and
// admissions based on existing data we have". KD #220 made a withdrawal in
// Records set admissions to `Withdrawn`; this does the same for the children
// withdrawn before that, none of whom went through the app's withdrawal
// (`scripts/audit-withdrawal-agreement.ts`, buckets B and E).
//
// Records → Admissions, per child withdrawn on the class list with no live
// class row in the same year (a KD #67 transfer is not a withdrawal):
//   * applicationStatus → 'Withdrawn', unless already Withdrawn / Cancelled
//   * applicationTerminalReason / Notes ← the class row's reason, ONLY when
//     the class row has one and admissions has none. No reason is invented.
//   * applicationUpdatedDate / By are NOT stamped. The history row below says
//     who and when; stamping them would read as an admissions-staff edit.
// The admissions row is found by the class row's enrolee number, or — for a
// row carrying none (Ajmal, Cama) — by student number, skipping Cancelled /
// Withdrawn duplicates.
//
// Admissions → Records is REPORTED, never written: a child whose application
// says Withdrawn / Cancelled while still active in class needs a last day,
// and only the school can give it. (0 such on 2026-09-17.)
//
// Each write leaves a `student.withdrawal.cascade` history row with the
// before-value, so any single one can be put back.
//
//   npx tsx --env-file=.env.local scripts/backfill/resync-withdrawals-records-admissions.ts
//   npx tsx --env-file=.env.local scripts/backfill/resync-withdrawals-records-admissions.ts --apply
import { createServiceClient } from '../../lib/supabase/service';
import { createAdmissionsClient } from '../../lib/supabase/admissions';

const APPLY = process.argv.includes('--apply');
const TERMINAL = new Set(['Withdrawn', 'Cancelled']);
const ACTOR = 'claude-backfill@hfse.internal';

type Roster = {
  id: string;
  enrolee_number: string | null;
  index_number: number | null;
  enrollment_status: string;
  withdrawal_date: string | null;
  withdrawal_reason: string | null;
  withdrawal_notes: string | null;
  section_id: string;
  student: { student_number: string; last_name: string; first_name: string };
  section: { name: string; level: { code: string } | null };
};
type Adm = {
  enroleeNumber: string;
  applicationStatus: string | null;
  applicationTerminalReason: string | null;
  applicationTerminalNotes: string | null;
};

async function pageAll<T>(
  q: (
    f: number,
    t: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function main() {
  const svc = createServiceClient();
  const adm = createAdmissionsClient();
  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code');

  let writes = 0;
  let failures = 0;
  for (const y of (years ?? []) as { id: string; ay_code: string }[]) {
    const prefix = `ay${y.ay_code.slice(2)}`;
    const roster = await pageAll<Roster>((f, t) =>
      svc
        .from('section_students')
        .select(
          'id, enrolee_number, index_number, enrollment_status, withdrawal_date, withdrawal_reason, withdrawal_notes, section_id, student:students!inner(student_number, last_name, first_name), section:sections!inner(name, academic_year_id, level:levels(code))'
        )
        .eq('section.academic_year_id', y.id)
        .range(f, t)
    );
    if (roster.length === 0) continue;
    const status = await pageAll<Adm>((f, t) =>
      adm
        .from(`${prefix}_enrolment_status` as never)
        .select(
          '"enroleeNumber", "applicationStatus", "applicationTerminalReason", "applicationTerminalNotes"'
        )
        .range(f, t)
    ).catch(() => null);
    if (!status) continue;
    const apps = await pageAll<{
      enroleeNumber: string;
      studentNumber: string | null;
    }>((f, t) =>
      adm
        .from(`${prefix}_enrolment_applications` as never)
        .select('"enroleeNumber", "studentNumber"')
        .range(f, t)
    );
    const byEnrolee = new Map(status.map((s) => [s.enroleeNumber, s]));

    const live = new Set(
      roster
        .filter((r) => r.enrollment_status !== 'withdrawn')
        .map((r) => r.student.student_number)
    );
    const label = (r: Roster) =>
      `${r.student.last_name}, ${r.student.first_name} (${r.student.student_number}) ${r.section.level?.code ?? '?'} ${r.section.name} #${r.index_number ?? '-'}`;

    console.log(`\n══ ${y.ay_code} ══`);

    // Admissions → Records: report only.
    for (const r of roster) {
      if (r.enrollment_status === 'withdrawn' || !r.enrolee_number) continue;
      const s = byEnrolee.get(r.enrolee_number);
      if (s && TERMINAL.has(s.applicationStatus ?? '')) {
        console.log(
          `  ⚠ NEEDS THE SCHOOL: ${label(r)} is active in class but admissions says ${s.applicationStatus} — needs a last day`
        );
      }
    }

    // Records → Admissions.
    for (const r of roster) {
      if (r.enrollment_status !== 'withdrawn') continue;
      if (live.has(r.student.student_number)) continue;

      let s = r.enrolee_number ? byEnrolee.get(r.enrolee_number) : undefined;
      if (!s) {
        const candidates = apps
          .filter((a) => a.studentNumber === r.student.student_number)
          .map((a) => byEnrolee.get(a.enroleeNumber))
          .filter((x): x is Adm => !!x);
        s =
          candidates.find((c) => !TERMINAL.has(c.applicationStatus ?? '')) ??
          candidates[0];
      }
      if (!s) {
        console.log(`  ⚠ no admissions record found: ${label(r)}`);
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (!TERMINAL.has(s.applicationStatus ?? '')) {
        patch.applicationStatus = 'Withdrawn';
      }
      if (r.withdrawal_reason && !s.applicationTerminalReason) {
        patch.applicationTerminalReason = r.withdrawal_reason;
        patch.applicationTerminalNotes = r.withdrawal_notes ?? null;
      }
      if (Object.keys(patch).length === 0) continue;

      console.log(
        `  ${label(r)}  ${s.enroleeNumber}: ${s.applicationStatus} → ${patch.applicationStatus ?? s.applicationStatus}${patch.applicationTerminalReason ? `, reason ← ${patch.applicationTerminalReason}` : ''}`
      );
      if (!APPLY) {
        writes++;
        continue;
      }

      const { error } = await adm
        .from(`${prefix}_enrolment_status` as never)
        .update(patch as never)
        .eq('enroleeNumber', s.enroleeNumber);
      if (error) {
        console.log(`    ✗ failed: ${error.message}`);
        failures++;
        continue;
      }
      const { error: auditErr } = await svc.from('audit_log').insert({
        actor_id: null,
        actor_email: ACTOR,
        actor_role: null,
        action: 'student.withdrawal.cascade',
        entity_type: 'enrolment_status',
        entity_id: s.enroleeNumber,
        context: {
          ay_code: y.ay_code,
          trigger: 'resync.records_to_admissions.2026-09-17',
          note: 'KD #220 resync: child already withdrawn on the class list; admissions brought into line',
          enroleeNumber: s.enroleeNumber,
          studentNumber: r.student.student_number,
          studentName: `${r.student.first_name} ${r.student.last_name}`,
          section_student_id: r.id,
          section_id: r.section_id,
          section_name: r.section.name,
          index_number: r.index_number,
          withdrawal_date: r.withdrawal_date,
          withdrawal_reason: r.withdrawal_reason,
          applicationStatus_before: s.applicationStatus,
          applicationTerminalReason_before: s.applicationTerminalReason,
          admissions_patch: patch,
        },
      });
      if (auditErr)
        console.log(`    ⚠ history row failed: ${auditErr.message}`);
      writes++;
    }
  }

  console.log(
    `\n${APPLY ? 'Written' : 'Would write'}: ${writes}${failures ? `, failed: ${failures}` : ''}`
  );
  if (!APPLY) console.log('DRY RUN — re-run with --apply to write.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
