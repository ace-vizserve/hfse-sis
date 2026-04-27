import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import {
  ENROLLED_PREREQ_STAGES,
  STAGE_COLUMN_MAP,
  STAGE_KEYS,
  STAGE_LABELS,
  STAGE_TERMINAL_STATUS,
  StageUpdateSchema,
  type StageKey,
} from '@/lib/schemas/sis';
import { pickSectionForApplicant } from '@/lib/sis/class-assignment';
import { createServiceClient } from '@/lib/supabase/service';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { syncOneStudent } from '@/lib/sync/students';

// PATCH /api/sis/students/[enroleeNumber]/stage/[stageKey]?ay=AY2026
//
// Updates one pipeline stage on the ay{YY}_enrolment_status row. Writes:
//   - <stage>Status, <stage>Remarks, plus any stage-specific extras
//   - <stage>UpdatedDate (now), <stage>UpdatedBy (actor email)
// Returns 400 on validation failure, 404 if no status row exists for the
// enrolee, 500 on DB error. Audit log entry written on success.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ enroleeNumber: string; stageKey: string }> },
) {
  const auth = await requireRole(['registrar', 'school_admin', 'admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { enroleeNumber, stageKey: rawStage } = await params;
  if (!enroleeNumber.trim()) {
    return NextResponse.json({ error: 'Missing enroleeNumber' }, { status: 400 });
  }
  if (!(STAGE_KEYS as readonly string[]).includes(rawStage)) {
    return NextResponse.json({ error: `Unknown stage: ${rawStage}` }, { status: 400 });
  }
  const stageKey = rawStage as StageKey;

  const url = new URL(request.url);
  const ayCode = (url.searchParams.get('ay') ?? '').trim();
  if (!/^AY\d{4}$/i.test(ayCode)) {
    return NextResponse.json({ error: 'Invalid or missing ay query param' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = StageUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
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
          { status: 400 },
        );
      }
    }
    // Validate date extras are yyyy-MM-dd or null.
    for (const e of cols.extras) {
      if (e.kind !== 'date') continue;
      const v = extras[e.fieldKey];
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: `${e.label} must be YYYY-MM-DD` }, { status: 400 });
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
    return NextResponse.json({ error: 'Status lookup failed' }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: 'No status row for this enrolee in this AY' }, { status: 404 });
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

  // 2a) Enrolled-prereq gate + auto class assignment.
  // Setting applicationStatus = 'Enrolled' requires all 5 prereq stages at
  // their terminal values AND a section with capacity. 'Enrolled (Conditional)'
  // deliberately bypasses this — it's the registrar override for edge cases
  // (transfers mid-year, late-arriving documents, etc.). If the gate passes,
  // we piggyback the class-assignment columns onto the same UPDATE so the
  // flip is atomic at the row level.
  let classAutoAssigned = false;
  if (stageKey === 'application' && status === 'Enrolled') {
    // Re-fetch the status row with every prereq column for the gate check.
    const prereqSelect = ENROLLED_PREREQ_STAGES.map(
      (k) => STAGE_COLUMN_MAP[k].statusCol,
    ).join(', ');
    const { data: prereqRow, error: prereqErr } = await supabase
      .from(statusTable)
      .select(prereqSelect)
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (prereqErr || !prereqRow) {
      console.error('[sis stage PATCH] prereq fetch failed:', prereqErr?.message);
      return NextResponse.json({ error: 'Prereq lookup failed' }, { status: 500 });
    }
    const prereqCurrent = prereqRow as unknown as Record<string, string | null>;
    const blockers: Array<{ stage: string; current: string | null; expected: string }> = [];
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
        { status: 422 },
      );
    }

    // Gate passed — auto-assign a class. Need the application row's
    // levelApplied / classType / preferredSchedule for the scoring.
    const admissionsClient = createAdmissionsClient();
    const appsTable = `${prefix}_enrolment_applications`;
    const { data: appRow, error: appErr } = await admissionsClient
      .from(appsTable)
      .select('levelApplied, classType, preferredSchedule')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (appErr || !appRow) {
      console.error('[sis stage PATCH] application row fetch failed:', appErr?.message);
      return NextResponse.json(
        { error: 'Cannot enroll: application row missing' },
        { status: 422 },
      );
    }
    const appLite = appRow as unknown as {
      levelApplied: string | null;
      classType: string | null;
      preferredSchedule: string | null;
    };
    const pick = await pickSectionForApplicant(supabase, ayCode, appLite);
    if ('error' in pick) {
      return NextResponse.json(
        { error: `Cannot enroll: ${pick.error}` },
        { status: 422 },
      );
    }
    // Merge class-assignment columns into the same update so the Enrolled
    // flip and the class write land atomically (single row UPDATE).
    const classCols = STAGE_COLUMN_MAP.class;
    const todayIso = new Date().toISOString();
    update[classCols.statusCol] = 'Finished';
    update['classLevel'] = pick.classLevel;
    update['classSection'] = pick.classSection;
    update[classCols.updatedDateCol] = todayIso;
    update[classCols.updatedByCol] = auth.user.email ?? '(unknown)';
    classAutoAssigned = true;
  }

  const { error: upErr } = await supabase
    .from(statusTable)
    .update(update)
    .eq('enroleeNumber', enroleeNumber);
  if (upErr) {
    console.error('[sis stage PATCH] update failed:', upErr.message);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
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
    },
  });

  // 4) Invalidate the per-AY cache so detail + list re-render with new data.
  revalidateTag(`sis:${ayCode}`, 'max');

  // 5) Auto-sync the grading roster when class placement is now complete.
  // Fires in two paths:
  //   (a) application → Enrolled — auto-assigned the class above.
  //   (b) class stage manually set to Finished (registrar override or
  //       reassignment) — need to confirm classLevel + classSection are
  //       both populated before syncing.
  // Post-update re-read ensures both class columns are non-null regardless
  // of path. Best-effort — failures log but don't fail the PATCH; the
  // bulk sync at /markbook/sync-students is still available as fallback.
  let autoSync: { change: string; reason?: string; error?: string } | null = null;
  const shouldSync =
    classAutoAssigned ||
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
      !!check.classLevel && !!check.classSection && check.classStatus === 'Finished';

    if (hasClassPlacement) {
      const admissions = createAdmissionsClient();
      const result = await syncOneStudent(supabase, admissions, enroleeNumber, ayCode);
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
        console.warn('[stage PATCH] auto-sync skipped:', result.reason ?? result.error);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    changed: changes.length,
    classAutoAssigned,
    autoSync,
  });
}
