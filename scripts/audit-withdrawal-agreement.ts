// scripts/audit-withdrawal-agreement.ts
//
// DO THE CLASS LIST AND ADMISSIONS AGREE ON WHO HAS LEFT?
//
// Mr Ace, 2026-09-17, after Francisco, Jelenna Rei Rojas turned up withdrawn
// on the P2 Humility roster with nothing on her admissions record: "i know
// there are some instances like this still".
//
// KD #220 (2026-09-17) settled it: withdrawn on the class list means Withdrawn
// in admissions. Buckets B and C are now the disagreements. The note below is
// the pre-KD #220 reasoning, kept for the record.
//
// What "agree" meant under KD #150, not "the two status columns say the same
// word". `applicationStatus` is the application's OUTCOME and stays `Enrolled`
// after a child who enrolled later leaves; the class list carries where the
// child is NOW. So a withdrawn roster row beside an `Enrolled` application is
// correct. What the in-app withdrawal also does — and a direct database write
// does not — is record a reason on both sides, stamp who changed admissions,
// and leave a `student.withdrawal.cascade` history row. Those are what go
// missing.
//
// Buckets, per AY:
//   A  admissions Withdrawn/Cancelled, but the child is still ACTIVE on a
//      class list. A real disagreement: one record says gone, the other
//      still marks them present.
//   B  withdrawn on the class list, admissions says Enrolled, and the app's
//      withdrawal never ran (no cascade history row) — a Francisco. Split by
//      whether a reason exists anywhere.
//   C  withdrawn on the class list the normal way (cascade row present).
//      Listed as a count only; this is what correct looks like.
//   D  withdrawn on the class list, admissions Withdrawn/Cancelled. The
//      pre-KD #150 shape (outcome overwritten). Count only.
//   E  withdrawn on the class list with no admissions row for that enrolee
//      number.
//
// A transfer (KD #67) leaves a withdrawn row beside an active one; such a
// child is treated as still enrolled, not withdrawn.
//
// STRICTLY READ-ONLY.
//
//   npx tsx --env-file=.env.local scripts/audit-withdrawal-agreement.ts
import { createServiceClient } from '../lib/supabase/service';
import { createAdmissionsClient } from '../lib/supabase/admissions';

type Roster = {
  id: string;
  enrolee_number: string | null;
  index_number: number | null;
  enrollment_status: string;
  withdrawal_date: string | null;
  withdrawal_reason: string | null;
  student: { student_number: string; last_name: string; first_name: string };
  section: { name: string; level: { code: string } };
};

async function pageAll<T>(
  q: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const TERMINAL = new Set(['Withdrawn', 'Cancelled']);

async function main() {
  const svc = createServiceClient();
  const adm = createAdmissionsClient();

  const cascades = await pageAll<{ context: Record<string, unknown> }>((f, t) =>
    svc
      .from('audit_log')
      .select('context')
      .eq('action', 'student.withdrawal.cascade')
      .range(f, t)
  );
  const cascaded = new Set(
    cascades.map((c) => String(c.context?.section_student_id ?? ''))
  );

  const { data: years } = await svc
    .from('academic_years')
    .select('id, ay_code')
    .order('ay_code');

  for (const y of (years ?? []) as { id: string; ay_code: string }[]) {
    const prefix = `ay${y.ay_code.slice(2)}`;
    const roster = await pageAll<Roster>((f, t) =>
      svc
        .from('section_students')
        .select(
          'id, enrolee_number, index_number, enrollment_status, withdrawal_date, withdrawal_reason, student:students!inner(student_number, last_name, first_name), section:sections!inner(name, academic_year_id, level:levels(code))'
        )
        .eq('section.academic_year_id', y.id)
        .range(f, t)
    );
    if (roster.length === 0) continue;

    const status = await pageAll<Record<string, string | null>>((f, t) =>
      adm
        .from(`${prefix}_enrolment_status` as never)
        .select(
          '"enroleeNumber", "applicationStatus", "applicationTerminalReason", "applicationUpdatedDate"'
        )
        .range(f, t)
    ).catch(() => null);
    if (!status) {
      console.log(`\n${y.ay_code}: no admissions table, skipped`);
      continue;
    }
    const byEnrolee = new Map(status.map((s) => [s.enroleeNumber!, s]));

    // Current state per student: active/late anywhere this AY wins.
    const liveByStudent = new Map<string, boolean>();
    for (const r of roster) {
      const sn = r.student.student_number;
      const live = r.enrollment_status !== 'withdrawn';
      liveByStudent.set(sn, (liveByStudent.get(sn) ?? false) || live);
    }

    const label = (r: Roster) =>
      `${r.student.last_name}, ${r.student.first_name} (${r.student.student_number}, ${r.enrolee_number ?? 'no enrolee #'}) ${r.section.level?.code ?? '?'} ${r.section.name} #${r.index_number ?? '-'}`;

    const A: string[] = [];
    const Bnone: string[] = [];
    const Bsome: string[] = [];
    let C = 0;
    let D = 0;
    const E: string[] = [];

    // A — the application THIS class row came from is terminal, yet the row
    // is live. Matched on the row's own enrolee number: a family that applied
    // twice leaves a Cancelled duplicate under another number beside the real
    // enrolment, and that is not a disagreement (12 such in AY2025).
    for (const r of roster) {
      if (r.enrollment_status === 'withdrawn' || !r.enrolee_number) continue;
      const s = byEnrolee.get(r.enrolee_number);
      if (!s || !TERMINAL.has(s.applicationStatus ?? '')) continue;
      A.push(`${label(r)}  — admissions: ${s.applicationStatus}`);
    }

    for (const r of roster) {
      if (r.enrollment_status !== 'withdrawn') continue;
      if (liveByStudent.get(r.student.student_number)) continue; // transfer
      const s = r.enrolee_number ? byEnrolee.get(r.enrolee_number) : undefined;
      if (!s) {
        E.push(label(r));
        continue;
      }
      if (TERMINAL.has(s.applicationStatus ?? '')) {
        D++;
        continue;
      }
      if (cascaded.has(r.id)) {
        C++;
        continue;
      }
      const reason = r.withdrawal_reason ?? s.applicationTerminalReason;
      const line = `${label(r)}  — last day ${r.withdrawal_date ?? 'none'}, reason ${reason ?? 'none'}, admissions ${s.applicationStatus}`;
      (reason ? Bsome : Bnone).push(line);
    }

    console.log(`\n══ ${y.ay_code} ══`);
    console.log(
      `A  gone per admissions, still active on a class list: ${A.length}`
    );
    A.forEach((l) => console.log('   ' + l));
    console.log(
      `B  withdrawn on the class list, admissions still Enrolled, NO reason: ${Bnone.length}`
    );
    Bnone.forEach((l) => console.log('   ' + l));
    console.log(
      `B  withdrawn on the class list, admissions still Enrolled, reason present: ${Bsome.length}`
    );
    Bsome.forEach((l) => console.log('   ' + l));
    console.log(
      `C  (legacy) withdrawn, admissions Enrolled, app cascade ran: ${C}`
    );
    console.log(`D  withdrawn on both sides (in sync, KD #220): ${D}`);
    console.log(
      `E  withdrawn, class row carries no enrolee number (not checkable here): ${E.length}`
    );
    E.forEach((l) => console.log('   ' + l));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
