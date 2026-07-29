import { revalidateTag } from 'next/cache';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import {
  APPLICATION_TERMINAL_STATUSES,
  ENROLLED_PREREQ_STAGES,
  isAdmissionsStageFrozen,
  POST_ENROLMENT_EDITABLE_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  STAGE_LABELS,
  STAGE_TERMINAL_STATUS,
  StageUpdateSchema,
  validateTerminalReason,
  type StageKey,
} from '@/lib/schemas/sis';
import { validateSectionChoice } from '@/lib/sis/class-assignment';
import {
  DOCUMENT_SLOTS,
  OPTIONAL_DOCUMENT_SLOT_KEYS,
  STP_CONDITIONAL_SLOT_KEYS,
} from '@/lib/sis/queries';
import { getEnrolmentPosition } from '@/lib/sis/terms';
import { stampEnrolledAtIfNull } from '@/lib/sis/enrolled-at';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { sgToday } from '@/lib/dates';
import { syncOneStudent } from '@/lib/sync/students';
import {
  invalidateAllOperationalDrills,
  invalidateDrillTags,
} from '@/lib/cache/invalidate-drill-tags';

// Documents-stage gate: setting documentStatus to one of these "done"
// values requires every required slot to be 'Valid' in the per-AY
// documents table. Validation lives in P-Files (KD #31), so we read the
// authoritative source there before letting admissions flip the stage.
const DOCUMENT_VERIFIED_STATUSES: ReadonlySet<string> = new Set([
  'Verified',
  'Finished',
]);

// PATCH /api/sis/students/[enroleeNumber]/stage/[stageKey]?ay=AY2026
//
// Updates one pipeline stage on the ay{YY}_enrolment_status row. Writes:
//   - <stage>Status, <stage>Remarks, plus any stage-specific extras
//   - <stage>UpdatedDate (now), <stage>UpdatedBy (actor email)
// Returns 400 on validation failure, 404 if no status row exists for the
// enrolee, 500 on DB error. Audit log entry written on success.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; stageKey: string }> }
) {
  // Per KD #74: admissions IS the operational role for /admissions/* writes.
  // school_admin is read-only oversight and must not silently overwrite stage data.
  const auth = await requireRole([
    'admissions',
    'academic_coordinator',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const { enroleeNumber, stageKey: rawStage } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json(
      { error: 'Missing enroleeNumber' },
      { status: 400 }
    );
  }
  if (!(STAGE_KEYS as readonly string[]).includes(rawStage)) {
    return NextResponse.json(
      { error: `Unknown stage: ${rawStage}` },
      { status: 400 }
    );
  }
  const stageKey = rawStage as StageKey;

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json(
      { error: 'Invalid or missing ay query param' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = StageUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { status, remarks, extras } = parsed.data;

  // Validate extras keys match what this stage allows.
  const cols = STAGE_COLUMN_MAP[stageKey];
  const allowedExtras = new Set(cols.extras.map((e) => e.fieldKey));
  if (extras) {
    for (const key of Object.keys(extras)) {
      if (!allowedExtras.has(key)) {
        return NextResponse.json(
          { error: `Stage "${stageKey}" does not accept extra field "${key}"` },
          { status: 400 }
        );
      }
    }
    // Validate date extras are yyyy-MM-dd or null.
    for (const e of cols.extras) {
      if (e.kind !== 'date') continue;
      const v = extras[e.fieldKey];
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json(
          { error: `${e.label} must be YYYY-MM-DD` },
          { status: 400 }
        );
      }
    }
  }

  const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
  const statusTable = `${prefix}_enrolment_status`;
  const supabase = createServiceClient();

  // 1) Confirm the row exists + capture pre-image for the audit diff.
  const beforeSelect = [
    cols.statusCol,
    cols.remarksCol,
    ...cols.extras.map((e) => e.columnName),
  ].join(', ');
  const { data: before, error: beforeErr } = await supabase
    .from(statusTable)
    .select(beforeSelect)
    .eq('enroleeNumber', enroleeNumber)
    .maybeSingle();
  if (beforeErr) {
    console.error('[sis stage PATCH] pre-fetch failed:', beforeErr.message);
    return NextResponse.json(
      { error: 'Status lookup failed' },
      { status: 500 }
    );
  }
  if (!before) {
    return NextResponse.json(
      { error: 'No status row for this enrolee in this AY' },
      { status: 404 }
    );
  }

  // 1.4) Post-enrolment stage freeze (module-ownership rule — historical vs
  // current truth, KD #147). Once a student is FULLY 'Enrolled', the admissions
  // funnel is historical: the post-enrolment lifecycle is owned by Records
  // (enrolment / withdrawal / re-enrolment — which cascades the applicationStatus
  // mirror) and P-Files (documents). Every stage freezes EXCEPT `supplies` +
  // `orientation`, which legitimately happen after enrolment and stay editable
  // until they reach a finalized status (then they lock too — forward-only).
  // 'Enrolled (Conditional)' is fully editable (it still has a condition to
  // resolve). The withdrawal / re-enrol cascades write applicationStatus via the
  // section-students route (direct table write), NOT this editor, so they are
  // unaffected. Shared `isAdmissionsStageFrozen` so the UI can't drift.
  const currentStageStatus =
    ((before as unknown as Record<string, unknown>)[cols.statusCol] as
      | string
      | null) ?? null;
  let currentAppStatus: string | null;
  if (stageKey === 'application') {
    currentAppStatus = currentStageStatus;
  } else {
    const { data: appRow } = await supabase
      .from(statusTable)
      .select('"applicationStatus"')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    currentAppStatus =
      (appRow as { applicationStatus: string | null } | null)
        ?.applicationStatus ?? null;
  }
  if (isAdmissionsStageFrozen(stageKey, currentStageStatus, currentAppStatus)) {
    const isPostEnrol = (
      POST_ENROLMENT_EDITABLE_STAGES as readonly string[]
    ).includes(stageKey);
    return NextResponse.json(
      isPostEnrol
        ? {
            error:
              'This step is already finalized and can no longer be changed.',
            code: 'stage_finalized',
          }
        : {
            error:
              'This student is enrolled — their record is now managed in Records (enrolment, withdrawal, re-enrolment) and P-Files (documents). The admissions funnel is read-only.',
            code: 'enrolled_frozen',
          },
      { status: 422 }
    );
  }

  // 1.5) Terminal-status reversal guard (M7 / KD #59).
  // Cancelled and Withdrawn are terminal states in the SIS funnel. Flipping
  // back to Enrolled directly bypasses the full intake workflow + the
  // withdrawal/re-enrolment cascades and leaves the audit trail inconsistent.
  // The right path depends on whether the student ever enrolled THIS AY:
  //   - enrolled-then-withdrawn (has a section_students row this AY) → restore
  //     their enrolment from Records, which re-activates the row AND flips this
  //     status back to Enrolled via the re-enrolment cascade (self-service).
  //   - never enrolled this AY (cancelled out of the pipeline) → a returning
  //     applicant re-applies through the parent portal; only a genuine mistake
  //     warrants an administrator reset.
  if (stageKey === 'application') {
    const preRow = before as unknown as Record<string, unknown>;
    const currentStatus = (preRow[cols.statusCol] as string | null) ?? null;
    if (
      (currentStatus === 'Withdrawn' || currentStatus === 'Cancelled') &&
      (status === 'Enrolled' || status === 'Enrolled (Conditional)')
    ) {
      // Did this student ever enrol THIS AY? They have a section_students row
      // (now withdrawn) only if so — that's the row Records would restore.
      // enroleeNumber → studentNumber → student_id → section_students scoped to
      // this AY (mirrors the withdrawal-cascade resolution further below). Only
      // runs on a reversal attempt, never on the happy path.
      let wasEnrolledHere = false;
      const admissions = createAdmissionsClient();
      const { data: appsRow } = await admissions
        .from(`${prefix}_enrolment_applications`)
        .select('studentNumber')
        .eq('enroleeNumber', enroleeNumber)
        .maybeSingle();
      const studentNumber =
        (appsRow as { studentNumber: string | null } | null)?.studentNumber ??
        null;
      if (studentNumber) {
        const [{ data: studentRow }, { data: ayRow }] = await Promise.all([
          supabase
            .from('students')
            .select('id')
            .eq('student_number', studentNumber)
            .maybeSingle(),
          supabase
            .from('academic_years')
            .select('id')
            .eq('ay_code', ayCode)
            .maybeSingle(),
        ]);
        const studentId = (studentRow as { id: string } | null)?.id ?? null;
        const ayId = (ayRow as { id: string } | null)?.id ?? null;
        if (studentId && ayId) {
          // Use the unaliased FK table name 'sections.academic_year_id' for the
          // embedded filter — the 'section:' alias is silently ignored here.
          const { data: ssRows } = await supabase
            .from('section_students')
            .select('id, section:sections!inner(academic_year_id)')
            .eq('student_id', studentId)
            .eq('sections.academic_year_id', ayId)
            .limit(1);
          wasEnrolledHere = ((ssRows ?? []) as unknown[]).length > 0;
        }
      }

      const message = wasEnrolledHere
        ? `This application is ${currentStatus}. This student was enrolled this year — to bring them back, restore their enrolment from Records (Students → open the student → Enrolment). That re-activates them and updates this status to Enrolled automatically, so no administrator reset is needed.`
        : `This application is ${currentStatus} and the student never enrolled this year, so it can't be reopened here. A returning applicant should submit a new application through the parent portal. Contact a system administrator only if this status was set by mistake.`;

      return NextResponse.json({ error: message }, { status: 422 });
    }
  }

  // 2) Build update payload.
  const update: Record<string, unknown> = {
    [cols.statusCol]: status,
    [cols.remarksCol]: remarks,
    [cols.updatedDateCol]: new Date().toISOString(),
    [cols.updatedByCol]: auth.user.email ?? '(unknown)',
  };
  if (extras) {
    for (const e of cols.extras) {
      const v = extras[e.fieldKey];
      if (v !== undefined) update[e.columnName] = v === '' ? null : v;
    }
  }

  // 2.0) Post-Enrolled section-change guard.
  // Section transfers for enrolled students must go through the dedicated
  // /transfer-section route, which atomically withdraws from the source
  // section + inserts into the target section in section_students. The
  // legacy class-stage path here only updates the admissions classSection
  // string and leaves section_students untouched, producing a silent
  // dual-section bug where the student appears in both sections' grading
  // rosters until the next bulk sync. Reject the change and point callers
  // to the correct endpoint.
  if (stageKey === 'class' && extras?.classSection !== undefined) {
    const beforeRow = before as unknown as Record<string, unknown>;
    const currentSection = (beforeRow.classSection as string | null) ?? null;
    const requestedSection =
      extras.classSection === '' ? null : extras.classSection;
    if (currentSection !== requestedSection && requestedSection !== null) {
      // Read applicationStatus to know if this is a post-Enrolled change.
      const { data: appStatusRow } = await supabase
        .from(statusTable)
        .select('applicationStatus')
        .eq('enroleeNumber', enroleeNumber)
        .maybeSingle();
      const appStatus = (
        appStatusRow as { applicationStatus: string | null } | null
      )?.applicationStatus;
      if (appStatus === 'Enrolled' || appStatus === 'Enrolled (Conditional)') {
        return NextResponse.json(
          {
            error: `Use POST /api/sis/students/${enroleeNumber}/transfer-section to move enrolled students between sections — this keeps section_students in sync atomically.`,
          },
          { status: 422 }
        );
      }
    }
  }

  // 2a) Documents-Verified/Finished gate.
  // Setting documentStatus to 'Verified' or 'Finished' means the admissions
  // team is asserting "documents are done." That assertion is only valid if
  // every required slot has been validated — `<slot>Status === 'Valid'` —
  // via the applicant-detail page's Documents tab. P-Files (KD #31) reads
  // those validated docs but doesn't write the validation flag itself.
  // Required = every slot EXCEPT:
  //   - medical + educCert (always-optional admissions-side, see
  //     `OPTIONAL_DOCUMENT_SLOT_KEYS`)
  //   - the 3 STP-conditional slots when the applications row's
  //     stpApplicationType is null (KD #61)
  //   - father slots (fatherPassport, fatherPass) when fatherEmail is empty
  //     on the apps row (single-mother household)
  //   - guardian slots (guardianPassport, guardianPass) when guardianEmail
  //     is empty on the apps row (no third-party guardian on file)
  // Mother slots are always required — mother is the anchor parent.
  // Block the stage flip with 422 + a slot-level breakdown so the UI can
  // surface what's still pending.
  if (
    stageKey === 'documents' &&
    status &&
    DOCUMENT_VERIFIED_STATUSES.has(status)
  ) {
    const docsTable = `${prefix}_enrolment_documents`;
    const appsTable = `${prefix}_enrolment_applications`;
    const slotStatusCols = DOCUMENT_SLOTS.map((s) => s.statusCol);

    const admissionsClient = createAdmissionsClient();
    const [docsRes, appRes] = await Promise.all([
      admissionsClient
        .from(docsTable)
        .select(['enroleeNumber', ...slotStatusCols].join(','))
        .eq('enroleeNumber', enroleeNumber)
        .maybeSingle(),
      admissionsClient
        .from(appsTable)
        .select('enroleeNumber, stpApplicationType, fatherEmail, guardianEmail')
        .eq('enroleeNumber', enroleeNumber)
        .maybeSingle(),
    ]);
    if (docsRes.error) {
      console.error(
        '[sis stage PATCH] documents row fetch failed:',
        docsRes.error.message
      );
      return NextResponse.json(
        { error: 'Documents lookup failed' },
        { status: 500 }
      );
    }
    if (appRes.error) {
      console.error(
        '[sis stage PATCH] application row fetch failed:',
        appRes.error.message
      );
      return NextResponse.json(
        { error: 'Application lookup failed' },
        { status: 500 }
      );
    }
    const docsRow = (docsRes.data ?? null) as Record<
      string,
      string | null
    > | null;
    const appsRow = (appRes.data ?? null) as {
      stpApplicationType: string | null;
      fatherEmail: string | null;
      guardianEmail: string | null;
    } | null;
    const stpEnabled = !!appsRow?.stpApplicationType;
    const fatherRequired = !!appsRow?.fatherEmail?.trim();
    const guardianRequired = !!appsRow?.guardianEmail?.trim();

    const optionalKeys = new Set<string>(OPTIONAL_DOCUMENT_SLOT_KEYS);
    const stpKeys = new Set<string>(STP_CONDITIONAL_SLOT_KEYS);
    const fatherKeys = new Set<string>(['fatherPassport', 'fatherPass']);
    const guardianKeys = new Set<string>(['guardianPassport', 'guardianPass']);

    type Blocker = {
      slot: string;
      label: string;
      current: string | null;
      expected: 'Valid';
    };
    const blockers: Blocker[] = [];
    for (const slot of DOCUMENT_SLOTS) {
      if (optionalKeys.has(slot.key)) continue;
      if (stpKeys.has(slot.key) && !stpEnabled) continue;
      if (fatherKeys.has(slot.key) && !fatherRequired) continue;
      if (guardianKeys.has(slot.key) && !guardianRequired) continue;
      const current = docsRow?.[slot.statusCol] ?? null;
      if (current !== 'Valid') {
        blockers.push({
          slot: slot.key,
          label: slot.label,
          current,
          expected: 'Valid',
        });
      }
    }
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot set documents to ${status} — ${blockers.length} required slot(s) not yet validated.`,
          blockers,
        },
        { status: 422 }
      );
    }
  }

  // 2b) Enrolled-prereq gate + registrar-chosen class assignment.
  // Setting applicationStatus = 'Enrolled' requires all 5 prereq stages at
  // their terminal values AND a client-supplied section with capacity.
  // 'Enrolled (Conditional)' deliberately bypasses this — it's the
  // registrar override for edge cases (transfers mid-year, late-arriving
  // documents, etc.). Per
  // docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md,
  // there is deliberately no auto-pick anywhere in the system: the
  // registrar must have already chosen a section via the picker before
  // this PATCH is submitted (wired into EditStageDialog, Task 3.6). If the
  // gate passes, we piggyback the class-assignment columns onto the same
  // UPDATE so the flip is atomic at the row level.
  let classAutoAssigned = false;
  if (stageKey === 'application' && status === 'Enrolled') {
    // Re-fetch the status row with every prereq column for the gate check.
    const prereqSelect = ENROLLED_PREREQ_STAGES.map(
      (k) => STAGE_COLUMN_MAP[k].statusCol
    ).join(', ');
    const { data: prereqRow, error: prereqErr } = await supabase
      .from(statusTable)
      .select(prereqSelect)
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (prereqErr || !prereqRow) {
      console.error(
        '[sis stage PATCH] prereq fetch failed:',
        prereqErr?.message
      );
      return NextResponse.json(
        { error: 'Prereq lookup failed' },
        { status: 500 }
      );
    }
    const prereqCurrent = prereqRow as unknown as Record<string, string | null>;
    const blockers: Array<{
      stage: string;
      current: string | null;
      expected: string;
    }> = [];
    for (const stage of ENROLLED_PREREQ_STAGES) {
      const col = STAGE_COLUMN_MAP[stage].statusCol;
      const expected = STAGE_TERMINAL_STATUS[stage]!;
      const current = prereqCurrent[col] ?? null;
      if (current !== expected) {
        blockers.push({
          stage: STAGE_LABELS[stage],
          current: current,
          expected,
        });
      }
    }
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: 'Prerequisite stages incomplete',
          blockers,
        },
        { status: 422 }
      );
    }

    // Gate passed. section_id is a required input here, not computed
    // server-side — no auto-pick anywhere.
    if (!parsed.data.section_id) {
      return NextResponse.json(
        { error: 'Pick a section before enrolling this student.' },
        { status: 422 }
      );
    }
    // Need the application row's studentNumber — what syncOneStudent uses
    // to upsert the public `students` row + section_students row; in
    // production the parent portal writes it alongside enroleeNumber at
    // intake, so a null here is anomalous. Fail loudly instead of letting
    // syncOneStudent silently skip with 'no studentNumber' (which would
    // land the row in an Enrolled status with no section roster
    // placement). Also carries levelApplied so validateSectionChoice can
    // confirm the chosen section's level matches the applicant's level.
    const admissionsClient = createAdmissionsClient();
    const appsTable = `${prefix}_enrolment_applications`;
    const { data: appRow, error: appErr } = await admissionsClient
      .from(appsTable)
      .select('studentNumber, levelApplied')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (appErr || !appRow) {
      console.error(
        '[sis stage PATCH] application row fetch failed:',
        appErr?.message
      );
      return NextResponse.json(
        { error: 'Cannot enroll: application row missing' },
        { status: 422 }
      );
    }
    const appLite = appRow as unknown as {
      studentNumber: string | null;
      levelApplied: string | null;
    };
    if (!appLite.studentNumber) {
      return NextResponse.json(
        {
          error:
            'Cannot enroll: this applicant has no Student Number on file. Student numbers are normally generated at parent-portal submission alongside the enrolee number — contact admissions support to assign one before enrolling.',
        },
        { status: 422 }
      );
    }

    const validated = await validateSectionChoice(
      supabase,
      parsed.data.section_id,
      ayCode,
      appLite.levelApplied
    );
    if ('error' in validated) {
      return NextResponse.json(
        { error: `Cannot enroll: ${validated.error}` },
        { status: 422 }
      );
    }

    // Merge class-assignment columns into the same update so the Enrolled
    // flip and the class write land atomically (single row UPDATE).
    const classCols = STAGE_COLUMN_MAP.class;
    const todayIso = new Date().toISOString();
    update[classCols.statusCol] = 'Finished';
    update['classLevel'] = validated.section.levelLabel;
    update['classSection'] = validated.section.name;
    update[classCols.updatedDateCol] = todayIso;
    update[classCols.updatedByCol] = auth.user.email ?? '(unknown)';
    classAutoAssigned = true;
  }

  // 2c) Terminal-status reason gate.
  // When the application stage flips to Cancelled / Withdrawn, a reason is
  // REQUIRED (and notes are required when the reason is "Other"). Shared
  // `validateTerminalReason` so the contract matches the unit test + the UI.
  // 422 carries a machine-readable `code` (reason_required / notes_required)
  // alongside the human message.
  if (
    stageKey === 'application' &&
    (APPLICATION_TERMINAL_STATUSES as readonly string[]).includes(status ?? '')
  ) {
    const reason = (extras as Record<string, unknown> | undefined)
      ?.terminalReason as string | undefined;
    const notes = (extras as Record<string, unknown> | undefined)
      ?.terminalNotes as string | undefined;

    const gate = validateTerminalReason(reason, notes);
    if (!gate.ok) {
      return NextResponse.json(
        { error: gate.error, code: gate.code },
        { status: 422 }
      );
    }
  }

  const { error: upErr } = await supabase
    .from(statusTable)
    .update(update)
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error('[sis stage PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // 2.5) Capture the enrolment moment (write-once). Whenever the application
  // stage reaches an Enrolled state, stamp enrolledAt = now() — but only when
  // it's still NULL, so a re-enrol or any later edit never overwrites the
  // original moment (migration 075). Fires on BOTH Enrolled and Enrolled
  // (Conditional), so the timestamp can't be skipped on the conditional path.
  // Best-effort: a failed stamp logs a warning and never blocks the flip.
  if (
    stageKey === 'application' &&
    (status === 'Enrolled' || status === 'Enrolled (Conditional)')
  ) {
    await stampEnrolledAtIfNull(supabase, statusTable, enroleeNumber);
  }

  // 3) Audit log diff — only fields that actually changed.
  const beforeRow = before as unknown as Record<string, unknown>;
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  for (const [col, next] of Object.entries(update)) {
    if (col === cols.updatedDateCol || col === cols.updatedByCol) continue;
    const prev = beforeRow[col] ?? null;
    if ((prev ?? null) !== (next ?? null)) {
      changes.push({ field: col, from: prev, to: next });
    }
  }

  // Suppress the audit row on a true no-op re-save. `changes` is the field
  // diff (empty when status/remarks/extras all match the pre-image) and
  // `classAutoAssigned` is the only column-write that happens outside the diff
  // (it merges into `update`, so its columns already show up in `changes` when
  // they actually change). The post-audit cascades (sync, withdrawal,
  // mid-term) only fire when a status was actually set, which makes `changes`
  // non-empty — so gating purely on `changes.length` never silences a real
  // mutation. Idempotent re-saves no longer write a duplicate stage row.
  if (changes.length > 0) {
    await logAction({
      service: supabase,
      actor: { id: auth.user.id, email: auth.user.email ?? null },
      action: 'sis.stage.update',
      entityType: 'enrolment_status',
      entityId: enroleeNumber,
      context: {
        ay_code: ayCode,
        stage: stageKey,
        stage_label: STAGE_LABELS[stageKey],
        changes,
        ...(stageKey === 'application' && {
          terminalReason:
            (extras as Record<string, unknown> | undefined)?.terminalReason ??
            null,
          terminalNotes:
            (extras as Record<string, unknown> | undefined)?.terminalNotes ??
            null,
        }),
      },
    });
  }

  // 4) Invalidate the per-AY cache so detail + list re-render with new data.
  revalidateTag(`sis:${ayCode}`, 'max');
  // Stage updates write the admissions-side enrolment_status row; both
  // admissions (funnel) and records (post-Enrolled view) drill on it.
  invalidateDrillTags('admissions', ayCode);
  invalidateDrillTags('records', ayCode);

  // 5) Auto-sync the grading roster when class placement is now complete.
  // Fires in three paths:
  //   (a) application → Enrolled — auto-assigned the class above.
  //   (b) application → Enrolled (Conditional) — the registrar override
  //       deliberately bypasses the prereq + auto-assign gate, but if a
  //       classSection is already on the admissions row (mid-year transfer,
  //       previously assigned then status edited) we still need to create
  //       the section_students row. The classCheck below guards the
  //       'no classSection yet' branch with a clean no-op.
  //   (c) class stage manually set to Finished (registrar override or
  //       reassignment) — need to confirm classLevel + classSection are
  //       both populated before syncing.
  // Post-update re-read ensures both class columns are non-null regardless
  // of path. When sync fails we surface autoSyncFailed in the response so
  // the dialog can warn — silent failure on (a)/(b) was the gap that left
  // enrolled students missing from Records' placement section.
  let autoSync: { change: string; reason?: string; error?: string } | null =
    null;
  let autoSyncFailed = false;
  const shouldSync =
    classAutoAssigned ||
    (stageKey === 'application' && status === 'Enrolled (Conditional)') ||
    (stageKey === 'class' && status === 'Finished');

  if (shouldSync) {
    const { data: classCheck } = await supabase
      .from(statusTable)
      .select('classLevel, classSection, classStatus')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    const check = (classCheck ?? {}) as {
      classLevel?: string | null;
      classSection?: string | null;
      classStatus?: string | null;
    };
    const hasClassPlacement =
      !!check.classLevel &&
      !!check.classSection &&
      check.classStatus === 'Finished';

    if (hasClassPlacement) {
      const admissions = createAdmissionsClient();
      const result = await syncOneStudent(
        supabase,
        admissions,
        enroleeNumber,
        ayCode
      );
      autoSync = {
        change: result.change,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
      if (
        result.ok &&
        (result.change === 'enrolled' ||
          result.change === 'inserted' ||
          result.change === 'reactivated')
      ) {
        await logAction({
          service: supabase,
          actor: { id: auth.user.id, email: auth.user.email ?? null },
          action: 'student.sync',
          entityType: 'sync_batch',
          entityId: enroleeNumber,
          context: {
            ay_code: ayCode,
            trigger: classAutoAssigned
              ? 'stage.application.enrolled'
              : 'stage.class.finished',
            enroleeNumber,
            change: result.change,
          },
        });
      } else if (!result.ok) {
        // Conditional path with no classSection set yet is the expected
        // no-op (registrar will assign a section later via the unsynced
        // queue). Don't flag it as a failure.
        const isConditionalNoSection =
          stageKey === 'application' &&
          status === 'Enrolled (Conditional)' &&
          (result.reason === 'missing classLevel or classSection' ||
            result.reason === 'no studentNumber');
        if (!isConditionalNoSection) {
          autoSyncFailed = true;
          console.warn(
            '[stage PATCH] auto-sync failed:',
            result.reason ?? result.error
          );
        }
      }
    }
  }

  // 6) enrollment_date stamp + mid-term enrolment detection.
  // When autosync lands a fresh/reactivated section_students row, stamp
  // enrollment_date=today so downstream term inference (KD #68 per-row "·T2"
  // badge, late-enrollee N/A logic) uses the actual Enrolled-flip date, not
  // the admissions row's earlier stamp. Boundary-only — only fires on the
  // three change values that indicate a real insertion or reactivation.
  // Then resolve the enrolment position; if a term is in session the dialog
  // surfaces the position-aware "join current / start next" late-enrollee prompt.
  type MidTermPayload = {
    termNumber: number; // joining term (active term mid-term, else next term)
    termLabel: string;
    sectionId: string;
    sectionStudentId: string;
    activeTermNumber: number | null; // null when joining during a break
    nextTermNumber: number | null;
    canDeferToNext: boolean;
    daysLeftInActiveTerm: number | null;
  };
  let midTermEnrolment: MidTermPayload | null = null;
  if (
    shouldSync &&
    autoSync &&
    (autoSync.change === 'enrolled' ||
      autoSync.change === 'inserted' ||
      autoSync.change === 'reactivated')
  ) {
    const { data: ss } = await supabase
      .from('section_students')
      .select('id, section_id, enrollment_date')
      .eq('enrolee_number', enroleeNumber)
      .neq('enrollment_status', 'withdrawn')
      .maybeSingle();
    const ssRow = ss as {
      id: string;
      section_id: string;
      enrollment_date: string | null;
    } | null;
    if (ssRow?.id && ssRow?.section_id) {
      const today = sgToday();
      if (ssRow.enrollment_date !== today) {
        const { error: dateErr } = await supabase
          .from('section_students')
          .update({ enrollment_date: today })
          .eq('id', ssRow.id);
        if (dateErr) {
          console.warn(
            '[stage PATCH] enrollment_date stamp failed:',
            dateErr.message
          );
        }
      }
      const pos = await getEnrolmentPosition(ayCode);
      // Late once the year has started — mid-term (activeTerm) OR between terms
      // (joining the next term). Use joiningTerm so the prompt also fires in a
      // break; the active-term-only fields stay null so the dialog renders the
      // single "join next term" option.
      if (pos.isLateEnrollee && pos.joiningTerm) {
        midTermEnrolment = {
          termNumber: pos.joiningTerm.termNumber,
          termLabel: `T${pos.joiningTerm.termNumber}`,
          sectionId: ssRow.section_id,
          sectionStudentId: ssRow.id,
          activeTermNumber: pos.activeTerm?.termNumber ?? null,
          nextTermNumber: pos.nextTerm?.termNumber ?? null,
          canDeferToNext: pos.canDeferToNext,
          daysLeftInActiveTerm: pos.daysLeftInActiveTerm,
        };
      }
    }
  }

  // 7) Withdrawn / Cancelled cascade.
  // When admissions flips applicationStatus to Withdrawn or Cancelled, every
  // active section_students row for this student in this AY needs to flip to
  // withdrawn — otherwise the student keeps appearing on rosters, attendance
  // grids, grading sheets, and dashboard KPIs. Mirrors the symmetric design
  // of the Enrolled auto-sync (admissions writes → grading-side reflects).
  // Honors Hard Rule #6 (append-only): we flip status + set withdrawal_date,
  // never delete; the row stays for grade preservation.
  let withdrawalCascade: {
    rowsAffected: number;
    sectionStudentIds: string[];
  } | null = null;
  if (
    stageKey === 'application' &&
    (status === 'Withdrawn' || status === 'Cancelled')
  ) {
    // Resolve student_number via the admissions apps row — section_students
    // is keyed off public.students.id, so we go enroleeNumber → studentNumber
    // → student_id → section_students.
    const admissions = createAdmissionsClient();
    const { data: appsRow } = await admissions
      .from(`${prefix}_enrolment_applications`)
      .select('studentNumber')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    const studentNumber =
      (appsRow as { studentNumber: string | null } | null)?.studentNumber ??
      null;

    if (studentNumber) {
      const { data: studentRow } = await supabase
        .from('students')
        .select('id')
        .eq('student_number', studentNumber)
        .maybeSingle();
      const studentId = (studentRow as { id: string } | null)?.id ?? null;

      if (studentId) {
        // Resolve the AY id so the cascade only touches THIS AY's rows.
        // section_students.section_id → sections.academic_year_id is the
        // path; we filter via a join inline.
        const { data: ayRow } = await supabase
          .from('academic_years')
          .select('id')
          .eq('ay_code', ayCode)
          .maybeSingle();
        const ayId = (ayRow as { id: string } | null)?.id ?? null;

        if (ayId) {
          // Load active+late_enrollee rows for this student in this AY so we
          // can capture the audit detail (which sections they were on) and
          // perform a targeted update.
          // Use 'sections.academic_year_id' (table name, not alias) — PostgREST
          // requires the unaliased FK table name for embedded column filters.
          // '.eq("section.academic_year_id", ...)' with the alias 'section:'
          // is silently ignored and returns rows from all AYs.
          const { data: activeRows } = await supabase
            .from('section_students')
            .select(
              'id, section_id, enrollment_status, section:sections!inner(id, name, academic_year_id)'
            )
            .eq('student_id', studentId)
            .in('enrollment_status', ENROLLED_STATUSES)
            .eq('sections.academic_year_id', ayId);

          const rows = (
            (activeRows ?? []) as Array<{
              id: string;
              section_id: string;
              enrollment_status: string;
              section:
                | { id: string; name: string; academic_year_id: string }
                | { id: string; name: string; academic_year_id: string }[]
                | null;
            }>
          ).map((r) => ({
            id: r.id,
            section_id: r.section_id,
            previous_status: r.enrollment_status,
            section_name:
              (Array.isArray(r.section) ? r.section[0] : r.section)?.name ??
              null,
          }));

          if (rows.length > 0) {
            const todayDate = sgToday();
            const ids = rows.map((r) => r.id);
            const { error: cascadeErr } = await supabase
              .from('section_students')
              .update({
                enrollment_status: 'withdrawn',
                withdrawal_date: todayDate,
              })
              .in('id', ids);
            if (cascadeErr) {
              console.warn(
                '[stage PATCH] withdrawal cascade update failed:',
                cascadeErr.message
              );
            } else {
              withdrawalCascade = {
                rowsAffected: rows.length,
                sectionStudentIds: ids,
              };
              await logAction({
                service: supabase,
                actor: { id: auth.user.id, email: auth.user.email ?? null },
                action: 'student.withdrawal.cascade',
                entityType: 'section_student',
                entityId: enroleeNumber,
                context: {
                  ay_code: ayCode,
                  trigger: `stage.application.${status.toLowerCase()}`,
                  enroleeNumber,
                  studentNumber,
                  rowsAffected: rows.length,
                  sections: rows.map((r) => ({
                    section_student_id: r.id,
                    section_id: r.section_id,
                    section_name: r.section_name,
                    previous_status: r.previous_status,
                  })),
                  withdrawal_date: todayDate,
                },
              });
              // Cascade touches grading-side rosters across every operational
              // module — fan out drill invalidation accordingly.
              invalidateAllOperationalDrills(ayCode);
            }
          }
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    changed: changes.length,
    classAutoAssigned,
    autoSync,
    autoSyncFailed,
    withdrawalCascade,
    midTermEnrolment,
  });
}
