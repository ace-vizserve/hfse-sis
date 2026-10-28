import { type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { getAcademicOverview } from '@/lib/markbook/academic-overview';
import {
  buildOverviewWorkbook,
  overviewToCsv,
} from '@/lib/markbook/academic-overview-export';
import {
  buildMasterfileWorkbook,
  consolidatedTerms,
  divisionName,
  masterfileToCsv,
  type ConsolidatedFilters,
} from '@/lib/markbook/masterfile-export';
import { loadMasterfile } from '@/lib/markbook/masterfile';
import {
  buildReportBookWorkbook,
  reportBookToCsv,
} from '@/lib/markbook/report-book-export';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/markbook/masterfile/export
//
// The school's two files (KD #95): the CONSOLIDATED FORM (one term, one tab
// per class, P1–S4 in one file) or the Final Report Book Masterfile sheet
// (?template=report-book, one file per division), built from the same
// computed payload the on-screen masterfile shows (`loadMasterfile`). The
// page's filters narrow them — see masterfile-export.ts / report-book-export.ts.
//
// Query params:
//   ?level=<level_id>    one level
//   ?class=<section_id>  optional, repeatable; one level's classes. Also
//                          accepts a single comma-joined value for back-compat.
//   ?division=primary|secondary  every level of that division (P1–P6 / S1–S4)
//   (none of the three)  every class P1–S4 (Consolidated Form only)
//   ?subject=<subject_id> optional, only that subject's columns
//   ?term=1..4           optional; the Consolidated Form's term (default the
//                          latest graded), the Report Book's last term filled
//   ?status=active|late_enrollee|withdrawn  optional
//   ?template=report-book | summary  default the Consolidated Form; summary =
//                          the school-wide summary tables
//   ?format=csv          the same rows as CSV (default xlsx)
//   ?ay=<ay_code>        optional (defaults to current AY)

export async function GET(req: NextRequest) {
  // Page is registrar | school_admin | superadmin — mirror it here.
  const auth = await requireRole([
    'academic_coordinator',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const { searchParams } = new URL(req.url);
  const asCsv = searchParams.get('format')?.toLowerCase() === 'csv';

  const levelParam = searchParams.get('level');
  const division = searchParams.get('division')?.toLowerCase();
  const sectionIds = searchParams
    .getAll('class')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const term = searchParams.get('term');
  const status = searchParams.get('status');
  const filters: ConsolidatedFilters = {
    subjectId: searchParams.get('subject') || null,
    termNumber: term && /^[1-4]$/.test(term) ? Number(term) : null,
    status:
      status === 'active' ||
      status === 'late_enrollee' ||
      status === 'withdrawn'
        ? status
        : null,
  };

  // Resolve AY — honor ?ay= when it's a real AY, else current (mirrors page).
  let ayCode = await requireCurrentAyCode(service);
  const ayParam = searchParams.get('ay');
  if (ayParam && /^AY\d{4}$/.test(ayParam)) {
    const { data: requested } = await service
      .from('academic_years')
      .select('ay_code')
      .eq('ay_code', ayParam)
      .maybeSingle();
    if (requested) ayCode = (requested as { ay_code: string }).ay_code;
  }
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) {
    return new Response('Could not resolve academic year.', { status: 404 });
  }
  const academicYearId = (ayRow as { id: string }).id;

  // Which levels: a division's (by level CODE — production files Youngstarters
  // as level_type 'primary', and the school's Primary file has no YS), or one.
  const [{ data: levelsRaw }, { data: sectionLevels }] = await Promise.all([
    service.from('levels').select('id, code, sort_order').order('sort_order'),
    service
      .from('sections')
      .select('level_id')
      .eq('academic_year_id', academicYearId),
  ]);
  const withSections = new Set(
    ((sectionLevels ?? []) as { level_id: string }[]).map((s) => s.level_id)
  );
  const levels = ((levelsRaw ?? []) as { id: string; code: string }[]).filter(
    (l) => withSections.has(l.id)
  );

  const template = searchParams.get('template');
  const reportBook = template === 'report-book';

  let levelIds: string[];
  if (levelParam && levelParam !== '__all__') {
    if (!levels.some((l) => l.id === levelParam)) {
      return new Response(
        'The requested level has no sections in this academic year.',
        { status: 400 }
      );
    }
    levelIds = [levelParam];
  } else if (division === 'primary' || division === 'secondary') {
    const pattern = division === 'primary' ? /^P\d$/i : /^S\d$/i;
    levelIds = levels.filter((l) => pattern.test(l.code)).map((l) => l.id);
  } else if (template !== 'summary') {
    // Unfiltered: every class P1–S4, as the school's CONSOLIDATED FORM holds
    // them. (The Report Book is two files, so its menu always names one.)
    if (reportBook) {
      return new Response('Pick Primary or Secondary for the Report Book.', {
        status: 400,
      });
    }
    levelIds = levels.filter((l) => /^[PS]\d$/i.test(l.code)).map((l) => l.id);
  } else {
    // ?template=summary → the school-wide summary tables.
    const overview = await getAcademicOverview(ayCode, academicYearId);
    if (asCsv) {
      return new Response(overviewToCsv(overview), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="academic-overview-${ayCode}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    const wb = buildOverviewWorkbook(overview);
    return new Response(new Uint8Array(wb), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Academic_Overview_${ayCode}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const payloads = (
    await Promise.all(
      levelIds.map((levelId) =>
        loadMasterfile({
          ayCode,
          levelId,
          // A class filter belongs to one level.
          sectionIds:
            levelIds.length === 1 && sectionIds.length > 0
              ? sectionIds
              : undefined,
        })
      )
    )
  ).filter((p): p is NonNullable<typeof p> => p != null && p.rows.length > 0);
  if (payloads.length === 0) {
    return new Response('No students to export.', { status: 404 });
  }

  // The school's own file names — "Term 2 CONSOLIDATED FORM", "AY2025 Final
  // Report Book_Primary" — plus the level / class when the file holds just that.
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, '_').trim();
  const only = payloads.length === 1 ? payloads[0] : null;
  const scope = !only
    ? ''
    : only.selectedSectionIds.length === 1
      ? ` ${only.level.code} ${only.sections.find((s) => s.id === only.selectedSectionIds[0])?.name ?? ''}`
      : ` ${only.level.code}`;
  const base = sanitize(
    reportBook
      ? `${ayCode} Final Report Book_${divisionName(payloads[0].level)}${scope}${
          filters.termNumber ? ` Term ${filters.termNumber}` : ''
        }`
      : consolidatedFileName(
          ayCode,
          consolidatedTerms(payloads, filters),
          scope
        )
  );

  if (asCsv) {
    const csv = reportBook
      ? reportBookToCsv(payloads, filters)
      : masterfileToCsv(payloads, filters);
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  const buffer = reportBook
    ? await buildReportBookWorkbook(payloads, filters)
    : await buildMasterfileWorkbook(payloads, filters);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** "AY2026 Term 2 CONSOLIDATED FORM", or "… CONSOLIDATED FORM All Terms". */
function consolidatedFileName(
  ayCode: string,
  terms: number[],
  scope: string
): string {
  return terms.length === 1
    ? `${ayCode} Term ${terms[0]} CONSOLIDATED FORM${scope}`
    : `${ayCode} CONSOLIDATED FORM All Terms${scope}`;
}
