import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { fetchAllPages } from '@/lib/supabase/paginate';
import { createServiceClient } from '@/lib/supabase/service';
import { buildCsv } from '@/lib/csv';

// Admin + superadmin CSV export of the audit log within a date range.
// Unions `public.audit_log` + legacy `public.grade_audit_log` filtered by
// timestamp, same merge shape the /admin/audit-log page uses.
export async function GET(req: Request) {
  const auth = await requireRole(['school_admin', 'superadmin']);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  if (!fromParam || !toParam || !isIsoDate(fromParam) || !isIsoDate(toParam)) {
    return NextResponse.json(
      { error: 'from and to are required (YYYY-MM-DD)' },
      { status: 400 }
    );
  }

  const fromIso = `${fromParam}T00:00:00.000Z`;
  const toIso = `${toParam}T23:59:59.999Z`;

  type NewRow = {
    id: string;
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    context: Record<string, unknown> | null;
    created_at: string;
  };
  type LegacyRow = {
    id: string;
    grading_sheet_id: string;
    grade_entry_id: string;
    field_changed: string;
    old_value: string | null;
    new_value: string | null;
    approval_reference: string | null;
    changed_by: string;
    changed_at: string;
  };

  // Service client — superadmin is already authenticated; the read is
  // deliberately not RLS-scoped, because the archive is the whole trail.
  //
  // "Unbounded" used to be literal, and that was the bug: PostgREST caps a
  // response at 1,000 rows and returns the first page with no error and no
  // flag. `audit_log` held 1,390 rows on 2026-08-10, 1,322 of them in the
  // preceding 90 days, so any term-length export was already stopping short —
  // silently, on the one artifact where a gap is worst. Paginated now.
  const service = createServiceClient();

  const [newRaw, legacyRaw] = await Promise.all([
    fetchAllPages<NewRow>((from, to) =>
      service
        .from('audit_log')
        .select(
          'id, actor_email, action, entity_type, entity_id, context, created_at'
        )
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: false })
        .range(from, to)
    ),
    fetchAllPages<LegacyRow>((from, to) =>
      service
        .from('grade_audit_log')
        .select('*')
        .gte('changed_at', fromIso)
        .lte('changed_at', toIso)
        .order('changed_at', { ascending: false })
        .range(from, to)
    ),
  ]);

  type Row = {
    timestamp_utc: string;
    source: 'audit_log' | 'grade_audit_log';
    actor_email: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    sheet_id: string | null;
    context_json: string;
  };

  const newRows: Row[] = newRaw.map((r): Row => {
    const ctx = r.context ?? {};
    const sheetId =
      (ctx['grading_sheet_id'] as string | undefined) ??
      (r.entity_type === 'grading_sheet' ? r.entity_id : null) ??
      null;
    return {
      timestamp_utc: r.created_at,
      source: 'audit_log',
      actor_email: r.actor_email,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      sheet_id: sheetId,
      context_json: JSON.stringify(ctx),
    };
  });
  const legacyRows: Row[] = legacyRaw.map((r): Row => {
    const isTotals =
      r.field_changed.startsWith('ww_totals') ||
      r.field_changed.startsWith('pt_totals') ||
      r.field_changed === 'qa_total';
    return {
      timestamp_utc: r.changed_at,
      source: 'grade_audit_log',
      actor_email: r.changed_by,
      action: isTotals ? 'totals.update' : 'entry.update',
      entity_type: isTotals ? 'grading_sheet' : 'grade_entry',
      entity_id: r.grade_entry_id,
      sheet_id: r.grading_sheet_id,
      context_json: JSON.stringify({
        field: r.field_changed,
        old: r.old_value,
        new: r.new_value,
        approval_reference: r.approval_reference,
        legacy: true,
      }),
    };
  });

  // Linear two-pointer merge — both sources are already `ORDER BY ... DESC`
  // from the queries above, so a `[...a, ...b].sort()` would be O(n log n)
  // over two pre-sorted arrays. ISO-8601 timestamps compare lexicographically,
  // no `Date` allocation per comparison (§3 of 11-performance-patterns.md).
  const rows: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < newRows.length && j < legacyRows.length) {
    if (newRows[i].timestamp_utc >= legacyRows[j].timestamp_utc) {
      rows.push(newRows[i++]);
    } else {
      rows.push(legacyRows[j++]);
    }
  }
  while (i < newRows.length) rows.push(newRows[i++]);
  while (j < legacyRows.length) rows.push(legacyRows[j++]);

  const body = buildCsv(
    [
      'timestamp_utc',
      'source',
      'actor_email',
      'action',
      'entity_type',
      'entity_id',
      'sheet_id',
      'context_json',
    ],
    rows.map((r) => [
      r.timestamp_utc,
      r.source,
      r.actor_email,
      r.action,
      r.entity_type,
      r.entity_id,
      r.sheet_id,
      r.context_json,
    ])
  );

  const filename = `audit-log-${fromParam}-to-${toParam}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
