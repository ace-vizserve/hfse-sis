import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireRole } from '@/lib/auth/require-role';
import { SubjectCatalogUpdateSchema } from '@/lib/schemas/subject';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/admin/subjects/catalog/[id]
//
// Task 2 of the "Unified Subject Setup page" plan. Updates the two
// `subjects`-table fields (`is_examinable` = grade type, `grading_method`)
// that no existing route can reach — POST /catalog only creates; the
// subject_configs routes (POST/PATCH .../subjects[/[configId]]) only touch
// subject_configs, a different table. This is the Tune step's
// SubjectConfigForm grade-type/grading-method fields' write path.
//
// The dynamic segment is named `[id]` (not `[subjectId]`) purely to match
// this folder's existing sibling `app/api/sis/admin/subjects/catalog/[id]/
// configs/route.ts` — Next.js's App Router hard-requires every dynamic
// segment at the same path depth to use one identical param name (the same
// footgun documented in `app/api/sis/admin/subjects/[configId]/report-map/
// route.ts`'s header comment; observed there as a dev-mode route-table
// rebuild failure). Aliased to `subjectId` immediately below for clarity —
// the value really is a `subjects.id`.
//
// `subjects` has no AY dimension (migration 080's collapse), so a change
// here is GLOBAL — it applies to this subject in every AY, not just the
// one currently selected on the page. Same auth gate as the sibling POST
// /catalog route (school_admin + superadmin only — the page itself already
// redirects any other role before this route is ever reachable).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const { id: subjectId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SubjectCatalogUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const service = createServiceClient();

  const { data: before, error: loadErr } = await service
    .from('subjects')
    .select('id, code, name, is_examinable, grading_method, report_label')
    .eq('id', subjectId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  const subject = before as {
    id: string;
    code: string;
    name: string;
    is_examinable: boolean;
    grading_method: string;
    report_label: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (parsed.data.is_examinable !== undefined)
    patch.is_examinable = parsed.data.is_examinable;
  if (parsed.data.grading_method !== undefined)
    patch.grading_method = parsed.data.grading_method;
  // Empty string clears back to null (falls back to `name` on the report
  // card) — normalized here, not in the schema (see the schema's own
  // comment for why a transform there would be unsafe for a partial-merge
  // payload). `resolvedReportLabel` is the value after this PATCH either
  // way — computed once so `?? subject.report_label` below (which would
  // be WRONG for an explicit clear-to-null) is never used.
  const reportLabelProvided = parsed.data.report_label !== undefined;
  const resolvedReportLabel = reportLabelProvided
    ? parsed.data.report_label === ''
      ? null
      : (parsed.data.report_label as string | null)
    : subject.report_label;
  if (reportLabelProvided) patch.report_label = resolvedReportLabel;

  const { error: updateErr } = await service
    .from('subjects')
    .update(patch)
    .eq('id', subjectId);
  if (updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await logAction({
    service,
    actor: { id: auth.user.id, email: auth.user.email ?? null },
    action: 'subject.catalog.update',
    entityType: 'subject',
    entityId: subjectId,
    context: {
      subject_id: subjectId,
      subject_code: subject.code,
      before: {
        is_examinable: subject.is_examinable,
        grading_method: subject.grading_method,
        report_label: subject.report_label,
      },
      after: {
        is_examinable: parsed.data.is_examinable ?? subject.is_examinable,
        grading_method: parsed.data.grading_method ?? subject.grading_method,
        report_label: resolvedReportLabel,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    id: subjectId,
    is_examinable: parsed.data.is_examinable ?? subject.is_examinable,
    grading_method: parsed.data.grading_method ?? subject.grading_method,
    report_label: resolvedReportLabel,
  });
}
