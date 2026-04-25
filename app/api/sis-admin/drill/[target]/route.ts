import { NextResponse } from 'next/server';

import { requireRole } from '@/lib/auth/require-role';
import { buildCsv } from '@/lib/csv';
import {
  loadAcademicYearsList,
  loadActorActivity,
  loadApproverAssignments,
  loadAuditEventsUncached,
  modulePrefixFor,
  type AcademicYearDrillRow,
  type ActorActivityDrillRow,
  type ApproverAssignmentDrillRow,
  type AuditDrillRow,
  type SisAdminDrillTarget,
} from '@/lib/sis/drill';

const VALID_TARGETS: SisAdminDrillTarget[] = [
  'audit-events',
  'approver-coverage',
  'academic-years',
  'activity-by-actor',
];

const ALLOWED_ROLES = ['school_admin', 'admin', 'superadmin'] as const;

type AnyRow =
  | AuditDrillRow
  | ApproverAssignmentDrillRow
  | AcademicYearDrillRow
  | ActorActivityDrillRow;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ target: string }> },
) {
  const guard = await requireRole([...ALLOWED_ROLES]);
  if ('error' in guard) return guard.error;

  const { target: rawTarget } = await ctx.params;
  if (!VALID_TARGETS.includes(rawTarget as SisAdminDrillTarget)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 });
  }
  const target = rawTarget as SisAdminDrillTarget;

  const url = new URL(req.url);
  const segment = url.searchParams.get('segment');
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const format = url.searchParams.get('format') ?? 'json';
  const range = from && to ? { from, to } : undefined;

  let rows: AnyRow[] = [];
  let title = '';
  let eyebrow = '';
  let effectiveTarget: SisAdminDrillTarget = target;

  switch (target) {
    case 'audit-events': {
      const prefix = segment ? modulePrefixFor(segment) : '';
      rows = await loadAuditEventsUncached(prefix, range);
      title = segment ? `Audit · ${segment}` : 'All audit events';
      eyebrow = 'Drill · Audit';
      break;
    }
    case 'approver-coverage':
      rows = await loadApproverAssignments();
      title = 'Approver assignments';
      eyebrow = 'Drill · Approvers';
      break;
    case 'academic-years':
      rows = await loadAcademicYearsList();
      title = 'Academic years';
      eyebrow = 'Drill · AY';
      break;
    case 'activity-by-actor': {
      // When a segment (actor user_id) is provided, pivot to that actor's
      // audit events instead of returning the actor list.
      if (segment) {
        const events = await loadAuditEventsUncached('', range);
        rows = events.filter((e) => {
          // Filter by actor — we don't have actor_id on AuditDrillRow, so
          // we filter by the email match heuristic if context contains it,
          // or leave the events list flat. As a safe fallback we return
          // all events when no email-match is available.
          // The activity-by-actor card-side workflow passes the actor email
          // (not user_id) in the segment for emails that are resolvable.
          return e.actorEmail === segment;
        });
        title = `Events by ${segment}`;
        eyebrow = 'Drill · Actor';
        effectiveTarget = 'audit-events';
      } else {
        rows = await loadActorActivity(range);
        title = 'Top actors by activity';
        eyebrow = 'Drill · Actors';
      }
      break;
    }
  }

  if (format === 'csv') {
    return csvResponse(rows, effectiveTarget, segment);
  }

  return NextResponse.json({
    rows,
    total: rows.length,
    target: effectiveTarget,
    segment,
    eyebrow,
    title,
  });
}

function csvResponse(
  rows: AnyRow[],
  target: SisAdminDrillTarget,
  segment: string | null,
): Response {
  let headers: string[] = [];
  let body: (string | number)[][] = [];
  switch (target) {
    case 'audit-events':
      headers = ['Action', 'Actor', 'Entity type', 'Entity ID', 'When'];
      body = (rows as AuditDrillRow[]).map((r) => [
        r.action,
        r.actorEmail ?? '',
        r.entityType,
        r.entityId ?? '',
        r.createdAt,
      ]);
      break;
    case 'approver-coverage':
      headers = ['Flow', 'Email', 'Role', 'Assigned'];
      body = (rows as ApproverAssignmentDrillRow[]).map((r) => [
        r.flow,
        r.email ?? r.userId,
        r.role,
        r.assignedAt ?? '',
      ]);
      break;
    case 'academic-years':
      headers = ['AY', 'Label', 'Current', 'Terms', 'Students'];
      body = (rows as AcademicYearDrillRow[]).map((r) => [
        r.ayCode,
        r.label ?? '',
        r.isCurrent ? 'Yes' : 'No',
        r.termsCount,
        r.studentsCount,
      ]);
      break;
    case 'activity-by-actor':
      headers = ['Actor', 'Events', 'Last event'];
      body = (rows as ActorActivityDrillRow[]).map((r) => [
        r.email ?? r.userId,
        r.count,
        r.lastEventAt ?? '',
      ]);
      break;
  }
  const csv = buildCsv(headers, body);
  const segmentSlug = segment
    ? `-${segment.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`
    : '';
  const today = new Date().toISOString().slice(0, 10);
  const filename = `drill-sis-admin-${target}${segmentSlug}-${today}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
