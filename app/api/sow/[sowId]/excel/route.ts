import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildSowWorkbook } from '@/lib/sow/excel-export';
import { loadSowView } from '@/lib/sow/read';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/sow/[sowId]/excel — the scheme of work as an Excel file in the
// school's Module Syllabus layout.
//
// Anyone who can read the scheme can download it: `loadSowView` makes that
// decision (null covers both "no such scheme" and "not yours"), so the answer
// is a 404 either way. The file is the working copy as the page shows it. A
// download is a read, and reads are not audited in the SIS.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sowId: string }> }
) {
  const auth = await requireRole([
    'teacher',
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;
  const { sowId } = await params;

  try {
    const view = await loadSowView(
      createServiceClient(),
      { id: auth.user.id, email: auth.user.email, role: auth.role },
      sowId
    );
    if (!view) {
      return NextResponse.json(
        { error: 'That scheme of work could not be found.' },
        { status: 404 }
      );
    }

    const d = view.display;
    const bytes = buildSowWorkbook({
      module: view.module,
      levelLabel: d.levelLabel,
      ayCode: d.ayCode,
      termNumber: d.termNumber,
      termStart: d.termStart,
      termEnd: d.termEnd,
      weeks: view.weeks,
    });

    const filename = `${d.ayCode} Term ${d.termNumber} ${d.levelLabel} ${d.subjectName} SOW.xlsx`;
    // Header values must be ASCII; the exact name travels in `filename*`.
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return new NextResponse(bytes, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error(
      '[sow.excel] failed:',
      e instanceof Error ? e.message : String(e)
    );
    return NextResponse.json(
      { error: 'Could not build the Excel file. Please try again.' },
      { status: 500 }
    );
  }
}
