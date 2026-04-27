import { unstable_cache } from 'next/cache';

import { createServiceClient } from '@/lib/supabase/service';
import {
  STAGE_KEYS,
  STAGE_LABELS,
  STAGE_COLUMN_MAP,
  STAGE_TERMINAL_STATUS,
  ENROLLED_PREREQ_STAGES,
  type StageKey,
} from '@/lib/schemas/sis';
import { DOCUMENT_SLOTS } from '@/lib/sis/queries';

// ──────────────────────────────────────────────────────────────────────────
// Process flow + lifecycle observability — Sprint 27 (2026-04-27).
//
// This is the v1 observability layer driving `docs/context/17-process-flow.md`:
// a per-student composite snapshot that stitches the 9 admissions stages with
// 5 downstream Markbook/Attendance/Parent stages, plus an aggregate per-AY
// blocker bucket count for the `/sis` dashboard widget.
//
// Hard rules honoured:
//  - studentNumber is the cross-AY spine (Hard Rule #4) — both reads keyed
//    via enroleeNumber on a single AY, but the timeline UI overlays prior-AY
//    entries via `getEnrollmentHistory()` (KD #4).
//  - No grade computation, no writes — pure read.
//  - service-role client INSIDE `unstable_cache` (KD #54) — never the
//    cookie-scoped server client.
// ──────────────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 60;

function prefixFor(ayCode: string): string {
  return `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
}

function tag(ayCode: string): string[] {
  return ['sis', `sis:${ayCode}`];
}

// Bucket the timeline rows render against. Drives the left-rail color +
// ChartLegendChip palette in the timeline component. Distinct from the
// admissions stage status string ('Finished', 'Pending', etc) — that string
// stays available in the row's `detail` for the human reader.
export type StageStatusBucket = 'done' | 'in_progress' | 'blocked' | 'not_started';

// Down-stream stages that don't live on `ay{YY}_enrolment_status`. Composed
// from grading/markbook tables and tagged here so the timeline can render the
// full lifecycle in a single iteration.
export type DownstreamStageKey =
  | 'markbook_sync'
  | 'grading'
  | 'attendance'
  | 'publication'
  | 'parent_view';

export type LifecycleStageKey = StageKey | DownstreamStageKey;

export type LifecycleStageRow = {
  stageKey: LifecycleStageKey;
  label: string;
  bucket: StageStatusBucket;
  // Free-text detail string ("documentStatus: Verified · 1 slot pending"
  // etc). Rendered small + muted, font-mono in the UI.
  detail?: string;
  // ISO-8601 timestamp string (UTC). Renderer formats at display via
  // toLocaleString('en-SG'), per KD #32.
  updatedAt?: string;
};

export type StudentLifecycleSnapshot = {
  studentNumber: string | null;
  enroleeNumber: string;
  ayCode: string;
  applicationStatus: string | null;
  // null when the student is not withdrawn. When set, the timeline grays
  // every row and surfaces a top-pinned amber pill.
  withdrawn: { date: string | null; reason: string | null } | null;
  rows: LifecycleStageRow[];
  // True when we hit a recoverable read error (duplicate status row,
  // missing AY-prefixed table, etc). The renderer can surface a soft
  // notice without tearing down the whole timeline.
  fetchWarnings: string[];
};

export type LifecycleBlockerBucket = {
  key: string;
  label: string;
  count: number;
  severity: 'good' | 'warn' | 'bad' | 'info';
  // String drill-target name consumed by the existing `lib/sis/drill.ts`
  // framework (KD #56). Wave 3 wires the API route — this layer just
  // declares what each bucket asks the drill router to render.
  drillTarget: string;
};

// ──────────────────────────────────────────────────────────────────────────
// Status helpers
// ──────────────────────────────────────────────────────────────────────────

// Maps an admissions stage status string onto our 4-tone bucket. "Cancelled"
// is intentionally rendered as `blocked` so admins see it as needing attention
// rather than a benign neutral.
function bucketForAdmissionsStatus(stageKey: StageKey, status: string | null): StageStatusBucket {
  const trimmed = (status ?? '').trim();
  if (!trimmed) return 'not_started';
  if (trimmed === 'Cancelled' || trimmed === 'Withdrawn' || trimmed === 'Rejected') return 'blocked';
  const terminal = STAGE_TERMINAL_STATUS[stageKey];
  if (terminal && trimmed === terminal) return 'done';
  // Application stage has its own terminal set (Enrolled / Enrolled (Conditional)).
  if (stageKey === 'application' && (trimmed === 'Enrolled' || trimmed === 'Enrolled (Conditional)')) {
    return 'done';
  }
  // 'Incomplete' on documents/class is a known blocker (admin needs to chase).
  if (trimmed === 'Incomplete') return 'blocked';
  return 'in_progress';
}

// Format an ISO date to a human "X days ago"-ish detail string. Pure
// pass-through here — the UI runs toLocaleString.
function formatDetail(parts: Array<string | null | undefined>): string | undefined {
  const filtered = parts.filter((p): p is string => !!p && p.trim().length > 0);
  return filtered.length > 0 ? filtered.join(' · ') : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-student composite — getStudentLifecycle
// ──────────────────────────────────────────────────────────────────────────

async function loadStudentLifecycleUncached(
  ayCode: string,
  enroleeNumber: string,
): Promise<StudentLifecycleSnapshot> {
  const prefix = prefixFor(ayCode);
  const supabase = createServiceClient();
  const fetchWarnings: string[] = [];

  // Build status / docs select column lists. We only need the columns that
  // feed the lifecycle (status + remarks + updatedDate per stage + a few
  // stage-specific extras for the document-stage detail). The full row is
  // pulled via getStudentDetail elsewhere — this lookup is intentionally
  // narrower so the cache row stays small.
  //
  // Per-stage updatedDate columns have inconsistent DB names
  // (`registrationUpdateDate` missing a "d", etc — see STAGE_COLUMN_MAP
  // comments). We select the raw column AND alias each to a stable key
  // shaped like `${stageKey}_updatedAt`, so downstream reads don't have to
  // re-derive the per-stage column quirks.
  const statusColumns = ['enroleeNumber'];
  for (const k of STAGE_KEYS) {
    const map = STAGE_COLUMN_MAP[k];
    statusColumns.push(map.statusCol, map.remarksCol);
    statusColumns.push(`${k}_updatedAt:${map.updatedDateCol}`);
  }
  // Stage-specific extras the timeline surfaces in detail strings.
  statusColumns.push(
    'assessmentSchedule',
    'feeInvoice',
    'feePaymentDate',
    'classAY',
    'classLevel',
    'classSection',
  );

  const docColumns = ['enroleeNumber', ...DOCUMENT_SLOTS.map((s) => s.statusCol)];

  // Run apps + status + docs + grading in parallel. The grading lookups depend
  // on studentNumber being known — first we resolve (apps row → studentNumber),
  // then look up grading once we have it. To keep the wall-clock low, the
  // first pass parallelises the admissions reads; grading reads chain after.
  const [appsRes, statusRes, docsRes] = await Promise.all([
    supabase
      .from(`${prefix}_enrolment_applications`)
      .select('enroleeNumber, studentNumber, enroleeFullName, levelApplied')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    supabase
      .from(`${prefix}_enrolment_status`)
      .select(statusColumns.join(', '))
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
    supabase
      .from(`${prefix}_enrolment_documents`)
      .select(docColumns.join(', '))
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle(),
  ]);

  if (appsRes.error) {
    fetchWarnings.push(`apps: ${appsRes.error.message}`);
  }
  if (statusRes.error) {
    fetchWarnings.push(`status: ${statusRes.error.message}`);
  }
  if (docsRes.error) {
    fetchWarnings.push(`documents: ${docsRes.error.message}`);
  }

  type AppRow = {
    enroleeNumber: string | null;
    studentNumber: string | null;
    enroleeFullName: string | null;
    levelApplied: string | null;
  };
  const app = (appsRes.data ?? null) as AppRow | null;
  const status = (statusRes.data ?? null) as Record<string, unknown> | null;
  const docs = (docsRes.data ?? null) as Record<string, string | null> | null;
  const studentNumber = app?.studentNumber ?? null;

  // Withdrawn check — applicationStatus='Withdrawn' wins. Use the aliased
  // `application_updatedAt` field for the "withdrawn on" date.
  const applicationStatus = (status?.['applicationStatus'] as string | null) ?? null;
  const isWithdrawn = (applicationStatus ?? '').trim() === 'Withdrawn';
  const withdrawnDate = (status?.['application_updatedAt'] as string | null) ?? null;
  const withdrawnReason = (status?.['applicationRemarks'] as string | null) ?? null;

  // Build admissions stage rows.
  const rows: LifecycleStageRow[] = [];
  for (const stageKey of STAGE_KEYS) {
    const map = STAGE_COLUMN_MAP[stageKey];
    const stageStatus = (status?.[map.statusCol] as string | null) ?? null;
    const stageRemarks = (status?.[map.remarksCol] as string | null) ?? null;
    const updatedAt = (status?.[`${stageKey}_updatedAt`] as string | null) ?? null;

    let detail: string | undefined;
    if (stageKey === 'documents') {
      // Document-stage detail: count slots in needs-action vs in-flight vs
      // settled. Slot status semantics differ by document type:
      //   - Non-expiring docs (idPicture, birthCert, educCert, medical, form12,
      //     icaPhoto, financialSupportDocs, vaccinationInformation): the flow
      //     is `null → 'Uploaded' → 'Valid'`. 'Uploaded' = parent uploaded but
      //     registrar hasn't validated yet, surfaced as `inFlight` here.
      //   - Expiring docs (passports + passes): `null → 'Valid' → 'Expired'`,
      //     no 'Uploaded' intermediate. The expiry date IS the validation.
      // 'Rejected' + 'Expired' both mean parent must re-upload (revalidation).
      let needsAction = 0; // null + Pending + Rejected + Expired
      let inFlight = 0;    // Uploaded (registrar needs to validate)
      let settled = 0;     // Valid + To follow
      let blank = 0;       // null specifically (subset of needsAction)
      for (const slot of DOCUMENT_SLOTS) {
        const slotStatus = (docs?.[slot.statusCol] ?? null)?.toString().trim() ?? '';
        if (!slotStatus) {
          blank += 1;
          needsAction += 1;
        } else if (slotStatus === 'Pending') {
          needsAction += 1;
        } else if (slotStatus === 'Rejected' || slotStatus === 'Expired') {
          needsAction += 1;
        } else if (slotStatus === 'Uploaded') {
          inFlight += 1;
        } else if (slotStatus === 'Valid' || slotStatus === 'To follow') {
          settled += 1;
        } else {
          // Unknown legacy values stay in needs-action so admin notices.
          needsAction += 1;
        }
      }
      detail = formatDetail([
        stageStatus ? `Status: ${stageStatus}` : null,
        `${settled}/${DOCUMENT_SLOTS.length} settled`,
        inFlight > 0 ? `${inFlight} awaiting validation` : null,
        needsAction > settled ? `${needsAction} needs action` : null,
        blank > 0 ? `${blank} blank` : null,
      ]);
    } else if (stageKey === 'assessment') {
      const schedule = (status?.['assessmentSchedule'] as string | null) ?? null;
      detail = formatDetail([
        stageStatus ? `Status: ${stageStatus}` : null,
        schedule ? `Scheduled ${schedule}` : 'No schedule',
        stageRemarks,
      ]);
    } else if (stageKey === 'fees') {
      const invoice = (status?.['feeInvoice'] as string | null) ?? null;
      const paid = (status?.['feePaymentDate'] as string | null) ?? null;
      detail = formatDetail([
        stageStatus ? `Status: ${stageStatus}` : null,
        invoice ? `Inv ${invoice}` : null,
        paid ? `Paid ${paid}` : null,
      ]);
    } else if (stageKey === 'class') {
      const classAY = (status?.['classAY'] as string | null) ?? null;
      const classLevel = (status?.['classLevel'] as string | null) ?? null;
      const classSection = (status?.['classSection'] as string | null) ?? null;
      detail = formatDetail([
        stageStatus ? `Status: ${stageStatus}` : null,
        [classAY, classLevel, classSection].filter(Boolean).join(' · ') || 'Unassigned',
      ]);
    } else {
      detail = formatDetail([
        stageStatus ? `Status: ${stageStatus}` : 'No status set',
        stageRemarks,
      ]);
    }

    rows.push({
      stageKey,
      label: STAGE_LABELS[stageKey],
      bucket: bucketForAdmissionsStatus(stageKey, stageStatus),
      detail,
      updatedAt: updatedAt ?? undefined,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Downstream stages — markbook_sync / grading / attendance / publication
  // / parent_view. Only meaningful once studentNumber is known.
  // ────────────────────────────────────────────────────────────────────

  // Default empty downstream rows (parent_view is always informational).
  let markbookSyncRow: LifecycleStageRow = {
    stageKey: 'markbook_sync',
    label: 'Markbook sync',
    bucket: 'not_started',
    detail: studentNumber ? 'Awaiting enrolment finalisation' : 'No studentNumber yet',
  };
  let gradingRow: LifecycleStageRow = {
    stageKey: 'grading',
    label: 'Grading',
    bucket: 'not_started',
    detail: 'No grading sheets yet',
  };
  let attendanceRow: LifecycleStageRow = {
    stageKey: 'attendance',
    label: 'Attendance',
    bucket: 'not_started',
    detail: 'No attendance records yet',
  };
  let publicationRow: LifecycleStageRow = {
    stageKey: 'publication',
    label: 'Report card publication',
    bucket: 'not_started',
    detail: 'No publication window',
  };
  const parentViewRow: LifecycleStageRow = {
    stageKey: 'parent_view',
    label: 'Parent portal',
    bucket: 'not_started',
    detail: 'Visible once a publication window opens',
  };

  if (studentNumber) {
    // Resolve student → section_students → section (must match this AY).
    // We also pull the academic_years row for the sections in that single
    // join since we need the AY filter without two round-trips.
    const { data: studentRow, error: studentErr } = await supabase
      .from('students')
      .select('id, student_number, is_active')
      .eq('student_number', studentNumber)
      .maybeSingle();
    if (studentErr) {
      fetchWarnings.push(`students: ${studentErr.message}`);
    }

    if (studentRow?.id) {
      // section_students for this student in this AY (via sections.academic_year_id).
      const { data: ayRow, error: ayErr } = await supabase
        .from('academic_years')
        .select('id')
        .eq('ay_code', ayCode)
        .maybeSingle();
      if (ayErr) {
        fetchWarnings.push(`academic_years: ${ayErr.message}`);
      }

      const ayId = (ayRow?.id as string | null) ?? null;
      if (ayId) {
        // section_students row(s) for this AY's sections.
        const { data: secStudents, error: secErr } = await supabase
          .from('section_students')
          .select(
            'id, section_id, enrollment_status, enrollment_date, sections!inner(id, name, academic_year_id)',
          )
          .eq('student_id', studentRow.id)
          .eq('sections.academic_year_id', ayId);
        if (secErr) {
          fetchWarnings.push(`section_students: ${secErr.message}`);
        }

        type SectionStudentRow = {
          id: string;
          section_id: string;
          enrollment_status: string;
          enrollment_date: string | null;
        };
        const enrollments = ((secStudents ?? []) as SectionStudentRow[]).filter(
          (r) => r.enrollment_status !== 'withdrawn',
        );

        if (enrollments.length > 0) {
          const sectionIds = enrollments.map((e) => e.section_id);
          const sectionStudentIds = enrollments.map((e) => e.id);
          const enrollDates = enrollments
            .map((e) => e.enrollment_date)
            .filter((d): d is string => !!d)
            .sort();
          markbookSyncRow = {
            stageKey: 'markbook_sync',
            label: 'Markbook sync',
            bucket: 'done',
            detail: formatDetail([
              `Enrolled in ${enrollments.length} section${enrollments.length === 1 ? '' : 's'}`,
            ]),
            updatedAt: enrollDates[0] ?? undefined,
          };

          // grading_sheets for those sections in this AY's terms.
          const { data: termRows } = await supabase
            .from('terms')
            .select('id, term_number')
            .eq('academic_year_id', ayId);
          const termIds = ((termRows ?? []) as Array<{ id: string }>).map((t) => t.id);
          if (termIds.length > 0) {
            const { data: sheetRows, error: sheetErr } = await supabase
              .from('grading_sheets')
              .select('id, is_locked, locked_at, term_id, section_id')
              .in('section_id', sectionIds)
              .in('term_id', termIds);
            if (sheetErr) {
              fetchWarnings.push(`grading_sheets: ${sheetErr.message}`);
            }
            type SheetRow = {
              id: string;
              is_locked: boolean;
              locked_at: string | null;
              term_id: string;
              section_id: string;
            };
            const sheets = (sheetRows ?? []) as SheetRow[];
            const totalSheets = sheets.length;
            const lockedSheets = sheets.filter((s) => s.is_locked).length;
            const lastLockedAt = sheets
              .map((s) => s.locked_at)
              .filter((d): d is string => !!d)
              .sort()
              .pop();
            if (totalSheets === 0) {
              gradingRow = {
                stageKey: 'grading',
                label: 'Grading',
                bucket: 'not_started',
                detail: 'No grading sheets generated yet',
              };
            } else {
              const allLocked = lockedSheets === totalSheets;
              const someLocked = lockedSheets > 0;
              gradingRow = {
                stageKey: 'grading',
                label: 'Grading',
                bucket: allLocked ? 'done' : someLocked ? 'in_progress' : 'not_started',
                detail: `${lockedSheets}/${totalSheets} sheet${totalSheets === 1 ? '' : 's'} locked`,
                updatedAt: lastLockedAt ?? undefined,
              };
            }

            // report_card_publications for these sections.
            const { data: pubRows, error: pubErr } = await supabase
              .from('report_card_publications')
              .select('section_id, term_id, publish_from, publish_until, updated_at')
              .in('section_id', sectionIds)
              .in('term_id', termIds);
            if (pubErr) {
              fetchWarnings.push(`report_card_publications: ${pubErr.message}`);
            }
            type PubRow = {
              section_id: string;
              term_id: string;
              publish_from: string;
              publish_until: string;
              updated_at: string | null;
            };
            const pubs = (pubRows ?? []) as PubRow[];
            if (pubs.length === 0) {
              publicationRow = {
                stageKey: 'publication',
                label: 'Report card publication',
                bucket: 'not_started',
                detail: 'No publication window opened',
              };
            } else {
              const now = new Date();
              const live = pubs.filter((p) => {
                const from = new Date(p.publish_from);
                const until = new Date(p.publish_until);
                return now >= from && now <= until;
              });
              const lastPub = pubs
                .map((p) => p.updated_at ?? p.publish_from)
                .sort()
                .pop();
              if (live.length > 0) {
                publicationRow = {
                  stageKey: 'publication',
                  label: 'Report card publication',
                  bucket: 'done',
                  detail: `${live.length} window${live.length === 1 ? '' : 's'} live · ${pubs.length} total`,
                  updatedAt: lastPub ?? undefined,
                };
              } else {
                publicationRow = {
                  stageKey: 'publication',
                  label: 'Report card publication',
                  bucket: 'in_progress',
                  detail: `${pubs.length} window${pubs.length === 1 ? '' : 's'} configured · none live now`,
                  updatedAt: lastPub ?? undefined,
                };
              }
              parentViewRow.bucket = live.length > 0 ? 'done' : 'in_progress';
              parentViewRow.detail =
                live.length > 0
                  ? `Visible to parent · ${live.length} term${live.length === 1 ? '' : 's'}`
                  : 'Outside publication window';
            }
          }

          // attendance_records keyed by section_student_id.
          if (sectionStudentIds.length > 0) {
            const { data: attendanceRows, error: attErr } = await supabase
              .from('attendance_records')
              .select('id, term_id, school_days, days_present, updated_at')
              .in('section_student_id', sectionStudentIds);
            if (attErr) {
              fetchWarnings.push(`attendance_records: ${attErr.message}`);
            }
            type AttRow = {
              id: string;
              term_id: string;
              school_days: number | null;
              days_present: number | null;
              updated_at: string | null;
            };
            const att = (attendanceRows ?? []) as AttRow[];
            if (att.length === 0) {
              attendanceRow = {
                stageKey: 'attendance',
                label: 'Attendance',
                bucket: 'not_started',
                detail: 'No attendance rollup yet',
              };
            } else {
              const lastAttUpdated = att
                .map((a) => a.updated_at)
                .filter((d): d is string => !!d)
                .sort()
                .pop();
              attendanceRow = {
                stageKey: 'attendance',
                label: 'Attendance',
                bucket: 'in_progress',
                detail: `${att.length} term rollup${att.length === 1 ? '' : 's'} on file`,
                updatedAt: lastAttUpdated ?? undefined,
              };
            }
          }
        }
      }
    }
  }

  rows.push(markbookSyncRow);
  rows.push(gradingRow);
  rows.push(attendanceRow);
  rows.push(publicationRow);
  rows.push(parentViewRow);

  return {
    studentNumber,
    enroleeNumber,
    ayCode,
    applicationStatus,
    withdrawn: isWithdrawn ? { date: withdrawnDate, reason: withdrawnReason } : null,
    rows,
    fetchWarnings,
  };
}

export async function getStudentLifecycle(
  ayCode: string,
  enroleeNumber: string,
): Promise<StudentLifecycleSnapshot> {
  return unstable_cache(
    () => loadStudentLifecycleUncached(ayCode, enroleeNumber),
    ['sis', 'student-lifecycle', ayCode, enroleeNumber],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )();
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregate per-AY blocker counts — getLifecycleAggregate
// ──────────────────────────────────────────────────────────────────────────

async function loadLifecycleAggregateUncached(
  ayCode: string,
): Promise<LifecycleBlockerBucket[]> {
  const prefix = prefixFor(ayCode);
  const supabase = createServiceClient();

  // We need the status row + every document slot status for the cohort, so
  // pull both tables in parallel keyed by enroleeNumber.
  const statusColumns = [
    'enroleeNumber',
    'applicationStatus',
    'feeStatus',
    'assessmentStatus',
    'assessmentSchedule',
    'contractStatus',
    'classSection',
    // Plus all stage status cols so we can detect ENROLLED_PREREQ_STAGES at terminal.
    ...ENROLLED_PREREQ_STAGES.map((s) => STAGE_COLUMN_MAP[s].statusCol),
  ];
  // De-dupe (feeStatus + assessmentStatus + contractStatus already overlap with prereq columns).
  const uniqStatusColumns = Array.from(new Set(statusColumns));

  const docColumns = ['enroleeNumber', ...DOCUMENT_SLOTS.map((s) => s.statusCol)];

  const [statusRes, docsRes] = await Promise.all([
    supabase.from(`${prefix}_enrolment_status`).select(uniqStatusColumns.join(', ')),
    supabase.from(`${prefix}_enrolment_documents`).select(docColumns.join(', ')),
  ]);

  if (statusRes.error) {
    console.warn('[sis/process] aggregate status fetch failed:', statusRes.error.message);
    return [];
  }

  type StatusRow = Record<string, string | null> & { enroleeNumber: string | null };
  type DocRow = Record<string, string | null> & { enroleeNumber: string | null };

  const statusRows = ((statusRes.data ?? []) as unknown as StatusRow[]).filter((r) => !!r.enroleeNumber);
  const docRows = ((docsRes.data ?? []) as unknown as DocRow[]).filter((r) => !!r.enroleeNumber);

  const docsByEnrolee = new Map<string, DocRow>();
  for (const d of docRows) {
    if (d.enroleeNumber) docsByEnrolee.set(d.enroleeNumber, d);
  }

  let awaitingFeePayment = 0;
  let awaitingDocRevalidation = 0;
  let awaitingDocValidation = 0;
  let awaitingAssessmentSchedule = 0;
  let awaitingContractSignature = 0;
  let missingClassAssignment = 0;
  let ungatedToEnroll = 0;
  let newApplications = 0;

  for (const r of statusRows) {
    const appStatus = (r.applicationStatus ?? '').trim();

    // 1. Awaiting fee payment — feeStatus !== 'Paid' AND in active funnel.
    if (
      r.feeStatus !== 'Paid' &&
      ['Submitted', 'Ongoing Verification', 'Processing'].includes(appStatus)
    ) {
      awaitingFeePayment += 1;
    }

    // 2. Awaiting document revalidation — any slot at 'Rejected' or 'Expired'.
    //    Revalidation buckets the "registrar/system rejected, parent must re-upload"
    //    population (severity bad).
    // 3. Awaiting document validation — any slot at 'Uploaded' (parent uploaded,
    //    registrar hasn't validated yet — only meaningful for non-expiring slots).
    //    A row with both 'Uploaded' and 'Rejected' slots counts in BOTH buckets;
    //    that's intentional — they're orthogonal action queues for the registrar.
    const docs = docsByEnrolee.get(r.enroleeNumber!);
    if (docs) {
      let rowHasRevalidation = false;
      let rowHasValidation = false;
      for (const slot of DOCUMENT_SLOTS) {
        const v = (docs[slot.statusCol] ?? '').toString().trim();
        if (v === 'Rejected' || v === 'Expired') rowHasRevalidation = true;
        else if (v === 'Uploaded') rowHasValidation = true;
        if (rowHasRevalidation && rowHasValidation) break;
      }
      if (rowHasRevalidation) awaitingDocRevalidation += 1;
      if (rowHasValidation) awaitingDocValidation += 1;
    }

    // 4. Awaiting assessment schedule.
    if (r.assessmentStatus === 'Pending' && !r.assessmentSchedule) {
      awaitingAssessmentSchedule += 1;
    }

    // 5. Awaiting contract signature.
    if (r.contractStatus === 'Generated' || r.contractStatus === 'Sent') {
      awaitingContractSignature += 1;
    }

    // 6. Missing class assignment — enrolled but no section.
    if (
      (appStatus === 'Enrolled' || appStatus === 'Enrolled (Conditional)') &&
      (!r.classSection || r.classSection.trim().length === 0)
    ) {
      missingClassAssignment += 1;
    }

    // 7. Ungated to enroll — all 5 prereqs at terminal but applicationStatus
    //    is not 'Enrolled'. Positive signal — one click away.
    const allPrereqsTerminal = ENROLLED_PREREQ_STAGES.every((s) => {
      const col = STAGE_COLUMN_MAP[s].statusCol;
      const terminal = STAGE_TERMINAL_STATUS[s];
      return terminal && (r[col] ?? '').toString().trim() === terminal;
    });
    if (
      allPrereqsTerminal &&
      appStatus !== 'Enrolled' &&
      appStatus !== 'Enrolled (Conditional)' &&
      appStatus !== 'Cancelled' &&
      appStatus !== 'Withdrawn'
    ) {
      ungatedToEnroll += 1;
    }

    // 8. New applications.
    if (appStatus === 'Submitted') {
      newApplications += 1;
    }
  }

  const buckets: LifecycleBlockerBucket[] = [
    {
      key: 'awaiting-fee-payment',
      label: 'Awaiting fee payment',
      count: awaitingFeePayment,
      severity: 'warn',
      drillTarget: 'awaiting-fee-payment',
    },
    {
      key: 'awaiting-document-revalidation',
      label: 'Awaiting document revalidation',
      count: awaitingDocRevalidation,
      severity: 'bad',
      drillTarget: 'awaiting-document-revalidation',
    },
    {
      key: 'awaiting-document-validation',
      label: 'Awaiting document validation',
      count: awaitingDocValidation,
      severity: 'warn',
      drillTarget: 'awaiting-document-validation',
    },
    {
      key: 'awaiting-assessment-schedule',
      label: 'Awaiting assessment schedule',
      count: awaitingAssessmentSchedule,
      severity: 'info',
      drillTarget: 'awaiting-assessment-schedule',
    },
    {
      key: 'awaiting-contract-signature',
      label: 'Awaiting contract signature',
      count: awaitingContractSignature,
      severity: 'info',
      drillTarget: 'awaiting-contract-signature',
    },
    {
      key: 'missing-class-assignment',
      label: 'Missing class assignment',
      count: missingClassAssignment,
      severity: 'bad',
      drillTarget: 'missing-class-assignment',
    },
    {
      key: 'ungated-to-enroll',
      label: 'Ungated to enroll',
      count: ungatedToEnroll,
      severity: 'good',
      drillTarget: 'ungated-to-enroll',
    },
    {
      key: 'new-applications',
      label: 'New applications',
      count: newApplications,
      severity: 'info',
      drillTarget: 'new-applications',
    },
  ];

  return buckets;
}

export async function getLifecycleAggregate(
  ayCode: string,
): Promise<LifecycleBlockerBucket[]> {
  return unstable_cache(
    () => loadLifecycleAggregateUncached(ayCode),
    ['sis', 'lifecycle-aggregate', ayCode],
    { tags: tag(ayCode), revalidate: CACHE_TTL_SECONDS },
  )();
}
