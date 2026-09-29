import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { SubjectCatalogUpdateSchema } from '@/lib/schemas/subject';
import {
  findSubjectUsage,
  subjectInUseMessage,
} from '@/lib/sis/subjects/usage';
import { createServiceClient } from '@/lib/supabase/service';

// PATCH /api/sis/admin/subjects/catalog/[id]
//
// Task 2 of the "Unified Subject Setup page" plan. Updates the
// `subjects`-table fields (`is_examinable` = grade type, `grading_method`)
// that no existing route can reach — POST /catalog only creates; the
// subject_configs routes (POST/PATCH .../subjects[/[configId]]) only touch
// subject_configs, a different table. This is the Tune step's
// SubjectConfigForm grade-type/grading-method fields' write path.
//
// It also renames — `code` and/or `name` — but ONLY an unused subject
// (lib/sis/subjects/usage.ts). A subject in use keeps its code (every
// code-keyed list matches on it) and is renamed per year through
// subject_configs.display_name instead. DELETE below has the same rule.
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

type SubjectRecord = {
  id: string;
  code: string;
  name: string;
  is_examinable: boolean;
  grading_method: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('subjects.edit');
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
    .select('id, code, name, is_examinable, grading_method')
    .eq('id', subjectId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!before)
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  const subject = before as SubjectRecord;

  const renaming =
    (parsed.data.code !== undefined && parsed.data.code !== subject.code) ||
    (parsed.data.name !== undefined && parsed.data.name !== subject.name);

  if (renaming) {
    let usage: string[];
    try {
      usage = await findSubjectUsage(service, subjectId);
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 500 }
      );
    }
    if (usage.length > 0) {
      return NextResponse.json(
        { error: subjectInUseMessage(usage, 'renamed'), usage },
        { status: 409 }
      );
    }
    if (parsed.data.code !== undefined && parsed.data.code !== subject.code) {
      const { data: clash } = await service
        .from('subjects')
        .select('id')
        .eq('code', parsed.data.code)
        .maybeSingle();
      if (clash) {
        return NextResponse.json(
          {
            error: `Another subject already uses the code ${parsed.data.code}. Pick a different code.`,
          },
          { status: 409 }
        );
      }
    }
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.is_examinable !== undefined)
    patch.is_examinable = parsed.data.is_examinable;
  if (parsed.data.grading_method !== undefined)
    patch.grading_method = parsed.data.grading_method;
  if (renaming) {
    if (parsed.data.code !== undefined) patch.code = parsed.data.code;
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  }
  // The report label used to be normalised here too. It moved to
  // `subject_configs` in migration 138 (per academic year).

  if (Object.keys(patch).length > 0) {
    const { error: updateErr } = await service
      .from('subjects')
      .update(patch)
      .eq('id', subjectId);
    if (updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const actor = {
    id: auth.user.id,
    email: auth.user.email ?? null,
    role: auth.role,
  };

  if (
    parsed.data.is_examinable !== undefined ||
    parsed.data.grading_method !== undefined
  ) {
    await logAction({
      service,
      actor,
      action: 'subject.catalog.update',
      entityType: 'subject',
      entityId: subjectId,
      context: {
        subject_id: subjectId,
        subject_code: subject.code,
        before: {
          is_examinable: subject.is_examinable,
          grading_method: subject.grading_method,
        },
        after: {
          is_examinable: parsed.data.is_examinable ?? subject.is_examinable,
          grading_method: parsed.data.grading_method ?? subject.grading_method,
        },
      },
    });
  }

  if (renaming) {
    await logAction({
      service,
      actor,
      action: 'subject.rename',
      entityType: 'subject',
      entityId: subjectId,
      context: {
        subject_id: subjectId,
        before: { code: subject.code, name: subject.name },
        after: {
          code: parsed.data.code ?? subject.code,
          name: parsed.data.name ?? subject.name,
        },
      },
    });
  }

  // Changing whether a subject is examinable, or how it is graded, changes
  // what the markbook dashboards and drills SHOW — and both read the catalogue
  // through `unstable_cache` (`markbook:${ay}` / `markbook-drill:${ay}`). Same
  // call the two sibling routes in this folder already make.
  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({
    ok: true,
    id: subjectId,
    code: renaming ? (parsed.data.code ?? subject.code) : subject.code,
    name: renaming ? (parsed.data.name ?? subject.name) : subject.name,
    is_examinable: parsed.data.is_examinable ?? subject.is_examinable,
    grading_method: parsed.data.grading_method ?? subject.grading_method,
  });
}

// DELETE /api/sis/admin/subjects/catalog/[id]
//
// Removes an UNUSED subject from the catalog — one added by mistake, or with
// the wrong code. Refused (409) the moment anything points at it, because
// several of those references cascade and would be deleted with it. Its
// self-mapped `subject_report_map` row is removed first (every subject is
// seeded with one; the FK would cascade it anyway).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCapability('subjects.edit');
  if ('error' in auth) return auth.error;

  const { id: subjectId } = await params;
  const service = createServiceClient();

  const { data: row, error: loadErr } = await service
    .from('subjects')
    .select('id, code, name, is_examinable, grading_method')
    .eq('id', subjectId)
    .maybeSingle();
  if (loadErr)
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!row)
    return NextResponse.json({ error: 'subject not found' }, { status: 404 });
  const subject = row as SubjectRecord;

  let usage: string[];
  try {
    usage = await findSubjectUsage(service, subjectId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (usage.length > 0) {
    return NextResponse.json(
      { error: subjectInUseMessage(usage, 'deleted'), usage },
      { status: 409 }
    );
  }

  const { error: mapErr } = await service
    .from('subject_report_map')
    .delete()
    .eq('subject_id', subjectId);
  if (mapErr)
    return NextResponse.json({ error: mapErr.message }, { status: 500 });

  const { error: deleteErr } = await service
    .from('subjects')
    .delete()
    .eq('id', subjectId);
  if (deleteErr)
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  await logAction({
    service,
    actor: {
      id: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
    },
    action: 'subject.delete',
    entityType: 'subject',
    entityId: subjectId,
    context: {
      subject_id: subjectId,
      code: subject.code,
      name: subject.name,
      is_examinable: subject.is_examinable,
      grading_method: subject.grading_method,
    },
  });

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({ ok: true, id: subjectId });
}
