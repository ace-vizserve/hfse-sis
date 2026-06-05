// School-realistic edge cases seeder.
// Layers on top of seedPopulated — must be run AFTER grade entries, attendance,
// admissions rows, and teacher assignments are all in place.
//
// Idempotency: every edge case checks the current DB state before writing.
// Re-running is safe; partial-failure aborts only the failing case.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeQuarterly } from '@/lib/compute/quarterly';
import { mulberry32, hashString, prefixFor } from './random';

export type EdgeCaseResult = {
  edge_cases_inserted: number;
};

export async function seedEdgeCases(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<EdgeCaseResult> {
  let count = 0;

  // ── 0. Setup — fetch terms, sections, enrolled section_students ────────────

  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', testAy.id)
    .in('term_number', [1, 2, 3, 4])
    .order('term_number');
  const terms = (termRows ?? []) as Array<{
    id: string;
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  }>;
  const t1 = terms.find((t) => t.term_number === 1);
  const t2 = terms.find((t) => t.term_number === 2);
  const t4 = terms.find((t) => t.term_number === 4);
  if (!t1 || !t2) return { edge_cases_inserted: 0 };

  const { data: sectionRows } = await service
    .from('sections')
    .select('id, name, level_id, levels(code)')
    .eq('academic_year_id', testAy.id);
  const sections = (sectionRows ?? []) as Array<{
    id: string;
    name: string;
    level_id: string;
    levels: { code: string } | { code: string }[] | null;
  }>;
  const levelCodeOf = (s: (typeof sections)[number]) =>
    Array.isArray(s.levels) ? s.levels[0]?.code : s.levels?.code;
  const grit = sections.find(
    (s) => s.name === 'Grit' && levelCodeOf(s) === 'P6'
  );
  const loyalty = sections.find(
    (s) => s.name === 'Loyalty' && levelCodeOf(s) === 'P6'
  );
  const excellence = sections.find(
    (s) => s.name === 'Excellence' && levelCodeOf(s) === 'S4'
  );
  if (!grit || !loyalty || !excellence) return { edge_cases_inserted: 0 };

  const { data: ssRows } = await service
    .from('section_students')
    .select('id, student_id, section_id, enrollment_status, index_number')
    .in('section_id', [grit.id, loyalty.id, excellence.id])
    .order('index_number');
  type SectionStudentRow = {
    id: string;
    student_id: string;
    section_id: string;
    enrollment_status: string;
    index_number: number;
  };
  const allSS = (ssRows ?? []) as SectionStudentRow[];
  const gritSS = allSS.filter((r) => r.section_id === grit.id);
  const loyaltySS = allSS.filter((r) => r.section_id === loyalty.id);
  const excellenceSS = allSS.filter((r) => r.section_id === excellence.id);
  if (allSS.length === 0) return { edge_cases_inserted: 0 };

  // Deterministic picks — PRNG-driven so picks stay stable across section-size
  // changes without hardcoding positional indices.
  const rand = mulberry32(hashString(`${testAy.ay_code}:edge-cases`));
  const gritLate = gritSS[Math.floor(rand() * gritSS.length)] ?? gritSS[0];
  const excellenceLate =
    excellenceSS[Math.floor(rand() * excellenceSS.length)] ?? excellenceSS[0];
  const gritWithdrawn = gritSS[Math.floor(rand() * gritSS.length)] ?? gritSS[0];
  const excellenceWithdrawn =
    excellenceSS[Math.floor(rand() * excellenceSS.length)] ?? excellenceSS[0];
  const gaStudent =
    excellenceSS[Math.floor(rand() * excellenceSS.length)] ?? excellenceSS[0];
  const compassionateStudent =
    excellenceSS[Math.floor(rand() * excellenceSS.length)] ?? excellenceSS[0];
  const peStudentRow =
    excellenceSS[Math.floor(rand() * excellenceSS.length)] ?? excellenceSS[0];
  const changeReq1 = gritSS[Math.floor(rand() * gritSS.length)] ?? gritSS[0];
  const changeReq2 =
    loyaltySS[Math.floor(rand() * loyaltySS.length)] ?? loyaltySS[0];
  const appliedCR =
    excellenceSS[Math.floor(rand() * excellenceSS.length)] ?? excellenceSS[0];
  const pfileStudent1 = gritSS[Math.floor(rand() * gritSS.length)] ?? gritSS[0];
  const pfileStudent2 =
    excellenceSS[Math.floor(rand() * excellenceSS.length)] ?? excellenceSS[0];
  const transferStudent =
    gritSS[Math.floor(rand() * gritSS.length)] ?? gritSS[0];

  // ── EC1 & EC2 — Late enrollees ─────────────────────────────────────────────
  try {
    const t2Start = t2.start_date ?? new Date().toISOString().slice(0, 10);
    const lateEnrollDate = new Date(t2Start);
    lateEnrollDate.setDate(lateEnrollDate.getDate() + 7);
    const t2EnrollDate = lateEnrollDate.toISOString().slice(0, 10);
    for (const ss of [gritLate, excellenceLate].filter(Boolean)) {
      if (!ss || ss.enrollment_status === 'late_enrollee') continue;
      const { error } = await service
        .from('section_students')
        .update({
          enrollment_status: 'late_enrollee',
          enrollment_date: t2EnrollDate,
          // Explicit T2 override — surfaces as "T2 (corrected)" badge on the
          // Records placement section (KD #111 / migration 067).
          late_enrollee_term_number: 2,
        })
        .eq('id', ss.id)
        .eq('enrollment_status', 'active');
      if (!error) count++;

      // Null out T1 grade entries so the late-enrollee proration path fires.
      const { data: t1Sheets } = await service
        .from('grading_sheets')
        .select('id')
        .eq('section_id', ss.section_id)
        .eq('term_id', t1.id);
      const t1SheetIds = (t1Sheets ?? []).map((s) => (s as { id: string }).id);
      for (const sheetId of t1SheetIds) {
        await service
          .from('grade_entries')
          .update({
            ww_scores: null,
            pt_scores: null,
            qa_score: null,
            // Clear the server-computed columns too. ww_total/pt_total do NOT
            // exist on grade_entries (they live on grading_sheets) — PostgREST
            // silently ignores unknown columns, so the stale computed values
            // would otherwise survive the "nullify" and the proration / missing-
            // grade paths wouldn't fire. The real computed columns are ww_ps /
            // pt_ps / qa_ps / initial_grade (per 001_initial_schema.sql).
            ww_ps: null,
            pt_ps: null,
            qa_ps: null,
            initial_grade: null,
            quarterly_grade: null,
          })
          .eq('grading_sheet_id', sheetId)
          .eq('section_student_id', ss.id);
      }

      // Re-run the attendance rollup for T1 + T2 now that enrollment_date is
      // set. seedAttendanceSummary already inserted attendance_daily rows for
      // this student across the FULL T1 + early-T2 windows (it ran while the
      // student was still 'active', enrollment_date NULL — so no proration
      // applied). Without this recompute the stored attendance_records rollup
      // keeps counting those pre-enrolment days; recomputing now exercises the
      // migration-068 `date >= enrollment_date` proration filter genuinely —
      // T1 (entirely before the late-enrol date) collapses to 0/0/0 and the
      // early-T2 days before t2EnrollDate drop out of the denominator.
      for (const term of [t1, t2]) {
        const { error: rollupErr } = await service.rpc(
          'recompute_attendance_rollup',
          { p_term_id: term.id, p_section_student_id: ss.id }
        );
        if (rollupErr) {
          console.error(
            `[edge-cases] EC1/EC2 rollup recompute failed for T${term.term_number} ${ss.id}:`,
            rollupErr.message
          );
        }
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC1/EC2 late enrollees failed:', err);
  }

  // ── EC3 & EC4 — Withdrawn students ────────────────────────────────────────
  try {
    const t2Mid = t2.start_date
      ? new Date(new Date(t2.start_date).getTime() + 14 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    // Deterministic withdrawal reasons per student.
    // Records placement tab reads section_students.withdrawal_reason (snake_case column).
    // Movements feed reads audit_log.context.withdrawalReason (camelCase key).
    // Both must be populated so each surface renders the reason label (KD #111).
    const withdrawalMeta = new Map<string, { reason: string; notes: string }>([
      [
        gritWithdrawn?.id ?? '',
        {
          reason: 'family_relocation',
          notes: 'Family relocating overseas at end of term.',
        },
      ],
      [
        excellenceWithdrawn?.id ?? '',
        {
          reason: 'transferred_other_school',
          notes: 'Student transferring to an international school.',
        },
      ],
    ]);

    for (const ss of [gritWithdrawn, excellenceWithdrawn].filter(Boolean)) {
      if (!ss || ss.enrollment_status === 'withdrawn') continue;
      const wMeta = withdrawalMeta.get(ss.id) ?? {
        reason: 'other',
        notes: null,
      };
      const { error } = await service
        .from('section_students')
        .update({
          enrollment_status: 'withdrawn',
          withdrawal_date: t2Mid,
          withdrawal_reason: wMeta.reason,
          withdrawal_notes: wMeta.notes,
        })
        .eq('id', ss.id)
        .eq('enrollment_status', 'active');
      if (!error) {
        count++;
        await service.from('audit_log').insert({
          action: 'enrolment.metadata.update',
          actor_email: 'registrar.seed@hfse.test',
          entity_type: 'section_student',
          entity_id: ss.id,
          context: {
            before: { enrollment_status: 'active' },
            after: {
              enrollment_status: 'withdrawn',
              withdrawal_date: t2Mid,
              // camelCase key — what lib/sis/movements.ts:413 reads for reasonLabel.
              withdrawalReason: wMeta.reason,
              withdrawalNotes: wMeta.notes,
            },
          },
        });
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC3/EC4 withdrawals failed:', err);
  }

  // ── EC5 & EC6 — Pending grade change requests ──────────────────────────────
  try {
    // Resolve teacher user ID once (used by EC5, EC6, EC7)
    const { data: teacherUser } = await service.auth.admin.listUsers({
      perPage: 200,
    });
    const teacherEmail = 'sarah.chen@demo.com';
    const teacher = teacherUser?.users.find((u) => u.email === teacherEmail);
    const teacherId = teacher?.id;

    // Grit T1 locked sheet (EC5)
    const { data: gritT1SheetsRaw } = await service
      .from('grading_sheets')
      .select('id, ww_totals')
      .eq('section_id', grit.id)
      .eq('term_id', t1.id)
      .eq('is_locked', true)
      .limit(2);
    const gritT1Sheet = (gritT1SheetsRaw ?? [])[0] as
      | { id: string; ww_totals: number[] | null }
      | undefined;

    // Loyalty T1 locked sheet (EC6)
    const { data: loyaltyT1SheetsRaw } = await service
      .from('grading_sheets')
      .select('id, ww_totals')
      .eq('section_id', loyalty.id)
      .eq('term_id', t1.id)
      .eq('is_locked', true)
      .limit(1);
    const loyaltyT1Sheet = (loyaltyT1SheetsRaw ?? [])[0] as
      | { id: string; ww_totals: number[] | null }
      | undefined;

    if (gritT1Sheet && changeReq1 && teacherId) {
      const { count: existingCRs } = await service
        .from('grade_change_requests')
        .select('id', { count: 'exact', head: true })
        .eq('grading_sheet_id', gritT1Sheet.id)
        .eq('status', 'pending');

      if (!existingCRs) {
        const { data: ge } = await service
          .from('grade_entries')
          .select('id, ww_scores')
          .eq('grading_sheet_id', gritT1Sheet.id)
          .eq('section_student_id', changeReq1.id)
          .maybeSingle();
        const geRow = ge as { id: string; ww_scores: number[] | null } | null;
        if (geRow) {
          const currentVal = String(geRow.ww_scores?.[0] ?? 8);
          const proposedVal = String((geRow.ww_scores?.[0] ?? 8) + 1);
          const { error } = await service.from('grade_change_requests').insert({
            grading_sheet_id: gritT1Sheet.id,
            grade_entry_id: geRow.id,
            field_changed: 'ww_scores',
            slot_index: 0,
            current_value: currentVal,
            proposed_value: proposedVal,
            reason_category: 'data_entry_error',
            justification:
              'Score was recorded incorrectly during data entry. Student received full marks on paper.',
            status: 'pending',
            requested_by: teacherId,
            requested_by_email: teacherEmail,
            eligible_approver_snapshot: [],
          });
          if (!error) count++;
        }
      }
    }

    if (loyaltyT1Sheet && changeReq2 && teacherId) {
      const { count: existingCRs } = await service
        .from('grade_change_requests')
        .select('id', { count: 'exact', head: true })
        .eq('grading_sheet_id', loyaltyT1Sheet.id)
        .eq('status', 'pending');

      if (!existingCRs) {
        const { data: ge } = await service
          .from('grade_entries')
          .select('id, ww_scores')
          .eq('grading_sheet_id', loyaltyT1Sheet.id)
          .eq('section_student_id', changeReq2.id)
          .maybeSingle();
        const geRow = ge as { id: string; ww_scores: number[] | null } | null;
        if (geRow) {
          const currentVal = String(geRow.ww_scores?.[0] ?? 7);
          const proposedVal = String((geRow.ww_scores?.[0] ?? 7) + 1);
          const { error } = await service.from('grade_change_requests').insert({
            grading_sheet_id: loyaltyT1Sheet.id,
            grade_entry_id: geRow.id,
            field_changed: 'ww_scores',
            slot_index: 0,
            current_value: currentVal,
            proposed_value: proposedVal,
            reason_category: 'data_entry_error',
            justification:
              'Score was transcribed incorrectly from the physical worksheet. Correction verified.',
            status: 'pending',
            requested_by: teacherId,
            requested_by_email: teacherEmail,
            eligible_approver_snapshot: [],
          });
          if (!error) count++;
        }
      }
    }

    // ── EC7 — Applied change request (S4 Excellence) ─────────────────────────
    const { data: excellenceT1SheetsRaw } = await service
      .from('grading_sheets')
      .select('id, ww_totals')
      .eq('section_id', excellence.id)
      .eq('term_id', t1.id)
      .eq('is_locked', true)
      .limit(1);
    const excellenceT1Sheet = (excellenceT1SheetsRaw ?? [])[0] as
      | { id: string; ww_totals: number[] | null }
      | undefined;

    if (excellenceT1Sheet && appliedCR && teacherId) {
      const t1End = t1.end_date ?? new Date().toISOString().slice(0, 10);
      const approvedAt = new Date(t1End + 'T12:00:00+08:00').toISOString();
      const appliedAt = new Date(
        new Date(approvedAt).getTime() + 24 * 60 * 60 * 1000
      ).toISOString();

      const { count: existingApplied } = await service
        .from('grade_change_requests')
        .select('id', { count: 'exact', head: true })
        .eq('grading_sheet_id', excellenceT1Sheet.id)
        .eq('status', 'applied');

      if (!existingApplied) {
        const { data: ge } = await service
          .from('grade_entries')
          .select('id, ww_scores')
          .eq('grading_sheet_id', excellenceT1Sheet.id)
          .eq('section_student_id', appliedCR.id)
          .maybeSingle();
        const geRow = ge as { id: string; ww_scores: number[] | null } | null;
        if (geRow) {
          const currentVal = String(geRow.ww_scores?.[0] ?? 8);
          const { error } = await service.from('grade_change_requests').insert({
            grading_sheet_id: excellenceT1Sheet.id,
            grade_entry_id: geRow.id,
            field_changed: 'ww_scores',
            slot_index: 0,
            current_value: currentVal,
            proposed_value: String((geRow.ww_scores?.[0] ?? 8) + 1),
            reason_category: 'regrading',
            justification:
              'Student appealed after reviewing their paper. Marks adjusted accordingly after second check.',
            status: 'applied',
            requested_by: teacherId,
            requested_by_email: teacherEmail,
            approved_at: approvedAt,
            applied_at: appliedAt,
            applied_by: teacherId,
            primary_reviewed_by: teacherId,
            primary_reviewed_by_email: teacherEmail,
            primary_reviewed_at: approvedAt,
            primary_decision: 'approved',
            eligible_approver_snapshot: [],
          });
          if (!error) count++;
        }
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC5/EC6/EC7 change requests failed:', err);
  }

  // ── EC8 — P-Files expired chase outreach ──────────────────────────────────
  try {
    const prefix = prefixFor(testAy.ay_code);
    const appsTable = `${prefix}_enrolment_applications`;

    for (const ss of [pfileStudent1, pfileStudent2].filter(Boolean)) {
      if (!ss) continue;
      const { data: studentRow } = await service
        .from('students')
        .select('student_number')
        .eq('id', ss.student_id)
        .maybeSingle();
      const sn = (studentRow as { student_number: string } | null)
        ?.student_number;
      if (!sn) continue;

      const { data: appRow } = await service
        .from(appsTable)
        .select('enroleeNumber')
        .eq('studentNumber', sn)
        .maybeSingle();
      const enroleeNumber = (appRow as { enroleeNumber: string } | null)
        ?.enroleeNumber;
      if (!enroleeNumber) continue;

      const { count: existing } = await service
        .from('p_file_outreach')
        .select('id', { count: 'exact', head: true })
        .eq('ay_code', testAy.ay_code)
        .eq('enrolee_number', enroleeNumber)
        .eq('slot_key', 'passport')
        .eq('kind', 'reminder');

      if (!existing) {
        const { error } = await service.from('p_file_outreach').insert({
          ay_code: testAy.ay_code,
          enrolee_number: enroleeNumber,
          slot_key: 'passport',
          kind: 'reminder',
        });
        if (!error) count++;
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC8 P-Files outreach failed:', err);
  }

  // ── EC9 — Compassionate-leave quota exhausted ──────────────────────────────
  try {
    if (compassionateStudent) {
      for (const term of [t1, t2].filter(Boolean) as (typeof terms)[number][]) {
        const daysNeeded = term.term_number === 1 ? 3 : 2;
        const { data: calRows } = await service
          .from('school_calendar')
          .select('date')
          .eq('term_id', term.id)
          .in('day_type', ['school_day', 'hbl'])
          .order('date')
          .limit(daysNeeded);
        const dates = (calRows ?? []).map((r) => (r as { date: string }).date);

        for (const date of dates) {
          const { count: existing } = await service
            .from('attendance_daily')
            .select('id', { count: 'exact', head: true })
            .eq('section_student_id', compassionateStudent.id)
            .eq('date', date)
            .eq('ex_reason', 'compassionate');
          if (!existing) {
            const { error } = await service.from('attendance_daily').insert({
              section_student_id: compassionateStudent.id,
              date,
              status: 'EX',
              ex_reason: 'compassionate',
              recorded_by: 'registrar.seed@hfse.test',
            });
            if (!error) count++;
          }
        }

        // Recompute rollup so the quota dashboard card reflects the new rows.
        await service.rpc('recompute_attendance_rollup', {
          p_term_id: term.id,
          p_section_student_id: compassionateStudent.id,
        });
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC9 compassionate-leave failed:', err);
  }

  // ── EC10 — PE 'E' letter-grade override (non-examinable) ──────────────────
  try {
    if (t4 && peStudentRow) {
      const { data: peConfig } = await service
        .from('subject_configs')
        .select('id, subjects!inner(code)')
        .eq('level_id', excellence.level_id)
        .eq('subjects.code', 'PE')
        .maybeSingle();
      const peConfigId = (peConfig as { id: string } | null)?.id;

      if (peConfigId) {
        const { data: peSheet } = await service
          .from('grading_sheets')
          .select('id')
          .eq('section_id', excellence.id)
          .eq('term_id', t4.id)
          .eq('subject_config_id', peConfigId)
          .maybeSingle();
        const peSheetId = (peSheet as { id: string } | null)?.id;

        if (peSheetId) {
          const { error } = await service
            .from('grade_entries')
            .update({ letter_grade: 'E' })
            .eq('grading_sheet_id', peSheetId)
            .eq('section_student_id', peStudentRow.id);
          if (!error) count++;
        }
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC10 PE E-override failed:', err);
  }

  // ── EC11 — GA 88.4 student (S4 Excellence, all examinable subjects) ────────
  // S4 weights: ww=0.30, pt=0.50, qa=0.20
  // Score plan: ww=[9,9], pt=[9,9,9], qa=25 → quarterly=88 (T1-T3)
  //             ww=[9,9], pt=[9,9,9], qa=26 → quarterly=89 (T4)
  // Subject overall = 88×0.2+88×0.2+88×0.2+89×0.4 = 88.4
  // General average = ROUND(AVG(88.4, ...), 1) = 88.4  — just below Bronze (88.5)
  try {
    if (gaStudent) {
      // Fetch subject configs for S4 including weights
      const { data: allConfigs } = await service
        .from('subject_configs')
        .select(
          'id, ww_weight, pt_weight, qa_weight, subjects!inner(is_examinable)'
        )
        .eq('level_id', excellence.level_id);

      type ConfigRow = {
        id: string;
        ww_weight: number;
        pt_weight: number;
        qa_weight: number;
        subjects: { is_examinable: boolean } | { is_examinable: boolean }[];
      };
      const examinableConfigs = ((allConfigs ?? []) as ConfigRow[]).filter(
        (c) => {
          const sub = Array.isArray(c.subjects) ? c.subjects[0] : c.subjects;
          return sub?.is_examinable === true;
        }
      );

      const t3 = terms.find((t) => t.term_number === 3);
      const targetTerms = [t1, t2, t3, t4].filter(
        Boolean
      ) as (typeof terms)[number][];

      for (const termInfo of targetTerms) {
        const isT4 = termInfo.term_number === 4;
        for (const cfg of examinableConfigs) {
          const { data: sheetRaw } = await service
            .from('grading_sheets')
            .select('id, ww_totals, pt_totals, qa_total')
            .eq('section_id', excellence.id)
            .eq('term_id', termInfo.id)
            .eq('subject_config_id', cfg.id)
            .maybeSingle();
          const sheetRow = sheetRaw as {
            id: string;
            ww_totals: number[] | null;
            pt_totals: number[] | null;
            qa_total: number | null;
          } | null;
          if (!sheetRow) continue;

          const wwTotals = (sheetRow.ww_totals ?? [10, 10]).map(() => 10);
          const ptTotals = (sheetRow.pt_totals ?? [10, 10, 10]).map(() => 10);
          const qaTotalVal = sheetRow.qa_total ?? 30;

          // Guard: skip subjects whose slot counts or qa_total differ from the
          // 88.4 score plan (ww=2, pt=3, qa=30). Logs a warning so the mismatch
          // is visible without aborting the whole seeder.
          if (
            wwTotals.length !== 2 ||
            ptTotals.length !== 3 ||
            qaTotalVal !== 30
          ) {
            console.warn(
              `[edge-cases] EC11 skip subject_config ${cfg.id}: unexpected slot counts or qa_total (ww=${wwTotals.length}, pt=${ptTotals.length}, qa=${qaTotalVal})`
            );
            continue;
          }

          const wwScores = wwTotals.map(() => 9);
          const ptScores = ptTotals.map(() => 9);
          const qaScore = isT4 ? 26 : 25;

          const computed = computeQuarterly({
            ww_scores: wwScores,
            ww_totals: wwTotals,
            pt_scores: ptScores,
            pt_totals: ptTotals,
            qa_score: qaScore,
            qa_total: qaTotalVal,
            ww_weight: cfg.ww_weight,
            pt_weight: cfg.pt_weight,
            qa_weight: cfg.qa_weight,
          });

          const { error } = await service
            .from('grade_entries')
            .update({
              ww_scores: wwScores,
              pt_scores: ptScores,
              qa_score: qaScore,
              ww_total: wwScores.reduce((a, b) => a + b, 0),
              pt_total: ptScores.reduce((a, b) => a + b, 0),
              quarterly_grade: computed.quarterly_grade,
            })
            .eq('grading_sheet_id', sheetRow.id)
            .eq('section_student_id', gaStudent.id);
          if (!error) count++;
        }
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC11 GA 88.4 failed:', err);
  }

  // ── EC12 — Mid-year section transfer (P6 Grit → P6 Loyalty) ──────────────
  try {
    // Re-fetch live status — PRNG picks can collide with EC3's withdrawn student.
    const { data: liveTransfer } = transferStudent
      ? await service
          .from('section_students')
          .select('enrollment_status')
          .eq('id', transferStudent.id)
          .maybeSingle()
      : { data: null };
    if (
      transferStudent &&
      (liveTransfer as { enrollment_status: string } | null)
        ?.enrollment_status === 'active'
    ) {
      const t2Start = t2.start_date ?? new Date().toISOString().slice(0, 10);
      const transferDate = new Date(
        new Date(t2Start).getTime() + 3 * 24 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(0, 10);

      // Idempotency: check if target-section already has an active row for this student
      const { count: loyaltyActive } = await service
        .from('section_students')
        .select('id', { count: 'exact', head: true })
        .eq('student_id', transferStudent.student_id)
        .eq('section_id', loyalty.id)
        .eq('enrollment_status', 'active');

      if (!loyaltyActive) {
        // Step A: withdraw from Grit
        await service
          .from('section_students')
          .update({
            enrollment_status: 'withdrawn',
            withdrawal_date: transferDate,
          })
          .eq('id', transferStudent.id);

        // Step B: insert into Loyalty with next available index number
        const maxIdx = Math.max(0, ...loyaltySS.map((r) => r.index_number)) + 1;
        await service.from('section_students').insert({
          section_id: loyalty.id,
          student_id: transferStudent.student_id,
          index_number: maxIdx,
          enrollment_status: 'active',
          enrollment_date: transferDate,
        });

        // Step C: audit log (KD #83 reads this for the movements page)
        await service.from('audit_log').insert({
          action: 'student.section.transfer',
          actor_email: 'registrar.seed@hfse.test',
          entity_type: 'section_student',
          entity_id: transferStudent.id,
          context: {
            fromSectionName: 'Grit',
            toSectionName: 'Loyalty',
            transferDate,
          },
        });
        count++;
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC12 section transfer failed:', err);
  }

  // ── EC13 — Term-over-term grade swings (grading-sheet Alerts column) ───────
  // The base grade seeder memoizes each student's "quality" so their quarterly
  // grade is nearly flat across terms — almost nothing trips the ≥5 "significant
  // change" alert (score-entry-grid AlertCell / GradeDiffDialog). Rig two S4
  // Excellence students — one improving, one declining — with wide per-term raw
  // gaps so the resulting quarterly swings are comfortably ≥5 and the Alerts
  // column lights up from T2 onward. Excludes students already special-cased by
  // other edge cases so the demo students stay clean. Idempotent (deterministic
  // overwrite of the same rows).
  try {
    const t3 = terms.find((t) => t.term_number === 3);
    const swingTerms = [t1, t2, t3, t4].filter(
      Boolean
    ) as (typeof terms)[number][];

    const { data: cfgRows } = await service
      .from('subject_configs')
      .select(
        'id, ww_weight, pt_weight, qa_weight, subjects!inner(is_examinable)'
      )
      .eq('level_id', excellence.level_id);
    type Cfg = {
      id: string;
      ww_weight: number;
      pt_weight: number;
      qa_weight: number;
      subjects: { is_examinable: boolean } | { is_examinable: boolean }[];
    };
    const examinable = ((cfgRows ?? []) as Cfg[]).filter((c) => {
      const s = Array.isArray(c.subjects) ? c.subjects[0] : c.subjects;
      return s?.is_examinable === true;
    });

    // Two clean Excellence students not already touched by another edge case.
    const usedIds = new Set(
      [
        excellenceLate,
        excellenceWithdrawn,
        gaStudent,
        compassionateStudent,
        peStudentRow,
        appliedCR,
        pfileStudent2,
      ]
        .filter(Boolean)
        .map((s) => (s as SectionStudentRow).id)
    );
    const swingCandidates = excellenceSS.filter(
      (s) => s.enrollment_status === 'active' && !usedIds.has(s.id)
    );

    // Wide per-term raw-percentage patterns → quarterly swings well over 5.
    const plans: Array<{
      student: SectionStudentRow;
      pct: Record<number, number>;
    }> = [];
    if (swingCandidates[0])
      plans.push({
        student: swingCandidates[0],
        pct: { 1: 0.6, 2: 0.84, 3: 0.7, 4: 0.98 }, // improving
      });
    if (swingCandidates[1])
      plans.push({
        student: swingCandidates[1],
        pct: { 1: 0.98, 2: 0.78, 3: 0.94, 4: 0.66 }, // declining
      });

    for (const plan of plans) {
      for (const termInfo of swingTerms) {
        const pct = plan.pct[termInfo.term_number] ?? 0.85;
        for (const cfg of examinable) {
          const { data: sheetRaw } = await service
            .from('grading_sheets')
            .select('id, ww_totals, pt_totals, qa_total')
            .eq('section_id', excellence.id)
            .eq('term_id', termInfo.id)
            .eq('subject_config_id', cfg.id)
            .maybeSingle();
          const sheet = sheetRaw as {
            id: string;
            ww_totals: number[] | null;
            pt_totals: number[] | null;
            qa_total: number | null;
          } | null;
          if (!sheet) continue;

          const wwTotals = (sheet.ww_totals ?? []).length
            ? (sheet.ww_totals as number[])
            : [10, 10];
          const ptTotals = (sheet.pt_totals ?? []).length
            ? (sheet.pt_totals as number[])
            : [10, 10, 10];
          const qaTotal = sheet.qa_total ?? 30;
          const clamp = (v: number, max: number) =>
            Math.max(0, Math.min(max, Math.round(v)));
          const wwScores = wwTotals.map((m) => clamp(pct * m, m));
          const ptScores = ptTotals.map((m) => clamp(pct * m, m));
          const qaScore = clamp(pct * qaTotal, qaTotal);

          const computed = computeQuarterly({
            ww_scores: wwScores,
            ww_totals: wwTotals,
            pt_scores: ptScores,
            pt_totals: ptTotals,
            qa_score: qaScore,
            qa_total: qaTotal,
            ww_weight: cfg.ww_weight,
            pt_weight: cfg.pt_weight,
            qa_weight: cfg.qa_weight,
          });

          const { error } = await service
            .from('grade_entries')
            .update({
              ww_scores: wwScores,
              pt_scores: ptScores,
              qa_score: qaScore,
              ww_total: wwScores.reduce((a, b) => a + b, 0),
              pt_total: ptScores.reduce((a, b) => a + b, 0),
              ww_ps: computed.ww_ps,
              pt_ps: computed.pt_ps,
              qa_ps: computed.qa_ps,
              initial_grade: computed.initial_grade,
              quarterly_grade: computed.quarterly_grade,
            })
            .eq('grading_sheet_id', sheet.id)
            .eq('section_student_id', plan.student.id);
          if (!error) count++;
        }
      }
    }
  } catch (err) {
    console.error('[edge-cases] EC13 grade swings failed:', err);
  }

  return { edge_cases_inserted: count };
}
