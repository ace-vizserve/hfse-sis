import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getUserRole } from '@/lib/auth/roles';
import { buildCsv } from '@/lib/csv';

// Admin + superadmin CSV export of the audit log within a date range.
// Unions `public.audit_log` + legacy `public.grade_audit_log` filtered by
// timestamp, same merge shape the /admin/audit-log page uses.
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const role = getUserRole(userData.user);
  if (role !== 'school_admin' && role !== 'admin' && role !== 'superadmin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  if (!fromParam || !toParam || !isIsoDate(fromParam) || !isIsoDate(toParam)) {
    return NextResponse.json(
      { error: 'from and to are required (YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  const fromIso = `${fromParam}T00:00:00.000Z`;
  const toIso = `${toParam}T23:59:59.999Z`;

  // Service client — superadmin is already authenticated; we want an
  // unbounded (no RLS scoping) read for the archive.
  const service = createServiceClient();

  const [newRes, legacyRes] = await Promise.all([
    service
      .from('audit_log')
      .select('id, actor_email, action, entity_type, entity_id, context, created_at')
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false }),
    service
      .from('grade_audit_log')
      .select('*')
      .gte('changed_at', fromIso)
      .lte('changed_at', toIso)
      .order('changed_at', { ascending: false }),
  ]);

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

  const rows: Row[] = [
    ...((newRes.data ?? []) as NewRow[]).map((r): Row => {
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
    }),
    ...((legacyRes.data ?? []) as LegacyRow[]).map((r): Row => {
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
    }),
  ].sort((a, b) =>
    // ISO-8601 timestamps sort lexicographically — no `Date` allocation per
    // comparison. Descending = most recent first.
    b.timestamp_utc < a.timestamp_utc ? -1 : b.timestamp_utc > a.timestamp_utc ? 1 : 0,
  );

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
    ]),
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
