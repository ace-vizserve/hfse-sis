// ⚠ NO `import 'server-only'`, for the same reason `lib/declarations/approval.ts`
// omits it: `scripts/repair-declaration-approvals.ts` imports this module and
// runs under tsx, where the `server-only` package throws outright.
//
//   THIS IS SERVER CODE. It uses the service-role client and bypasses RLS.
//   Never import it from a client component.

import type { SupabaseClient } from '@supabase/supabase-js';

import { writeDailyBatch } from '@/lib/attendance/mutations';
import { expandSchoolDays } from '@/lib/attendance/school-days';
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
 */
const REGISTER_WRITING_TYPES = new Set(['absence', 'travel']);

export type RegisterWriteResult =
  | { ok: true; written: number; skipped: number; skippedReason: null }
  | { ok: true; written: 0; skipped: 0; skippedReason: 'not_applicable' }
  | { ok: false; error: string };

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
  actorId: string | null
): Promise<RegisterWriteResult> {
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
    const { data: sectionRow } = await service
      .from('sections')
      .select('levels(code)')
      .eq('id', row.section_id)
      .maybeSingle();
    const levelCode =
      (sectionRow as { levels?: { code?: string | null } | null } | null)
        ?.levels?.code ?? null;
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
