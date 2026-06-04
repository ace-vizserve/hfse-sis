import { type NextRequest } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { requireCurrentAyCode } from '@/lib/academic-year';
import { buildMasterfileWorkbook } from '@/lib/markbook/masterfile-export';
import { loadMasterfile } from '@/lib/markbook/masterfile';
import { createServiceClient } from '@/lib/supabase/service';

// GET /api/markbook/masterfile/export
//
// Excel report-book export of the Masterfile (KD #95). Same auth/role gate and
// the same ?ay= / ?level= / ?class= params as the on-screen page at
// /markbook/masterfile — loads the identical computed payload via
// `loadMasterfile`, then streams it as an .xlsx attachment.
//
// Query params:
//   ?level=<level_id>    required
//   ?class=<section_id>  optional, repeatable (filter to the listed classes;
//                          omit for all classes). Also accepts a single
//                          comma-joined value for back-compat.
//   ?ay=<ay_code>        optional (defaults to current AY)

export async function GET(req: NextRequest) {
  // Page is registrar | school_admin | superadmin — mirror it here.
  const auth = await requireRole(['registrar', 'school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const service = createServiceClient();
  const { searchParams } = new URL(req.url);

  const levelId = searchParams.get('level');
  if (!levelId) {
    return new Response('Missing required ?level= parameter.', { status: 400 });
  }

  // Parse one or more section ids — repeated ?class= params, plus a comma-joined
  // single value for back-compat. Mirrors the on-screen multi-section filter so
  // the workbook contains exactly the classes shown, not all of them.
  const sectionIds = searchParams
    .getAll('class')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

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

  // Defence-in-depth: validate ?level= belongs to the resolved AY (mirrors the
  // page's level validation). loadMasterfile already returns empty for a
  // mismatch, but a 400 is a clearer signal than a blank workbook.
  const { data: ayRow } = await service
    .from('academic_years')
    .select('id')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (!ayRow) {
    return new Response('Could not resolve academic year.', { status: 404 });
  }
  const { data: levelInAy } = await service
    .from('sections')
    .select('id')
    .eq('academic_year_id', (ayRow as { id: string }).id)
    .eq('level_id', levelId)
    .limit(1)
    .maybeSingle();
  if (!levelInAy) {
    return new Response(
      'The requested level has no sections in this academic year.',
      { status: 400 }
    );
  }

  const payload = await loadMasterfile({
    ayCode,
    levelId,
    sectionIds: sectionIds.length > 0 ? sectionIds : undefined,
  });

  if (!payload) {
    return new Response('Could not load Masterfile data.', { status: 404 });
  }

  const buffer = buildMasterfileWorkbook(payload);

  // Filename: Masterfile_{level}_{class|all}_{AY}.xlsx — sanitize to safe chars.
  // One selected section → its name; multiple → "{n}_classes"; none / all → "all".
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
  const levelPart = sanitize(
    payload.level.label || payload.level.code || 'level'
  );
  const isAllSections =
    sectionIds.length === 0 || sectionIds.length >= payload.sections.length;
  let classPart: string;
  if (isAllSections) {
    classPart = 'all';
  } else if (sectionIds.length === 1) {
    const only = payload.sections.find((s) => s.id === sectionIds[0]);
    classPart = only ? sanitize(only.name) : 'class';
  } else {
    classPart = `${sectionIds.length}_classes`;
  }
  const filename = `Masterfile_${levelPart}_${classPart}_${ayCode}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
