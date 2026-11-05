import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateTag } from 'next/cache';

import { logAction, type AuditActor } from '@/lib/audit/log-action';
import { resolveCategory } from '@/lib/p-files/document-config';
import {
  ENROLLED_PREREQ_STAGES,
  evaluateEnrolledFlip,
  STAGE_COLUMN_MAP,
  STAGE_LABELS,
} from '@/lib/schemas/sis';
import { chosenClassProblem } from '@/lib/sis/class-assignment';
import { stampEnrolledAtIfNull } from '@/lib/sis/enrolled-at';
import {
  completePlacement,
  type MidTermPayload,
} from '@/lib/sis/placement-completion';
import { createAdmissionsClient } from '@/lib/supabase/admissions';
import { NOT_ENROLLED_REASON, syncOneStudent } from '@/lib/sync/students';

// Fees marked Paid enrols the student (KD #237, Miss Luz and Miss Hazel,
// 2026-11-04: "pag na marked as paid ko na sana mag automatic tag as enrolled
// na po"). Runs after the Fees save, whichever way Paid arrived: staff on the
// Fees card, or QuickBooks through the sync.
//
// It does what the stage route's Enrolled flip does (steps 2b to 6): open steps
// never block and are recorded, a class set beforehand is checked, the
// enrolled date is stamped, and a placed child reaches the roster. No screen
// asks "Enrol anyway" here, because marking Paid is the instruction.
//
// A failure here never undoes or fails the Fees save: the money is recorded,
// and staff are told to enrol by hand.

/** Still in the pipeline. Enrolled, Conditional, Cancelled, Withdrawn stay. */
const PIPELINE_STATUSES: readonly string[] = [
  'Submitted',
  'Ongoing Verification',
  'Processing',
];

export function canEnrolOnFeesPaid(
  applicationStatus: string | null | undefined
): boolean {
  return PIPELINE_STATUSES.includes((applicationStatus ?? '').trim());
}

export type FeesPaidEnrolment =
  | { enrolled: false; error: string }
  | {
      enrolled: true;
      openSteps: string[];
      awaitingPlacement: boolean;
      chosenClassUnavailable: { chosenClass: string; reason: string } | null;
      autoSyncFailed: boolean;
      midTermEnrolment: MidTermPayload | null;
    };

/** Null when the application isn't one this applies to: nothing was done. */
export async function enrolOnFeesPaid(
  service: SupabaseClient,
  args: {
    ayCode: string;
    enroleeNumber: string;
    actor: AuditActor;
    updatedBy: string;
  }
): Promise<FeesPaidEnrolment | null> {
  const { ayCode, enroleeNumber, actor, updatedBy } = args;
  try {
    const prefix = `ay${ayCode.replace(/^AY/i, '').toLowerCase()}`;
    const table = `${prefix}_enrolment_status`;
    const app = STAGE_COLUMN_MAP.application;
    const klass = STAGE_COLUMN_MAP.class;

    const { data: rowData, error: rowErr } = await service
      .from(table)
      .select(
        [
          app.statusCol,
          ...ENROLLED_PREREQ_STAGES.map((k) => STAGE_COLUMN_MAP[k].statusCol),
          'enroleeType',
          'classLevel',
          'classSection',
          klass.statusCol,
        ].join(', ')
      )
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    const row = rowData as unknown as Record<string, string | null> | null;
    const preStatus = row?.[app.statusCol] ?? null;
    if (!row || !canEnrolOnFeesPaid(preStatus)) return null;

    const admissions = createAdmissionsClient();
    const { data: appData, error: appErr } = await admissions
      .from(`${prefix}_enrolment_applications`)
      .select('studentNumber, category')
      .eq('enroleeNumber', enroleeNumber)
      .maybeSingle();
    if (appErr) throw new Error(appErr.message);
    if (!appData) throw new Error('The application row is missing.');
    const appRow = appData as {
      studentNumber: string | null;
      category: string | null;
    };

    const gate = evaluateEnrolledFlip({
      category: resolveCategory({
        category: appRow.category,
        enroleeType: row.enroleeType,
      }),
      canAssignSection: false,
      sectionId: null,
      prereqStatuses: {
        ...Object.fromEntries(
          ENROLLED_PREREQ_STAGES.map((k) => [
            k,
            row[STAGE_COLUMN_MAP[k].statusCol] ?? null,
          ])
        ),
        fees: 'Paid',
      },
      studentNumber: appRow.studentNumber,
      acknowledgeOpenSteps: true,
    });
    if (!gate.ok) throw new Error(gate.error);
    const openSteps = (gate.openSteps ?? []).map((b) => b.stage);

    const preLevel = row.classLevel ?? null;
    const preSection = row.classSection ?? null;
    const chosenClassUnavailable = preSection?.trim()
      ? await chosenClassProblem(service, ayCode, preLevel, preSection, {
          enroleeNumber,
          studentNumber: appRow.studentNumber,
        })
      : null;

    const update: Record<string, unknown> = {
      [app.statusCol]: 'Enrolled',
      [app.updatedDateCol]: new Date().toISOString(),
      [app.updatedByCol]: updatedBy,
    };
    if (chosenClassUnavailable) {
      update.classSection = null;
      update.classLevel = null;
      update[klass.statusCol] = null;
    }
    // Only while it still reads what was read above, so a Cancelled saved
    // meanwhile is never overwritten.
    const { data: written, error: upErr } = await service
      .from(table)
      .update(update)
      .eq('enroleeNumber', enroleeNumber)
      .eq(app.statusCol, preStatus as string)
      .select('enroleeNumber');
    if (upErr) throw new Error(upErr.message);
    if (!written || written.length === 0) return null;

    await stampEnrolledAtIfNull(service, table, enroleeNumber);

    const changes = [
      { field: app.statusCol, from: preStatus, to: 'Enrolled' },
      ...(chosenClassUnavailable
        ? [
            { field: 'classSection', from: preSection, to: null },
            { field: 'classLevel', from: preLevel, to: null },
            {
              field: klass.statusCol,
              from: row[klass.statusCol] ?? null,
              to: null,
            },
          ]
        : []),
    ];
    await logAction({
      service,
      actor,
      action: 'sis.stage.update',
      entityType: 'enrolment_status',
      entityId: enroleeNumber,
      context: {
        ay_code: ayCode,
        stage: 'application',
        stage_label: STAGE_LABELS.application,
        changes,
        trigger: 'fees_paid',
        ...(openSteps.length > 0 && { open_steps_at_enrolment: openSteps }),
        ...(chosenClassUnavailable && {
          chosen_class_unavailable: {
            class: chosenClassUnavailable.chosenClass,
            reason: chosenClassUnavailable.reason,
          },
        }),
      },
    });

    let autoSyncFailed = false;
    let midTermEnrolment: MidTermPayload | null = null;
    const placed =
      !chosenClassUnavailable &&
      !!preLevel &&
      !!preSection &&
      row[klass.statusCol] === 'Finished';
    if (placed) {
      const result = await syncOneStudent(
        service,
        admissions,
        enroleeNumber,
        ayCode,
        undefined,
        actor
      );
      if (
        result.ok &&
        (result.change === 'enrolled' ||
          result.change === 'inserted' ||
          result.change === 'reactivated')
      ) {
        await logAction({
          service,
          actor,
          action: 'student.sync',
          entityType: 'sync_batch',
          entityId: enroleeNumber,
          context: {
            ay_code: ayCode,
            trigger: 'stage.fees.paid',
            enroleeNumber,
            change: result.change,
          },
        });
        const placement = await completePlacement(service, {
          enroleeNumber,
          ayCode,
        });
        midTermEnrolment = placement.midTermEnrolment;
        if (placement.enrollmentDateStamped) {
          await logAction({
            service,
            actor,
            action: 'student.sync.detail',
            entityType: 'sync_batch',
            entityId: enroleeNumber,
            context: {
              ay_code: ayCode,
              enroleeNumber,
              section_student_id: placement.sectionStudentId,
              index_number: placement.indexNumber,
              enrollment_date_before: placement.enrollmentDateBefore,
              enrollment_date_after: placement.enrollmentDateAfter,
            },
          });
        }
      } else if (
        !result.ok &&
        result.reason !== 'missing classLevel or classSection' &&
        result.reason !== 'no studentNumber' &&
        result.reason !== NOT_ENROLLED_REASON
      ) {
        autoSyncFailed = true;
        console.warn(
          '[fees paid] roster sync failed:',
          result.reason ?? result.error
        );
      }
    }

    // Expire now: the page refresh is the very next request (as stage-write).
    for (const tag of [
      `sis:${ayCode}`,
      `admissions-drill:${ayCode}`,
      `admissions-dashboard:${ayCode}`,
      `records-drill:${ayCode}`,
    ]) {
      revalidateTag(tag, { expire: 0 });
    }

    return {
      enrolled: true,
      openSteps,
      awaitingPlacement: !placed,
      chosenClassUnavailable,
      autoSyncFailed,
      midTermEnrolment,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[fees paid] could not enrol:', enroleeNumber, error);
    return { enrolled: false, error };
  }
}
