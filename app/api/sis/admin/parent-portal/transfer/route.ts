import { NextResponse, type NextRequest } from 'next/server';

import { listAyCodes } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { logDataAccess } from '@/lib/audit/log-data-access';
import { requireRole } from '@/lib/auth/require-role';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { listApplicationRows } from '@/lib/parent-portal/recovery';
import {
  transferOne,
  type TransferResponse,
  type TransferRowResult,
} from '@/lib/parent-portal/transfer';
import { TransferRequestSchema } from '@/lib/schemas/parent-portal';
import { createServiceClient } from '@/lib/supabase/service';

// /api/sis/admin/parent-portal/transfer
//
// GET ?ay=  — the Applications table for a year, for the three roles that open
//             the page. Only a superadmin's rows carry a recovery link.
// POST      — a superadmin moves applications to another year. By role, so
//             ticking a box on /sis/admin/roles cannot widen it.

// One student takes about 14 requests in a row.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const ayCode = request.nextUrl.searchParams.get('ay');
  const service = createServiceClient();
  // Goes into a table name, so it has to be a real year.
  if (!ayCode || !(await listAyCodes(service)).includes(ayCode)) {
    return NextResponse.json(
      { error: 'Choose a year that exists.' },
      { status: 400 }
    );
  }

  try {
    if (auth.role === 'superadmin')
      await logDataAccess(auth, 'data.view', 'Working recovery links', {
        ay_code: ayCode,
      });
    return NextResponse.json({
      // ⚠ A link opens a family's form with no login. Viewers' rows are fetched
      // without it.
      applications: await listApplicationRows(service, ayCode, {
        includeLink: auth.role === 'superadmin',
      }),
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : 'Could not load the applications.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = TransferRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Check the details entered.',
      },
      { status: 400 }
    );
  }
  const { sourceAy, targetAy, enroleeNumbers } = parsed.data;

  if (sourceAy === targetAy) {
    return NextResponse.json(
      { error: 'Choose two different years.' },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  // Each goes into a table name, so each has to be a real year.
  const ayCodes = await listAyCodes(service);
  if (!ayCodes.includes(sourceAy) || !ayCodes.includes(targetAy)) {
    return NextResponse.json(
      { error: 'Choose years that exist.' },
      { status: 400 }
    );
  }

  // One at a time: at the same time they would all take the same next number.
  const results: TransferRowResult[] = [];
  for (const enroleeNumber of enroleeNumbers) {
    const result = await transferOne(service, {
      sourceAy,
      targetAy,
      enroleeNumber,
    });
    results.push({ enroleeNumber, ...result });

    if (result.ok) {
      await logAction({
        service,
        actor: {
          id: auth.user.id,
          email: auth.user.email ?? null,
          role: auth.role,
        },
        action: 'parent_portal.application_transfer',
        entityType: 'parent_portal',
        // The number the application has now. The old one is in the context.
        entityId: result.newEnroleeNumber,
        context: {
          student_name: result.studentName,
          source_ay: sourceAy,
          target_ay: targetAy,
          old_enrolee_number: enroleeNumber,
          new_enrolee_number: result.newEnroleeNumber,
          old_student_number: result.oldStudentNumber,
          new_student_number: result.newStudentNumber,
        },
      });
    } else if (result.needsChecking) {
      await logAction({
        service,
        actor: {
          id: auth.user.id,
          email: auth.user.email ?? null,
          role: auth.role,
        },
        action: 'parent_portal.application_transfer_failed',
        entityType: 'parent_portal',
        entityId: enroleeNumber,
        context: {
          source_ay: sourceAy,
          target_ay: targetAy,
          old_enrolee_number: enroleeNumber,
          error: result.error,
        },
      });
    }
  }

  const moved = results.filter((result) => result.ok).length;
  if (moved > 0) {
    for (const ayCode of [sourceAy, targetAy]) {
      invalidateDrillTags('admissions', ayCode);
      invalidateDrillTags('records', ayCode);
      invalidateDrillTags('p-files', ayCode);
    }
  }

  const response: TransferResponse = {
    results,
    moved,
    failed: results.length - moved,
  };
  return NextResponse.json(response);
}
