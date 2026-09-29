import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentAyCode } from '@/lib/academic-year';
import { logAction } from '@/lib/audit/log-action';
import { requireCapability } from '@/lib/auth/require-capability';
import { invalidateDrillTags } from '@/lib/cache/invalidate-drill-tags';
import { SubjectCatalogUpdateSchema } from '@/lib/schemas/subject';
import {
  findSectionUse,
  loadSubjectSetup,
  sectionUseMessage,
  type SubjectSetup,
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
// It also renames. The NAME of any subject, in use or not (2026-09-29 — a
// subject has one name, edited in its drawer; every change is a
// `subject.rename` audit row with before/after). The CODE never — it is
// generated at creation like a student number, and a body carrying `code` is
// refused with a 400. Nothing writes subject_configs.display_name any more (KD #203 update).
// DELETE below is looser (2026-09-29):
// it only refuses a subject a CLASS uses, and takes the rest of the setup
// with it.
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
  // A code is generated at creation and never changes (2026-09-29) — refuse
  // it loudly rather than let the schema strip it and report success.
  if (body && typeof body === 'object' && 'code' in body) {
    return NextResponse.json(
      { error: "A subject's code can't be changed." },
      { status: 400 }
    );
  }
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

  // The NAME changes for any subject, in use or not — it is audited below
  // (2026-09-29, Mr Ace: "you dont have to be hard on rules bro, as long as
  // all is audit logged"). The CODE never changes (refused above).
  const renaming =
    parsed.data.name !== undefined && parsed.data.name !== subject.name;

  const patch: Record<string, unknown> = {};
  if (parsed.data.is_examinable !== undefined)
    patch.is_examinable = parsed.data.is_examinable;
  if (parsed.data.grading_method !== undefined)
    patch.grading_method = parsed.data.grading_method;
  if (renaming) patch.name = parsed.data.name;
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
        after: { code: subject.code, name: parsed.data.name ?? subject.name },
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
    code: subject.code,
    name: renaming ? (parsed.data.name ?? subject.name) : subject.name,
    is_examinable: parsed.data.is_examinable ?? subject.is_examinable,
    grading_method: parsed.data.grading_method ?? subject.grading_method,
  });
}

// DELETE /api/sis/admin/subjects/catalog/[id]
//
// Removes a subject NO CLASS uses (2026-09-29, Mr Ace: "in use means a
// section is using it"). Refused (409) when a class holds anything on it —
// grading sheets, teacher assignments, evaluation comments, checklist topics
// or a section_subjects row (lib/sis/subjects/usage.ts::findSectionUse) —
// because those are per-class / per-student records (Hard Rule #6).
//
// Otherwise its SETUP goes with it: weights (subject_configs, every year),
// level offerings, and its subject_report_map rows. A subject reporting under
// it is re-pointed to report as itself, never deleted.
//
// No transactions in supabase-js, so the order is what keeps a failure safe:
//   1. snapshot every row about to go into ONE `subject.delete` audit row;
//   2. re-point other subjects reporting under it (each keeps a mapping);
//   3. delete subject_level_offerings;
//   4. delete subject_configs (ON DELETE RESTRICT — must go before 6);
//   5. delete its own subject_report_map rows;
//   6. delete the subject itself — LAST, so any failure above leaves it
//      in the catalog and the request can simply be retried.
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
  let setup: SubjectSetup;
  try {
    usage = await findSectionUse(service, subjectId);
    if (usage.length > 0) {
      return NextResponse.json(
        { error: sectionUseMessage(usage), usage },
        { status: 409 }
      );
    }
    setup = await loadSubjectSetup(service, subjectId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // 1. Snapshot first — the one audit row that says what went.
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
      removed: {
        subject_configs: setup.configs.map((c) => ({
          ...c,
          ay_code: setup.ayCodes[c.academic_year_id] ?? null,
        })),
        subject_level_offerings: setup.offerings,
        subject_report_map: setup.ownMaps,
      },
      repointed_to_self: setup.reportedUnder,
    },
  });

  const fail = (step: string, message: string) =>
    NextResponse.json(
      {
        error: `Couldn't finish deleting ${subject.name} (${step}): ${message}. The subject is still in the catalog — try again.`,
      },
      { status: 500 }
    );

  // 2. Re-point each subject reporting under this one to report as itself.
  //    If it already has its self-map, the row pointing here just goes.
  for (const other of setup.reportedUnder) {
    const { count, error: selfErr } = await service
      .from('subject_report_map')
      .select('subject_id', { count: 'exact', head: true })
      .eq('subject_id', other.subject_id)
      .eq('report_subject_id', other.subject_id);
    if (selfErr) return fail('report card mapping', selfErr.message);
    const target = service.from('subject_report_map');
    const { error } =
      (count ?? 0) > 0
        ? await target
            .delete()
            .eq('subject_id', other.subject_id)
            .eq('report_subject_id', subjectId)
        : await target
            .update({ report_subject_id: other.subject_id })
            .eq('subject_id', other.subject_id)
            .eq('report_subject_id', subjectId);
    if (error) return fail('report card mapping', error.message);
  }

  // 3–5. The setup rows, then 6. the subject.
  const steps: Array<[string, string, string]> = [
    ['levels', 'subject_level_offerings', 'subject_id'],
    ['weights', 'subject_configs', 'subject_id'],
    ['report card mapping', 'subject_report_map', 'subject_id'],
    ['subject', 'subjects', 'id'],
  ];
  for (const [step, table, column] of steps) {
    const { error } = await service.from(table).delete().eq(column, subjectId);
    if (error) return fail(step, error.message);
  }

  invalidateDrillTags('markbook', await requireCurrentAyCode(service));

  return NextResponse.json({ ok: true, id: subjectId });
}
