import { NextResponse, type NextRequest } from 'next/server';

import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { SubjectReportMapUpdateSchema } from '@/lib/schemas/subject-config';
import { createServiceClient } from '@/lib/supabase/service';

// PUT /api/sis/admin/subjects/[configId]/report-map
//
// Sets which subject's report-card column this subject's grades roll up
// into (`subject_report_map`, migration 080 — global, no AY/level
// dimension; every subject is seeded self-mapped, so "reports as itself"
// is the common/default case). Editable from the per-subject weights
// dialog on /sis/admin/subjects.
//
// The URL segment is named `[configId]` (not `[subjectId]`) purely to
// share the same dynamic-route slug name as this folder's sibling
// route.ts (`app/api/sis/admin/subjects/[configId]/route.ts`, keyed by
// subject_configs.id) — Next.js's App Router hard-requires every dynamic
// segment at the same path depth to use one identical param name, or dev
// mode fails to rebuild its route table (observed: "You cannot use
// different slug names for the same dynamic path" — the whole route
// manifest reload broke, with symptoms surfacing on unrelated routes).
// The VALUE this route actually receives and operates on is still a
// `subjects.id`, never a `subject_configs.id` — aliased back to
// `subjectId` immediately below so the rest of this file reads correctly.
//
// The table's unique key is the (subject_id, report_subject_id) pair, but
// a subject has effectively one active mapping at a time — so this route
// clears any existing row(s) for `subjectId` and inserts the new pairing,
// rather than an upsert (which wouldn't remove a stale mapping pointing at
// a DIFFERENT report_subject_id).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  const auth = await requireCapability('subjects.edit');
  if ('error' in auth) return auth.error;

  const { configId: subjectId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = SubjectReportMapUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid payload', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { report_subject_id } = parsed.data;

  const service = createServiceClient();

  const { data: subjectRow, error: subjErr } = await service
    .from('subjects')
    .select('id, code, name')
    .eq('id', subjectId)
    .maybeSingle();
  if (subjErr)
    return NextResponse.json({ error: subjErr.message }, { status: 500 });
  if (!subjectRow)
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  const subject = subjectRow as { id: string; code: string; name: string };

  const { data: reportSubjectRow, error: reportErr } = await service
    .from('subjects')
    .select('id, code, name')
    .eq('id', report_subject_id)
    .maybeSingle();
  if (reportErr)
    return NextResponse.json({ error: reportErr.message }, { status: 500 });
  if (!reportSubjectRow)
    return NextResponse.json(
      { error: 'report subject not found' },
      { status: 404 }
    );
  const reportSubject = reportSubjectRow as {
    id: string;
    code: string;
    name: string;
  };

  // What it reported as before, so the audit row can say "moved from X to Y"
  // and so a failed insert below can say exactly what was lost.
  const { data: priorRows } = await service
    .from('subject_report_map')
    .select('report_subject_id')
    .eq('subject_id', subjectId);
  const priorIds = ((priorRows ?? []) as { report_subject_id: string }[]).map(
    (r) => r.report_subject_id
  );
  const { data: priorCodes } =
    priorIds.length > 0
      ? await service.from('subjects').select('id, code').in('id', priorIds)
      : { data: [] as { id: string; code: string }[] };
  const codeById = new Map(
    ((priorCodes ?? []) as { id: string; code: string }[]).map((s) => [
      s.id,
      s.code,
    ])
  );
  const previous = priorIds.map((id) => ({
    report_subject_id: id,
    report_subject_code: codeById.get(id) ?? null,
  }));

  const { error: deleteErr } = await service
    .from('subject_report_map')
    .delete()
    .eq('subject_id', subjectId);
  if (deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  // ⚠ TWO STATEMENTS, NOT ONE TRANSACTION. When the insert fails the old
  // mapping is already gone, and the subject is left reporting under nothing.
  // That is logged before the error goes back, so the gap has a record.
  const { error: insertErr } = await service
    .from('subject_report_map')
    .insert({ subject_id: subjectId, report_subject_id });

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'subject_report_map.update',
    entityType: 'subject_report_map',
    entityId: subjectId,
    context: {
      subject_id: subjectId,
      subject_code: subject.code,
      report_subject_id,
      report_subject_code: reportSubject.code,
      previous,
      ...(insertErr
        ? {
            partial: true,
            failed_step: 'insert',
            error: insertErr.message,
            mapping_removed_without_replacement: true,
          }
        : {}),
    },
  });

  if (insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    subject_id: subjectId,
    report_subject_id,
  });
}
