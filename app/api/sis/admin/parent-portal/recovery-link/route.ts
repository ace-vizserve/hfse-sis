import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import {
  checkRecovery,
  generateRecoveryLink,
  RecoveryError,
} from '@/lib/parent-portal/recovery';
import { RecoveryRequestSchema } from '@/lib/schemas/parent-portal';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sis/admin/parent-portal/recovery-link — a superadmin checks a
// record, or makes a link for the family to finish it. One route with an
// `action`, as the portal's `recovery-link` function has.
//
// Both are superadmin only, by role, so ticking a box on /sis/admin/roles cannot
// widen it: `check` shows a family's emails, and `generate` returns a link that
// opens their form with no login. The page loads each student's link status
// itself.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['superadmin']);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = RecoveryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Check the details entered.',
      },
      { status: 400 }
    );
  }

  try {
    const service = createServiceClient();

    if (parsed.data.action === 'check') {
      return NextResponse.json(
        await checkRecovery(service, parsed.data.enroleeNumber)
      );
    }

    const { enroleeNumber, sections, recipientEmails } = parsed.data;
    const result = await generateRecoveryLink(service, {
      enroleeNumber,
      sections,
      recipientEmails,
      createdBy: auth.user.email ?? 'unknown',
    });

    // Never the token or the link: either one opens the family's form.
    await logAction({
      service,
      actor: {
        id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
      },
      action: 'parent_portal.recovery_link_create',
      entityType: 'parent_portal',
      entityId: enroleeNumber,
      context: {
        student_name: result.studentName,
        enrolee_number: enroleeNumber,
        sent_to: result.emailSent ? (recipientEmails ?? []) : [],
        sections: result.sections,
      },
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RecoveryError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : 'Could not make the link.',
      },
      { status: 500 }
    );
  }
}
