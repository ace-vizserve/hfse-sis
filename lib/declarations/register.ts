// ⚠ NO `import 'server-only'`, for the same reason `lib/declarations/approval.ts`
// omits it: `scripts/repair-declaration-approvals.ts` imports this module and
// runs under tsx, where the `server-only` package throws outright.
//
//   THIS IS SERVER CODE. It uses the service-role client and bypasses RLS.
//   Never import it from a client component.

import type { SupabaseClient } from '@supabase/supabase-js';

import { logAction, logActions } from '@/lib/audit/log-action';
import {
  MarksWrittenRollupFailedError,
  writeDailyBatch,
} from '@/lib/attendance/mutations';
import { expandSchoolDays } from '@/lib/attendance/school-days';
import { sgToday } from '@/lib/dates';
import { levelTypeForAudienceLookup } from '@/lib/sis/levels';
import type { ExReason } from '@/lib/schemas/attendance';
import { inclusiveDayCount } from '@/lib/schemas/declarations';

/**
 * Phase 3 — an approved filing marks the register.
 *
 * Until this existed, a parent filed an absence, the form class adviser
 * approved it, the officer in charge approved it, the parent read "Approved" —
 * and the attendance sheet showed nothing. Mr Ace, 2026-08-27: *"the attendance
 * sheet is not showing that the filed student has been excused based on the
 * approval details."* That is the whole point of the feature: today the reason
 * for an absence is four disconnected things — a WhatsApp message, a paper MC
 * in Mr Hanafi's drawer, the teacher's guess between A and EX, and the mark —
 * and this is what joins the proof to the day so the teacher stops guessing.
 *
 * ⚠ THE REASON FOLLOWS THE KIND OF FILING, NOT THE CERTIFICATE — Mr Ace,
 * 2026-08-27, asked directly: *"it will be either MC or vacation leave
 * depending on the type of declaration the parent has sent."* An absence
 * records `mc`; a travel filing records `vacation`.
 *
 * 🔴 **This CORRECTS migration 125's own header**, which said `with_medical`
 * "selects the reason recorded under the register mark: 'mc' with a
 * certificate, no subtype without one". That was our assumption, written
 * before anybody asked. It is wrong: whether a certificate was attached does
 * not change the mark at all. 125 is applied and its file is history, so the
 * corrected rule lives here and in KD #195 rather than being edited into it.
 *
 * ⚠ APPROVAL WINS OVER WHAT THE TEACHER ALREADY MARKED (Mr Ace, same
 * conversation). A day marked Absent on Monday flips to Excused when the
 * certificate is approved on Wednesday. Nothing is deleted — `attendance_daily`
 * is append-only and a correction INSERTs a superseding row, so the audit trail
 * still shows the teacher's original mark and the moment it changed.
 */

/** Absence → 'mc'; travel → 'vacation'. The filing's kind, not its evidence. */
const EX_REASON_BY_DECLARATION_TYPE: Record<string, ExReason> = {
  absence: 'mc',
  travel: 'vacation',
};

/**
 * Which kinds write marks.
 *
 * ⚠ Travel joined in Phase 4, and the order was deliberate. It waited until
 * the allowance was actually counted (KD #94, corrected 2026-08-27 — one
 * vacation leave is one TRIP, not one day), because writing `vacation` days
 * while a day-counter was still in place would have made every approved
 * holiday instantly report itself as over quota on six screens.
 *
 * ⚠ EXPORTED because a second reader needs the same answer.
 * `lib/declarations/cell-filings.ts` asks the attendance sheet's version of
 * this question — "which filings can explain a mark on this day" — and the
 * answer must be identical, because a kind that writes marks but is missing
 * from the sheet produces a register the sheet cannot account for and, worse,
 * an approved day a teacher can overwrite with no warning. That is exactly
 * what happened to travel: this set gained it and the sheet's own filter did
 * not.
 */
export const REGISTER_WRITING_TYPES = new Set(['absence', 'travel']);

export type RegisterWriteResult =
  | { ok: true; written: number; skipped: number; skippedReason: null }
  | { ok: true; written: 0; skipped: 0; skippedReason: 'not_applicable' }
  | { ok: false; error: string };

export type RegisterActor = {
  id: string | null;
  email: string | null;
  role: string | null;
};

type DeclarationRow = {
  id: string;
  declaration_type: string;
  section_student_id: string;
  section_id: string;
  academic_year_id: string;
  start_date: string;
  end_date: string;
  status: string;
};

/**
 * Marks every school day of an approved absence as Excused, then stamps the
 * filing.
 *
 * ⚠ MARKS FIRST, STAMP SECOND, and migration 125:206 is explicit about why:
 * *"a stamp with no marks is the one failure mode that leaves no trace."* If
 * the insert throws, `register_written_at` stays null and the filing shows up
 * in the repair script; if the stamp throws afterwards, the marks are on the
 * sheet and the repair script re-runs a no-op-shaped write. The wrong order
 * makes a filing look finished when the register is empty.
 *
 * Returns rather than throws — the caller is a decide route whose decision has
 * ALREADY landed, and losing an approval because a calendar lookup failed
 * would be far worse than a sheet that is briefly behind.
 */
export async function writeRegisterForDeclaration(
  service: SupabaseClient,
  declarationId: string,
  /**
   * Who set the write moving, for `recorded_by` and the audit rows.
   *
   * ⚠ A BARE ID IS STILL ACCEPTED, and means "no person to name": the repair
   * script passes `null`, and it has no email or role to give. The approval
   * handler passes the whole actor so the audit rows carry the approver.
   */
  actor: RegisterActor | string | null
): Promise<RegisterWriteResult> {
  const auditActor: RegisterActor =
    actor == null || typeof actor === 'string'
      ? { id: actor ?? null, email: null, role: null }
      : actor;
  const actorId = auditActor.id;
  let row: DeclarationRow;
  try {
    const { data, error } = await service
      .from('student_declarations')
      .select(
        'id, declaration_type, section_student_id, section_id, academic_year_id, start_date, end_date, status'
      )
      .eq('id', declarationId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'Declaration not found.' };
    row = data as DeclarationRow;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!REGISTER_WRITING_TYPES.has(row.declaration_type)) {
    return {
      ok: true,
      written: 0,
      skipped: 0,
      skippedReason: 'not_applicable',
    };
  }

  const exReason = EX_REASON_BY_DECLARATION_TYPE[row.declaration_type];
  if (!exReason) {
    return {
      ok: false,
      error: `No register reason mapped for "${row.declaration_type}".`,
    };
  }

  try {
    // The calendar's audience precedence needs the child's half of the school.
    // Same lookup the daily PATCH route does before its own write-gate.
    // `name` rides along for the audit rows below — same read.
    const { data: sectionRow } = await service
      .from('sections')
      .select('name, levels(code)')
      .eq('id', row.section_id)
      .maybeSingle();
    const levelCode =
      (sectionRow as { levels?: { code?: string | null } | null } | null)
        ?.levels?.code ?? null;
    const sectionName =
      (sectionRow as { name?: string | null } | null)?.name ?? null;
    const levelType = levelTypeForAudienceLookup(levelCode);

    const days = await expandSchoolDays(service, {
      startDate: row.start_date,
      endDate: row.end_date,
      academicYearId: row.academic_year_id,
      levelType,
    });

    // Days inside the filed range that carry no mark: weekends, public
    // holidays, and anything outside a term window. Reported, never refused —
    // a parent filing Friday-to-Tuesday is not claiming the weekend.
    const totalDays = inclusiveDayCount(row.start_date, row.end_date);
    const skipped = Math.max(0, totalDays - days.length);

    if (days.length > 0) {
      // ── Audit rows, shaped before the write ────────────────────────────
      //
      // ⚠ THIS PATH WRITES THROUGH THE SERVICE ROLE, SO IT LOGS ITS OWN MARKS.
      // Until migration 166 the `attendance_daily_audit` trigger logged them —
      // as 'system', about no child — and that was the only trace of a day
      // turning Excused because a certificate was approved. 166 makes the
      // trigger step aside for service-role writers; these rows replace it,
      // one per day, in the same shape the daily route writes, naming the
      // approver and the filing that caused the change.
      //
      // The reads are best-effort: an audit lookup that fails must not stop
      // an approved absence reaching the sheet, so errors leave the fields
      // null rather than throwing.
      const auditRows = await shapeRegisterAuditRows(service, {
        declaration: row,
        sectionName,
        exReason,
        dates: days.map((d) => ({ date: d.date, termId: d.termId })),
      });

      try {
        await writeDailyBatch(
          service,
          days.map((d) => ({
            sectionStudentId: row.section_student_id,
            termId: d.termId,
            date: d.date,
            status: 'EX' as const,
            exReason,
            // ⚠ The parent's note is NOT copied onto every day of the register.
            // It stays on the filing, which is where the approver reads it in
            // full. `ex_note` is the teacher's own field (KD #177) and stamping
            // a parent's sentence about a child's illness across five register
            // rows spreads it further than the absence itself.
            exNote: null,
            recordedBy: actorId,
          }))
        );
      } catch (e) {
        // The marks landed and a rollup did not: log what is on the sheet
        // before the failure is reported, or those days change with no name
        // against them. A refused insert committed nothing and logs nothing.
        if (e instanceof MarksWrittenRollupFailedError) {
          await writeAuditRows(
            service,
            auditActor,
            auditRows.map((r) => ({
              ...r,
              context: { ...r.context, partial: true, failed_step: 'rollup' },
            }))
          );
        }
        throw e;
      }

      await writeAuditRows(service, auditActor, auditRows);
    }

    // Stamp only after the marks land.
    const { error: stampErr } = await service
      .from('student_declarations')
      .update({
        register_written_at: new Date().toISOString(),
        register_days_written: days.length,
        register_write_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    if (stampErr) {
      // The marks ARE on the sheet; only the receipt is missing. Say so
      // honestly — the repair script keys on the missing stamp and re-runs,
      // which supersedes each day with an identical mark and is harmless.
      return {
        ok: false,
        error: `Marks written but not recorded on the filing: ${stampErr.message}`,
      };
    }

    return { ok: true, written: days.length, skipped, skippedReason: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Best-effort breadcrumb. A failure to record the failure must not throw.
    await service
      .from('student_declarations')
      .update({
        register_write_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    return { ok: false, error: message };
  }
}

/**
 * Batched when there is a person to name; one row at a time when there is not.
 *
 * `logActions` requires an actor id, and the repair script has none to give —
 * it passes `null`, and a null actor is the honest answer for a script run.
 * `logAction` accepts that, so the no-person case goes through it instead.
 */
async function writeAuditRows(
  service: SupabaseClient,
  actor: RegisterActor,
  rows: Awaited<ReturnType<typeof shapeRegisterAuditRows>>
): Promise<void> {
  if (actor.id != null) {
    await logActions(
      service,
      { id: actor.id, email: actor.email, role: actor.role },
      rows
    );
    return;
  }
  await Promise.all(rows.map((row) => logAction({ service, actor, ...row })));
}

/**
 * One `attendance.daily.*` audit row per day the approval marks Excused.
 *
 * ⚠ THE SAME KEYS AS `PATCH /api/attendance/daily` AND MIGRATION 166's TRIGGER,
 * so a day excused by an approval reads beside a day a teacher marked, with
 * `declaration_id` and `source` saying where it came from. A correction or an
 * update by the same "before today in Singapore" rule the other two use.
 *
 * ⚠ NO NOTE. The register write sets `ex_note` to null (see above), and the
 * parent's words never reach `audit_log` — migration 109's rule.
 */
async function shapeRegisterAuditRows(
  service: SupabaseClient,
  args: {
    declaration: DeclarationRow;
    sectionName: string | null;
    exReason: ExReason;
    dates: Array<{ date: string; termId: string }>;
  }
) {
  const { declaration, sectionName, exReason, dates } = args;

  let studentNumber: string | null = null;
  let studentName: string | null = null;
  const priorStatusByDate = new Map<string, string | null>();
  const priorNoteByDate = new Map<string, string | null>();

  try {
    const [studentRes, priorRes] = await Promise.all([
      service
        .from('section_students')
        .select('student:students(student_number, first_name, last_name)')
        .eq('id', declaration.section_student_id)
        .maybeSingle(),
      // The current mark per day is the newest row — the ledger is superseded
      // by `recorded_at desc` (migration 014). A filing is at most a few weeks
      // of days, so one read without paging is enough.
      service
        .from('attendance_daily')
        .select('date, status, ex_note, recorded_at')
        .eq('section_student_id', declaration.section_student_id)
        .in(
          'date',
          dates.map((d) => d.date)
        )
        .order('recorded_at', { ascending: false })
        .order('id', { ascending: false }),
    ]);

    type StudentEmbed = {
      student_number: string;
      first_name: string;
      last_name: string;
    };
    const embed = (
      studentRes.data as {
        student?: StudentEmbed | StudentEmbed[] | null;
      } | null
    )?.student;
    const student = Array.isArray(embed) ? embed[0] : embed;
    if (student) {
      studentNumber = student.student_number ?? null;
      studentName =
        `${student.first_name ?? ''} ${student.last_name ?? ''}`.trim() || null;
    }

    for (const p of (priorRes.data ?? []) as Array<{
      date: string;
      status: string | null;
      ex_note: string | null;
    }>) {
      if (priorStatusByDate.has(p.date)) continue;
      priorStatusByDate.set(p.date, p.status);
      priorNoteByDate.set(p.date, p.ex_note ?? null);
    }
  } catch (e) {
    console.error(
      '[declarations] register audit lookup failed; logging without it:',
      e instanceof Error ? e.message : String(e)
    );
  }

  const today = sgToday();
  return dates.map((d) => {
    const prior = priorStatusByDate.get(d.date) ?? null;
    return {
      action:
        d.date < today
          ? ('attendance.daily.correct' as const)
          : ('attendance.daily.update' as const),
      entityType: 'attendance_daily' as const,
      entityId: null,
      context: {
        section_student_id: declaration.section_student_id,
        section_id: declaration.section_id,
        section_name: sectionName,
        student_number: studentNumber,
        student_name: studentName,
        term_id: d.termId,
        date: d.date,
        status: 'EX',
        ...(prior !== null ? { prior_status: prior } : {}),
        ex_reason: exReason,
        // The approval clears whatever note the teacher had on the day.
        ...((priorNoteByDate.get(d.date) ?? null) !== null
          ? { ex_note_changed: true }
          : {}),
        // Where the mark came from. Without these the row reads as a person
        // editing the sheet by hand.
        source: 'declaration_approval',
        declaration_id: declaration.id,
        declaration_type: declaration.declaration_type,
      },
    };
  });
}
