import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { CreateSowSchema } from '@/lib/schemas/sow';
import { createSow } from '@/lib/sow/create';
import { MAX_IMPORT_BYTES, parseSowWorkbook } from '@/lib/sow/excel-import';
import { loadTermWeeks } from '@/lib/sow/weeks';
import { createServiceClient } from '@/lib/supabase/service';

// POST /api/sow/import — start a scheme of work from the school's Excel
// template, once.
//
// Multipart: the `file` and the create input as a JSON `input` field (the same
// shape as POST /api/sow; `start` is ignored here and is always 'import').
//
//   ?preview=1  reads the file and answers with what it found (module, weeks
//               and warnings) without writing anything.
//   otherwise   creates the draft and answers `{ ok, sowId }`.
//
// The role gate is POST /api/sow's, and `createSow` makes the same assignment
// check, so a teacher can only import onto a subject and class they teach.
export async function POST(request: Request) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const bad = (error: string, status = 400) =>
    NextResponse.json({ error }, { status });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('Choose an Excel file to import.');
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return bad('Choose an Excel file to import.');
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return bad('Only Excel (.xlsx) files can be imported.');
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return bad('That file is bigger than 5 MB. Choose a smaller Excel file.');
  }

  let rawInput: unknown = null;
  try {
    rawInput = JSON.parse(String(form.get('input') ?? ''));
  } catch {
    rawInput = null;
  }
  const parsedInput = CreateSowSchema.safeParse(
    rawInput && typeof rawInput === 'object'
      ? { ...rawInput, start: 'import' }
      : null
  );
  if (!parsedInput.success) {
    return bad(
      parsedInput.error.issues[0]?.message ?? 'Pick the classes to import for.'
    );
  }
  const input = parsedInput.data;

  try {
    const service = createServiceClient();

    // The tab to read is the level's; the term's week count lets the parser
    // say how the file's weeks line up with this term.
    const { data: level, error: levelErr } = await service
      .from('levels')
      .select('label')
      .eq('id', input.key.levelId)
      .maybeSingle();
    if (levelErr) throw new Error(levelErr.message);
    if (!level) return bad('That level could not be found.');
    const { weeks: termWeeks } = await loadTermWeeks(
      service,
      input.key.termId,
      input.key.levelId
    );
    const termWeekCount = termWeeks.filter((w) => w.kind === 'week').length;

    const parsed = parseSowWorkbook(
      await file.arrayBuffer(),
      (level as { label: string }).label,
      { termWeekCount }
    );
    if (!parsed.ok) return bad(parsed.error);

    if (new URL(request.url).searchParams.get('preview') === '1') {
      return NextResponse.json({ ok: true, preview: parsed.sow });
    }

    const result = await createSow(
      service,
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      input,
      { sow: parsed.sow, fileSize: file.size, fileName: file.name }
    );
    if (!result.ok) return bad(result.error, result.status);
    return NextResponse.json({ ok: true, sowId: result.sowId });
  } catch (e) {
    console.error(
      '[sow.import] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return bad('Could not import the scheme of work. Please try again.', 500);
  }
}
