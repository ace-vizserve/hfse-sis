import { NextResponse, type NextRequest } from 'next/server';
import * as XLSX from 'xlsx';

import { requireRole } from '@/lib/auth/require-role';
import { logAction } from '@/lib/audit/log-action';
import { createServiceClient } from '@/lib/supabase/service';
import { writeDailyBulk } from '@/lib/attendance/mutations';
import {
  ATTENDANCE_STATUS_VALUES,
  type AttendanceStatus,
  ImportConfigSchema,
} from '@/lib/schemas/attendance';

// POST /api/attendance/import
//
// Multipart form:
//   file:     .xlsx workbook, one sheet per section
//   termId:   target term (all daily rows write under this term)
//   sectionId (optional): if set, only import the sheet matching this section
//   dryRun    (optional): parse + report without writing
//
// Per sheet:
//   - Match sheet name → `sections.name` (AY-scoped via the term's AY)
//     * Exact match first; if that fails, try stripping a level-code prefix
//       ("P1 Patience(G)" → "Patience(G)")
//     * Unmatched sheets are reported in `errors[]`, never silently skipped
//   - Header row: detect the fixed-label columns (Index No, Full Name, etc.)
//     and treat every remaining column with a parseable date or "MMM d" label
//     as a daily-attendance column
//   - Per student row: match by section_students.(section_id, index_number)
//   - Write all daily codes via writeDailyBulk (bulk insert + rollup recompute)
//
// Excel-computed totals (`Days present`, `Attendance %`, `Days late`, etc) are
// IGNORED — the server recomputes the rollup from the raw codes as the sole
// source of truth (KD #47 + doc §Agreed decisions §3).
//
// SECURITY NOTE: the `xlsx` SheetJS npm package has advisories around
// prototype pollution in untrusted input. Input here is trusted (registrar-
// uploaded, staff-authenticated). If/when parent-uploaded sheets become a
// thing, switch to the CDN build of SheetJS or move to `exceljs`.

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB — T1 reference is ~50 KB

const FIXED_HEADERS = new Set(
  [
    'index no',
    'index no.',
    'bus no',
    'bus no.',
    'urgent/compassionate leave',
    'classroom officers',
    'full name',
    'days present',
    'attendance %',
    'days late',
    'excused',
    'days excused',
    'days absent',
    'total days with class',
    'jan / %',
    'feb / %',
    'mar / %',
    'apr / %',
    'may / %',
    'jun / %',
    'jul / %',
    'aug / %',
    'sep / %',
    'oct / %',
    'nov / %',
    'dec / %',
  ].map((s) => s.toLowerCase()),
);

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Try to coerce a cell value (Date | number | string) to yyyy-MM-dd.
// Returns null when the cell is not a plausible calendar date.
function cellToIsoDate(value: unknown, fallbackYear: number): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d && d.y && d.m && d.d) {
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (FIXED_HEADERS.has(trimmed.toLowerCase())) return null;

    // "Jan 8", "Feb 15", etc — month abbreviation + day
    const mmmD = /^([A-Za-z]{3,9})\s+(\d{1,2})$/.exec(trimmed);
    if (mmmD) {
      const monthKey = mmmD[1].slice(0, 3).toLowerCase();
      const month = MONTH_INDEX[monthKey];
      const day = parseInt(mmmD[2], 10);
      if (month && day >= 1 && day <= 31) {
        return `${fallbackYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }

    // Full ISO or yyyy-MM-dd
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    return null;
  }
  return null;
}

function normalizeStatus(raw: unknown): AttendanceStatus | null {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase();
  if (!up) return null;
  return (ATTENDANCE_STATUS_VALUES as readonly string[]).includes(up)
    ? (up as AttendanceStatus)
    : null;
}

// Try exact + stripped-prefix match against the section list for the AY.
function matchSheetToSection(
  sheetName: string,
  sections: Array<{ id: string; name: string; level_code: string | null }>,
): { id: string; name: string } | null {
  const sheet = sheetName.trim();
  const exact = sections.find((s) => s.name.trim() === sheet);
  if (exact) return exact;

  // Strip level prefix: "P1 Patience(G)" → "Patience(G)"
  const prefixed = sections.find((s) => {
    const prefix = s.level_code ? `${s.level_code} ` : '';
    return prefix && `${prefix}${s.name.trim()}` === sheet;
  });
  if (prefixed) return prefixed;

  // Case-insensitive, compact-whitespace
  const compact = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const loose = sections.find((s) => compact(s.name) === compact(sheet));
  if (loose) return loose;

  const looseWithPrefix = sections.find((s) => {
    const prefix = s.level_code ? `${s.level_code} ` : '';
    return prefix && compact(`${prefix}${s.name}`) === compact(sheet);
  });
  if (looseWithPrefix) return looseWithPrefix;

  return null;
}

type SheetReport = {
  sheet: string;
  sectionId: string | null;
  sectionName: string | null;
  dailyRowsWritten: number;
  studentsMatched: number;
  studentsUnmatched: Array<{ indexNumber: unknown; fullName: unknown }>;
  dateColumns: number;
  errors: string[];
};

export async function POST(request: NextRequest) {
  const auth = await requireRole([
    'registrar',
    'school_admin',
    'superadmin',
  ]);
  if ('error' in auth) return auth.error;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `file exceeds ${MAX_FILE_SIZE / (1024 * 1024)} MB limit` },
      { status: 400 },
    );
  }

  const config = ImportConfigSchema.safeParse({
    termId: formData.get('termId'),
    sectionId: formData.get('sectionId') || undefined,
    dryRun: formData.get('dryRun') === 'true',
  });
  if (!config.success) {
    return NextResponse.json(
      { error: 'invalid import config', details: config.error.flatten() },
      { status: 400 },
    );
  }
  const { termId, sectionId, dryRun } = config.data;

  const service = createServiceClient();

  // Resolve term → academic year for sheet/section scoping + date year fallback.
  const { data: term, error: termErr } = await service
    .from('terms')
    .select('id, academic_year_id, start_date, end_date')
    .eq('id', termId)
    .maybeSingle();
  if (termErr || !term) {
    return NextResponse.json({ error: 'unknown termId' }, { status: 400 });
  }
  const termYear = term.start_date
    ? parseInt(String(term.start_date).slice(0, 4), 10)
    : new Date().getUTCFullYear();

  // Sections for this AY, joined with level code for sheet-name matching.
  const { data: sectionsRaw, error: sectionsErr } = await service
    .from('sections')
    .select('id, name, level:levels(code)')
    .eq('academic_year_id', term.academic_year_id);
  if (sectionsErr) {
    return NextResponse.json(
      { error: `sections lookup failed: ${sectionsErr.message}` },
      { status: 500 },
    );
  }
  const sections = ((sectionsRaw ?? []) as Array<{
    id: string;
    name: string;
    level: { code: string } | { code: string }[] | null;
  }>).map((s) => ({
    id: s.id,
    name: s.name,
    level_code: Array.isArray(s.level) ? s.level[0]?.code ?? null : s.level?.code ?? null,
  }));

  // Parse workbook.
  const buffer = Buffer.from(await file.arrayBuffer());
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { cellDates: true, type: 'buffer' });
  } catch (e) {
    return NextResponse.json(
      { error: `workbook parse failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  const sheetsReport: SheetReport[] = [];
  let totalDailyWritten = 0;
  let totalStudentsMatched = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Honour sectionId filter: skip sheets not matching.
    const matched = matchSheetToSection(sheetName, sections);
    if (sectionId && matched?.id !== sectionId) continue;

    const report: SheetReport = {
      sheet: sheetName,
      sectionId: matched?.id ?? null,
      sectionName: matched?.name ?? null,
      dailyRowsWritten: 0,
      studentsMatched: 0,
      studentsUnmatched: [],
      dateColumns: 0,
      errors: [],
    };

    if (!matched) {
      report.errors.push(`no section matches sheet "${sheetName}"`);
      sheetsReport.push(report);
      continue;
    }

    // Read as array-of-arrays so we can see the header row verbatim.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    });
    if (rows.length < 2) {
      report.errors.push('sheet has no data rows');
      sheetsReport.push(report);
      continue;
    }

    const header = rows[0];
    // Map each column index → either 'fixed' (ignored for daily writes) or an ISO date string.
    const columnToDate = new Map<number, string>();
    let indexNoCol = -1;
    let fullNameCol = -1;
    for (let c = 0; c < header.length; c += 1) {
      const cell = header[c];
      const cellLower = typeof cell === 'string' ? cell.trim().toLowerCase() : '';
      if (cellLower === 'index no' || cellLower === 'index no.') {
        indexNoCol = c;
        continue;
      }
      if (cellLower === 'full name') {
        fullNameCol = c;
        continue;
      }
      if (FIXED_HEADERS.has(cellLower)) continue;

      const iso = cellToIsoDate(cell, termYear);
      if (iso) {
        columnToDate.set(c, iso);
      }
    }
    report.dateColumns = columnToDate.size;
    if (indexNoCol < 0) {
      report.errors.push('could not locate "Index No" column');
      sheetsReport.push(report);
      continue;
    }
    if (columnToDate.size === 0) {
      report.errors.push('no daily-attendance date columns detected in header');
      sheetsReport.push(report);
      continue;
    }

    // Pull enrolments for this section with their index numbers.
    const { data: enrolments, error: enrErr } = await service
      .from('section_students')
      .select('id, index_number')
      .eq('section_id', matched.id);
    if (enrErr) {
      report.errors.push(`enrolment fetch failed: ${enrErr.message}`);
      sheetsReport.push(report);
      continue;
    }
    const byIndexNumber = new Map<string, string>();
    for (const e of enrolments ?? []) {
      const idx = String(e.index_number ?? '').trim();
      if (idx) byIndexNumber.set(idx, e.id as string);
    }

    // Collect daily inputs across student rows.
    const dailyInputs: Array<{
      sectionStudentId: string;
      termId: string;
      date: string;
      status: AttendanceStatus;
      recordedBy: string | null;
    }> = [];

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      if (!row) continue;
      const rawIndex = row[indexNoCol];
      if (rawIndex == null || String(rawIndex).trim() === '') continue;

      const indexKey = String(rawIndex).trim();
      const ssId = byIndexNumber.get(indexKey);
      if (!ssId) {
        report.studentsUnmatched.push({
          indexNumber: rawIndex,
          fullName: fullNameCol >= 0 ? row[fullNameCol] : null,
        });
        continue;
      }
      report.studentsMatched += 1;

      for (const [col, date] of columnToDate.entries()) {
        const cell = row[col];
        const status = normalizeStatus(cell);
        if (!status) continue;
        dailyInputs.push({
          sectionStudentId: ssId,
          termId,
          date,
          status,
          recordedBy: auth.user.id,
        });
      }
    }

    if (!dryRun && dailyInputs.length > 0) {
      try {
        const { inserted } = await writeDailyBulk(service, dailyInputs);
        report.dailyRowsWritten = inserted;
      } catch (e) {
        report.errors.push(e instanceof Error ? e.message : String(e));
      }
    } else {
      report.dailyRowsWritten = dailyInputs.length; // dry-run reports intent
    }

    totalDailyWritten += report.dailyRowsWritten;
    totalStudentsMatched += report.studentsMatched;

    if (!dryRun) {
      await logAction({
        service,
        actor: { id: auth.user.id, email: auth.user.email ?? null },
        action: 'attendance.import.bulk',
        entityType: 'attendance_daily',
        entityId: matched.id,
        context: {
          section_id: matched.id,
          section_name: matched.name,
          term_id: termId,
          sheet_name: sheetName,
          rows_written: report.dailyRowsWritten,
          students_matched: report.studentsMatched,
          students_unmatched: report.studentsUnmatched.length,
          date_columns: report.dateColumns,
        },
      });
    }

    sheetsReport.push(report);
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    termId,
    sections: sheetsReport.length,
    totalDailyWritten,
    totalStudentsMatched,
    reports: sheetsReport,
  });
}
