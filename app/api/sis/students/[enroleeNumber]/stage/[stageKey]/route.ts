import { revalidateTag } from 'next/cache';
import { ENROLLED_STATUSES } from '@/lib/schemas/enrolment';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import {
  STUDENT_RECORD_WRITERS,
  canAssignSection,
} from '@/lib/auth/student-record';
import { logAction } from '@/lib/audit/log-action';
import {
  APPLICATION_TERMINAL_STATUSES,
  ENROLLED_PREREQ_STAGES,
  evaluateEnrolledFlip,
  findStageCompletionBlockers,
  isAdmissionsStageFrozen,
  POST_ENROLMENT_EDITABLE_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  STAGE_LABELS,
  stageCompletionMessage,
  StageUpdateSchema,
  validateTerminalReason,
  type StageKey,
} from '@/lib/schemas/sis';
import { validateSectionChoice } from '@/lib/sis/class-assignment';
import { resolveEffectiveStageValues } from '@/lib/sis/stage-completion';
import {
  DOCUMENT_SLOTS,
  OPTIONAL_DOCUMENT_SLOT_KEYS,
  STP_CONDITIONAL_SLOT_KEYS,
} from '@/lib/sis/queries';
import {
  completePlacement,
  type MidTermPayload,
} from '@/lib/sis/placement-completion';
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
  // Who may write the shared student record — see lib/auth/student-record.ts.
  // school_admin was added 2026-07-31 (KD #173): both pages that render these
  // editors already admitted her, so every save 403'd against a form that had
  // opened for her.
  const auth = await requireRole([...STUDENT_RECORD_WRITERS]);
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
  // `classSection` is read further down (2b) to decide whether an Enrolled
  // flip should say "awaiting class assignment". It is only one of THIS
  // stage's own columns when the stage IS `class`, so without naming it here
  // the pre-image never carried it and `preClass` was always undefined —
  // every Enrolled flip claimed the student was unplaced and sent them to
  // "Students needing setup", including one already placed through the class
  // stage beforehand. De-duped so the class stage doesn't select it twice.
  const beforeSelect = Array.from(
    new Set([
      cols.statusCol,
      cols.remarksCol,
      ...cols.extras.map((e) => e.columnName),
      'classSection',
    ])
  ).join(', ');
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
        // A student with no class yet isn't transferring — they're being
        // placed for the first time (step 11), which is what assign-section
        // is for. Sending them to transfer-section would fail, because there
        // is no source section to move them out of. Now that enrolling
        // without a class is the normal path, this is the common case.
        const route = currentSection
          ? `POST /api/sis/students/${enroleeNumber}/transfer-section to move enrolled students between sections`
          : `POST /api/sis/students/${enroleeNumber}/assign-section to place this student in a class for the first time`;
        return NextResponse.json(
          {
            error: `Use ${route} — this keeps section_students in sync atomically.`,
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

  // 2b) The Enrolled flip — step 10 of HFSE's admission process.
  //
  // Requires all 5 prereq stages at their terminal values. A CLASS IS NOT
  // REQUIRED: Class Assignment is step 11, done separately by Student Affairs
  // "subject to a deliberation by Academics Team"
  // (docs/context/admission-process.md). A student enrolled without one is a
  // normal, expected state — they surface in the students-needing-setup queue
  // and are placed later via /assign-section, which is also the only door once
  // `isAdmissionsStageFrozen` freezes the class stage.
  //
  // A section MAY still be supplied, as a convenience for a coordinator doing
  // both steps at once. There is deliberately no auto-pick anywhere (see
  // docs/superpowers/specs/2026-07-20-manual-section-assignment-design.md,
  // which predates the step-10/11 split and required the section outright).
  // When one is supplied we piggyback the class columns onto the same UPDATE
  // so the flip and the placement land atomically.
  //
  // 'Enrolled (Conditional)' skips this block entirely — the condition below
  // tests plain 'Enrolled' only, unchanged since Sprint 21. Per the Disclaimer
  // in docs/context/admission-process.md, conditional enrolment is an
  // ASSESSMENT OUTCOME (step 8): "did not pass the examination and/or with
  // declaration". It is NOT a way to enrol someone without a class, and NOT a
  // paperwork override — nothing in the process doc excuses a conditionally
  // enrolled student from registration, documents, contract or fees, all of
  // which this skip waives. RATIFIED 2026-08-13 (KD #180): Mr Ace decided the
  // skip stays. It is deliberate, not an oversight — do not "fix" this
  // condition to include 'Enrolled (Conditional)' without him asking first.
  let classAutoAssigned = false;
  let awaitingPlacement = false;
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

    // The apps row carries the studentNumber the gate may need and the
    // levelApplied validateSectionChoice compares the section against.
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

    const gate = evaluateEnrolledFlip({
      canAssignSection: canAssignSection(auth.role),
      sectionId: parsed.data.section_id,
      prereqStatuses: Object.fromEntries(
        ENROLLED_PREREQ_STAGES.map((k) => [
          k,
          prereqCurrent[STAGE_COLUMN_MAP[k].statusCol] ?? null,
        ])
      ),
      studentNumber: appLite.studentNumber,
    });
    if (!gate.ok) {
      return NextResponse.json(
        gate.blockers
          ? { error: gate.error, code: gate.code, blockers: gate.blockers }
          : { error: gate.error, code: gate.code },
        { status: gate.status }
      );
    }

    if (gate.assignsSection) {
      const validated = await validateSectionChoice(
        supabase,
        parsed.data.section_id!,
        ayCode,
        appLite.levelApplied
      );
      if ('error' in validated) {
        return NextResponse.json(
          { error: `Cannot enroll: ${validated.error}` },
          { status: 422 }
        );
      }

      const classCols = STAGE_COLUMN_MAP.class;
      const todayIso = new Date().toISOString();
      update[classCols.statusCol] = 'Finished';
      update['classLevel'] = validated.section.levelLabel;
      update['classSection'] = validated.section.name;
      update[classCols.updatedDateCol] = todayIso;
      update[classCols.updatedByCol] = auth.user.email ?? '(unknown)';
      classAutoAssigned = true;
    } else {
      // No section chosen — step 11 is still to come. Tell the client so it
      // can say so, rather than leaving a silent success that looks identical
      // to a fully-placed enrolment. Read the pre-update row: a student whose
      // class was already set through the class stage is NOT awaiting anything.
      const preClass = (before as unknown as Record<string, unknown>)
        .classSection as string | null | undefined;
      awaitingPlacement = !preClass?.trim();
    }
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

  // 2d) Stage completion gate — a status may not be saved while the fields
  // that status needs are still blank. Action item #1 from admin training
  // session #1 (Wynne, @24:43): the school asked for this, and the rules key
  // on (stage, STATUS) because "the required fields are depending on the
  // status selected". The rules themselves live in
  // STAGE_STATUS_REQUIRED_FIELDS, shared with the edit dialog so the button
  // that disables and the server that refuses cannot drift.
  //
  // THE CHECK IS ON THE MERGED ROW — the record as it will stand AFTER this
  // save, not the edit that was sent. That is the whole point of the feature:
  // a record already sitting at a finished status with a blank invoice is
  // refused even on a Remarks-only edit, which is how the existing backlog of
  // blank fields gets cleared as records are touched. Deliberate (Mr Ace,
  // explicit), not a side effect. The merge itself is
  // `resolveEffectiveStageValues`, which follows the same blank rules this
  // route writes with above ('' clears to null).
  //
  // WHY THIS SITS AFTER 2c AND MUST STAY THERE. The application →
  // Cancelled/Withdrawn → reason rule is in the map too, but 2c's
  // validateTerminalReason is STRICTER (it also checks the reason is a known
  // value and demands notes when it is 'other'). Running 2c first means its
  // specific message wins on the application stage and this block never fires
  // there — which matters, because every Cancelled/Withdrawn row in
  // production carries no reason and 2c is already refusing them. Do not move
  // this earlier, and do not weaken 2c.
  //
  // 400, not the 422 the gates above use: this is the response shape the item
  // was specified with. Left as-is on purpose — please don't "harmonise" it.
  {
    // StageUpdateSchema.status is nullable but NOT optional, so in practice
    // the key is always present; the merge is written for the general case
    // anyway rather than resting on that.
    const preImage = before as unknown as Record<string, unknown>;
    const effective = resolveEffectiveStageValues(
      cols,
      preImage,
      status,
      extras
    );
    const completionBlockers = findStageCompletionBlockers(
      stageKey,
      effective.status,
      effective.extras
    );
    if (completionBlockers.length > 0) {
      return NextResponse.json(
        {
          error: stageCompletionMessage(
            stageKey,
            effective.status ?? '',
            completionBlockers
          ),
          code: 'stage_fields_required',
          blockers: completionBlockers,
        },
        { status: 400 }
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
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
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
  //   (a) application → Enrolled — either a class was chosen above, or the
  //       row already carried one (set through the class stage BEFORE
  //       enrolment, which is legal — `class` is not a prereq stage and is
  //       only frozen once Enrolled). Both must sync; only the first sets
  //       classAutoAssigned, so this arm cannot key off that flag alone or a
  //       pre-placed student would enrol and never reach the roster — the
  //       exact admissions-vs-roster drift KD #90 exists to prevent.
  //   (b) application → Enrolled (Conditional) — same reasoning.
  //   (c) class stage manually set to Finished (registrar override or
  //       reassignment) — need to confirm classLevel + classSection are
  //       both populated before syncing.
  // Post-update re-read ensures both class columns are non-null regardless
  // of path; a genuinely unplaced student falls out at hasClassPlacement as a
  // clean no-op. When sync fails we surface autoSyncFailed in the response so
  // the dialog can warn — silent failure on (a)/(b) was the gap that left
  // enrolled students missing from Records' placement section.
  let autoSync: { change: string; reason?: string; error?: string } | null =
    null;
  let autoSyncFailed = false;
  const shouldSync =
    classAutoAssigned ||
    (stageKey === 'application' &&
      (status === 'Enrolled' || status === 'Enrolled (Conditional)')) ||
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
          actor: {
            id: auth.user.id,
            email: auth.user.email ?? null,
            role: auth.role,
          },
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
        // Enrolling without a class is step 10 finishing, not a failure —
        // Class Assignment is step 11 and the student is now sitting in the
        // students-needing-setup queue waiting for it. Same for a missing
        // student number, which that queue reports separately. Either way the
        // registrar has somewhere to go, so don't cry wolf in the dialog.
        const isExpectedUnplacedSkip =
          stageKey === 'application' &&
          (status === 'Enrolled' || status === 'Enrolled (Conditional)') &&
          (result.reason === 'missing classLevel or classSection' ||
            result.reason === 'no studentNumber');
        if (!isExpectedUnplacedSkip) {
          autoSyncFailed = true;
          console.warn(
            '[stage PATCH] auto-sync failed:',
            result.reason ?? result.error
          );
        }
      }
    }
  }

  // 6) The student now has a seat — stamp the attendance start date and work
  // out whether they're a late enrollee.
  // Boundary-only: fires on the three change values that mean a real insertion
  // or reactivation. Shared with the assign-section route
  // (`lib/sis/placement-completion.ts`), because placement can happen in
  // either — Enrolment is step 10 and Class Assignment is step 11 of HFSE's
  // admission process, so this route sees only the case where a registrar
  // chose to do both at once.
  let midTermEnrolment: MidTermPayload | null = null;
  if (
    shouldSync &&
    autoSync &&
    (autoSync.change === 'enrolled' ||
      autoSync.change === 'inserted' ||
      autoSync.change === 'reactivated')
  ) {
    const placement = await completePlacement(supabase, {
      enroleeNumber,
      ayCode,
    });
    midTermEnrolment = placement.midTermEnrolment;
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
                actor: {
                  id: auth.user.id,
                  email: auth.user.email ?? null,
                  role: auth.role,
                },
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
    // Enrolled, but step 11 hasn't happened — the dialog says so rather than
    // reporting a success indistinguishable from a fully-placed enrolment.
    awaitingPlacement,
    autoSync,
    autoSyncFailed,
    withdrawalCascade,
    midTermEnrolment,
  });
}
