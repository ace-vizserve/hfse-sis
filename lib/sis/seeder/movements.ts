// Currently unused — will be revived alongside the populated seeder rewrite.
// Do not call until section_students / grades / attendance are seeded again.

import type { SupabaseClient } from '@supabase/supabase-js';

import { hashString, mulberry32 } from './random';
import {
  WITHDRAWAL_REASON_VALUES,
  type WithdrawalReason,
} from '@/lib/schemas/enrolment';

// Movements seeder — writes synthetic audit_log rows so /records/movements
// renders populated demo data on a freshly-seeded environment.
//
// Audit-log-only writes; we do NOT mutate section_students rosters. A real
// transfer/withdrawal/late-enrol mutation would cascade through grades,
// attendance, and evaluation rollups — too disruptive for seed data. The
// /records/movements page reads exclusively from audit_log, so the audit
// row alone is what the surface needs.
//
// Idempotent: counts existing transfer audit rows for this AY; if any are
// present the function returns 0 without writing.
//
// Note: a `'(unknown)'` actor_email is used because the seeder runs without
// a logged-in user. The page renders "—" for null actors, but this column
// is non-null in the audit-log schema, so we pass a recognisable sentinel
// instead. Real registrar-recorded movements show their real email.

const SEED_ACTOR_EMAIL = 'registrar.seed@hfse.test';

type AuditInsert = {
  actor_id: null;
  actor_email: string;
  action: 'student.section.transfer' | 'enrolment.metadata.update';
  entity_type: 'section_student';
  entity_id: string | null;
  context: Record<string, unknown>;
  created_at: string;
};

export async function seedMovements(
  service: SupabaseClient,
  testAy: { id: string; ay_code: string }
): Promise<number> {
  // Idempotency: skip if this AY already has any seeded transfer rows.
  const { count: existingTransferCount } = await service
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'student.section.transfer')
    .eq('context->>ay_code', testAy.ay_code);
  if ((existingTransferCount ?? 0) > 0) return 0;

  // Term windows — used to anchor each event's date to a plausible point in
  // the AY. Transfers land in T1 (already-finished). Withdrawals spread
  // across T1→T2. Late-enrols cluster in early T2. All term windows are kept
  // so each event's termNumber/termLabel can be DERIVED from its synthetic
  // date — matching the real routes, which resolve the term from the
  // transfer/enrolment date rather than hardcoding it.
  const { data: termRows } = await service
    .from('terms')
    .select('id, term_number, start_date, end_date')
    .eq('academic_year_id', testAy.id)
    .order('term_number');
  const terms = (termRows ?? []) as Array<{
    term_number: number;
    start_date: string | null;
    end_date: string | null;
  }>;
  const t1 = terms.find((t) => t.term_number === 1);
  const t2 = terms.find((t) => t.term_number === 2);
  if (!t1?.start_date || !t1?.end_date || !t2?.start_date || !t2?.end_date) {
    return 0;
  }

  // Resolve which term a yyyy-MM-dd date falls in (window-contains match),
  // mirroring lib/sis/terms.ts::getTermForDate. Returns null for dates that
  // sit in a between-terms break. Used to derive the audit context's
  // termNumber/termLabel from the event date instead of hardcoding it.
  const termForDate = (
    date: string
  ): { termNumber: number; termLabel: string } | null => {
    for (const t of terms) {
      if (!t.start_date || !t.end_date) continue;
      if (date >= t.start_date && date <= t.end_date) {
        return { termNumber: t.term_number, termLabel: `T${t.term_number}` };
      }
    }
    return null;
  };

  // Roster + section + level + student name for the test AY. The student name
  // join lets transfer rows carry `context.studentName` like the real route
  // does (transfer-section/route.ts writes result.studentName) — the movements
  // loader reads ctx.studentName first and only falls back to an AY-apps lookup
  // when it's absent (lib/sis/movements.ts:302/671).
  const { data: ssRows } = await service
    .from('section_students')
    .select(
      'id, enrolee_number, students!inner(first_name, last_name), sections!inner(id, name, academic_year_id, levels!inner(code, label))'
    )
    .eq('sections.academic_year_id', testAy.id);

  type SsRow = {
    id: string;
    enrolee_number: string | null;
    students:
      | { first_name: string | null; last_name: string | null }
      | { first_name: string | null; last_name: string | null }[];
    sections:
      | {
          id: string;
          name: string;
          levels:
            | { code: string; label: string }
            | { code: string; label: string }[];
        }
      | {
          id: string;
          name: string;
          levels:
            | { code: string; label: string }
            | { code: string; label: string }[];
        }[];
  };
  const roster = ((ssRows ?? []) as SsRow[]).map((r) => {
    const sec = Array.isArray(r.sections) ? r.sections[0] : r.sections;
    const lvl = Array.isArray(sec.levels) ? sec.levels[0] : sec.levels;
    const stu = Array.isArray(r.students) ? r.students[0] : r.students;
    const studentName =
      `${stu?.first_name ?? ''} ${stu?.last_name ?? ''}`.trim() || '(unnamed)';
    return {
      id: r.id,
      enroleeNumber: r.enrolee_number,
      studentName,
      sectionId: sec.id,
      sectionName: sec.name,
      // levelCode for internal grouping (same-level transfer pairing per
      // KD #67). levelLabel for the audit context's toLevel/fromLevel
      // fields — matches what the real transfer route writes
      // (lib/sis/section-transfer.ts:306-308) so the movements page
      // renders "Primary 1" not "P1".
      levelCode: lvl?.code ?? '',
      levelLabel: lvl?.label ?? lvl?.code ?? '',
    };
  });
  if (roster.length === 0) return 0;

  // Group sections by level so each transfer can pick a sibling section at
  // the same level (matches Hard Rule + KD #67's same-level constraint).
  const sectionsByLevel = new Map<
    string,
    Array<{ id: string; name: string }>
  >();
  for (const s of roster) {
    if (!s.levelCode) continue;
    let list = sectionsByLevel.get(s.levelCode);
    if (!list) {
      list = [];
      sectionsByLevel.set(s.levelCode, list);
    }
    if (!list.some((x) => x.id === s.sectionId)) {
      list.push({ id: s.sectionId, name: s.sectionName });
    }
  }

  // Only roster rows whose `enrolee_number` is populated are eligible for
  // transfers (the audit context needs it). Withdrawals + late-enrols use
  // the section_students.id UUID directly so they don't need it.
  //
  // Don't early-return when transferEligible is empty: withdrawals +
  // late-enrols still get seeded against the raw roster (using
  // section_students.id, which every row has). Only the transfer loop
  // gets skipped.
  const transferEligible = roster.filter((r) => !!r.enroleeNumber);

  const rand = mulberry32(hashString(`${testAy.ay_code}:movements`));
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const dateInWindow = (
    start: string,
    end: string
  ): { date: string; iso: string } => {
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const t = s + Math.floor(rand() * Math.max(1, e - s));
    const d = new Date(t);
    d.setUTCHours(4, 0, 0, 0); // 12:00 SGT — plausible registrar-edit time
    const iso = d.toISOString();
    return { date: iso.slice(0, 10), iso };
  };

  // Distinct picks per event class so no row plays multiple movement roles.
  const shuffled = [...roster].sort(() => rand() - 0.5);
  const transferPicks = shuffled
    .filter(
      (s) =>
        !!s.enroleeNumber &&
        (sectionsByLevel.get(s.levelCode)?.length ?? 0) >= 2
    )
    .slice(0, 5);
  const used = new Set(transferPicks.map((s) => s.id));
  const withdrawalPicks = shuffled.filter((s) => !used.has(s.id)).slice(0, 4);
  for (const w of withdrawalPicks) used.add(w.id);
  const lateEnrolPicks = shuffled.filter((s) => !used.has(s.id)).slice(0, 3);

  const inserts: AuditInsert[] = [];

  for (const s of transferPicks) {
    const siblings = (sectionsByLevel.get(s.levelCode) ?? []).filter(
      (x) => x.id !== s.sectionId
    );
    if (siblings.length === 0) continue;
    const target = pick(siblings);
    // Spread transfers across the T1→T2 span so the derived term varies
    // (the real route resolves termNumber from the transfer date, and the
    // movements loader re-derives it via termForDateInPreloaded — a single
    // hardcoded T1 would be both unfaithful and immediately overwritten).
    const { date, iso } = dateInWindow(t1.start_date, t2.end_date);
    const term = termForDate(date);
    inserts.push({
      actor_id: null,
      actor_email: SEED_ACTOR_EMAIL,
      action: 'student.section.transfer',
      entity_type: 'section_student',
      entity_id: s.enroleeNumber,
      context: {
        ay_code: testAy.ay_code,
        enroleeNumber: s.enroleeNumber,
        // studentName mirrors the real transfer route's context so the
        // movements feed renders the name without an AY-apps fallback.
        studentName: s.studentName,
        fromSection: s.sectionName,
        fromLevel: s.levelLabel,
        toSection: target.name,
        toLevel: s.levelLabel,
        targetSectionId: target.id,
        transferDate: date,
        termNumber: term?.termNumber ?? null,
        termLabel: term?.termLabel ?? null,
      },
      created_at: iso,
    });
  }

  // Withdrawals span T1 start → T2 end so the table shows variety across
  // months once the user toggles "Include prior years" off and on.
  for (const s of withdrawalPicks) {
    const { date, iso } = dateInWindow(t1.start_date, t2.end_date);
    inserts.push({
      actor_id: null,
      actor_email: SEED_ACTOR_EMAIL,
      action: 'enrolment.metadata.update',
      entity_type: 'section_student',
      entity_id: s.id,
      context: {
        section_id: s.sectionId,
        before: {
          enrollment_status: 'active',
          bus_no: null,
          classroom_officer_role: null,
        },
        after: {
          enrollment_status: 'withdrawn',
          withdrawal_date: date,
        },
        // Top-level reason (KD #111) — the movements feed reads
        // context.withdrawalReason, so the reason column renders instead of blank.
        withdrawalReason: pick([...WITHDRAWAL_REASON_VALUES]),
        withdrawalNotes: null,
      },
      created_at: iso,
    });
  }

  // Late-enrols cluster in early T2 — joining after T1 closed.
  for (const s of lateEnrolPicks) {
    const { date, iso } = dateInWindow(t2.start_date, t2.end_date);
    inserts.push({
      actor_id: null,
      actor_email: SEED_ACTOR_EMAIL,
      action: 'enrolment.metadata.update',
      entity_type: 'section_student',
      entity_id: s.id,
      context: {
        section_id: s.sectionId,
        before: {
          enrollment_status: 'active',
          bus_no: null,
          classroom_officer_role: null,
        },
        after: {
          enrollment_status: 'late_enrollee',
          enrollment_date: date,
        },
        lateEnrolleeTransition: true,
        lateEnrolleeTermNumber: 2,
        lateEnrolleeTermLabel: 'T2',
      },
      created_at: iso,
    });
  }

  if (inserts.length === 0) return 0;

  // Per-row insert (not a batch) so a single bad row doesn't tank the rest.
  // Historical case in point: transfer rows write entity_id=enroleeNumber
  // (string), which used to fail the UUID column check from migration 006
  // and crashed the whole batch including the withdrawals + late-enrols
  // that would have inserted fine. Migration 043 widens entity_id to text
  // and resolves the schema mismatch, but per-row insert is the defensive
  // floor — if a future seeder revision adds another row class with a
  // novel shape, it can't take down its siblings.
  let okCount = 0;
  for (const row of inserts) {
    const { error } = await service.from('audit_log').insert(row);
    if (error) {
      console.error(
        `[populated seeder] movements audit insert failed for action=${row.action} entity_id=${row.entity_id}:`,
        error.message
      );
      continue;
    }
    okCount += 1;
  }
  return okCount;
}
