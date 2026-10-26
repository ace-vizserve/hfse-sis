import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentAcademicYear } from '@/lib/academic-year';
import { requireCapability } from '@/lib/auth/require-capability';
import { listStaffUsers } from '@/lib/sis/users/queries';
import {
  loadSubjectHeadsScreen,
  replaceSubjectHeads,
  type SubjectHeadNames,
} from '@/lib/sow/subject-heads';
import { createServiceClient } from '@/lib/supabase/service';

// /api/sis-admin/subject-heads — who heads each subject (migration 198).
//
// GET lists the subjects offered this year with their heads. PUT sets ONE
// subject's heads to exactly the list sent, and re-points the schemes of work
// already waiting on that subject's heads.
//
// ⚠ GATED LIKE THE APPROVERS SCREEN (`approvers.manage`). Naming a subject
// head names who approves a scheme of work — the same power as putting a
// person on an approval step.
//
// ⚠ STAFF ACCOUNTS ONLY. `auth.users` is shared with roughly five hundred
// parent accounts (the role-less rows); `listStaffUsers` is the filter that
// keeps them out, exactly as on the approval-step route.

const PutSchema = z.object({
  subject_id: z.string().uuid('Pick a subject.'),
  heads: z
    .array(
      z.object({
        user_id: z.string().uuid('Pick a person.'),
        applies_to_level_type: z.enum(['primary', 'secondary']).nullish(),
      })
    )
    .max(50),
});

export async function GET() {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const ay = await getCurrentAcademicYear();
  if (!ay) {
    return NextResponse.json(
      { error: 'No current academic year is set.' },
      { status: 409 }
    );
  }
  const rows = await loadSubjectHeadsScreen(createServiceClient(), ay.id);
  return NextResponse.json({ subjects: rows });
}

export async function PUT(request: Request) {
  const auth = await requireCapability('approvers.manage');
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => null);
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Pick a subject and the people who head it.' },
      { status: 400 }
    );
  }
  const { subject_id, heads } = parsed.data;

  const staff = await listStaffUsers();
  const byId = new Map(staff.map((u) => [u.id, u]));
  const names: SubjectHeadNames = new Map();
  for (const head of heads) {
    const person = byId.get(head.user_id);
    if (!person) {
      return NextResponse.json(
        {
          error:
            'That person does not have a staff account, so they cannot head a subject.',
        },
        { status: 400 }
      );
    }
    names.set(person.id, {
      email: person.email,
      displayName: person.display_name,
    });
  }
  // ⚠ A switched-off account is refused only when it is being ADDED. One that
  // is already a head stays sendable, so removing somebody else from the same
  // subject is never blocked by a colleague whose account was turned off.

  const service = createServiceClient();
  const { data: existing } = await service
    .from('subject_heads')
    .select('user_id')
    .eq('subject_id', subject_id);
  const already = new Set(
    ((existing ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
  );
  const switchedOff = heads.find(
    (h) => byId.get(h.user_id)?.disabled && !already.has(h.user_id)
  );
  if (switchedOff) {
    return NextResponse.json(
      {
        error:
          'That account is switched off. Turn it back on before adding them here.',
      },
      { status: 400 }
    );
  }

  try {
    const result = await replaceSubjectHeads(
      service,
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      subject_id,
      heads.map((h) => ({
        userId: h.user_id,
        appliesToLevelType: h.applies_to_level_type ?? null,
      })),
      names
    );
    // The /sis readiness strip counts subject heads (lib/sis/health.ts).
    revalidateTag('sis-health', 'max');
    return NextResponse.json({ ok: true, repointed: result.repointed });
  } catch (e) {
    console.error(
      '[subject-heads] save failed:',
      e instanceof Error ? e.message : String(e)
    );
    // The heads may be saved even so — `replaceSubjectHeads` audits a
    // half-finished save before throwing — so the readiness strip is busted
    // either way.
    revalidateTag('sis-health', 'max');
    return NextResponse.json(
      { error: 'Could not save the subject heads. Please try again.' },
      { status: 500 }
    );
  }
}
