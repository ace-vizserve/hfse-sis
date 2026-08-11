import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

// Per-event transfer entry surfaced on /records/students/[studentNumber].
// Sourced from `audit_log` rows where action = 'student.section.transfer'.
// The route writes a context blob with the from/to + term + date — read it
// back here so the records page can render a tidy timeline without a new
// table (KD #9: audit log is the canonical mutation history).
export type SectionTransferEntry = {
  id: string;
  ayCode: string;
  fromSection: string;
  fromLevel: string;
  toSection: string;
  toLevel: string;
  transferDate: string; // ISO date (yyyy-mm-dd)
  termNumber: number | null; // 1..4 or null when transfer was between terms
  termLabel: string | null; // 'T1' / 'T2' / 'T3' / 'T4' or null
  actorEmail: string | null;
  createdAt: string;
};

// Fetches every `student.section.transfer` audit row for a given student,
// keyed by `studentNumber` (Hard Rule #4 — the cross-AY stable ID). The
// route's `entityId` is `enroleeNumber`, which is per-AY; resolve via the
// student's known enroleeNumbers across AYs first, then OR them into the
// audit-log filter.
export async function getSectionTransfersForStudent(
  studentNumber: string,
  enroleeNumbers: string[]
): Promise<SectionTransferEntry[]> {
  if (enroleeNumbers.length === 0) return [];

  const service = createServiceClient();
  const { data, error } = await service
    .from('audit_log')
    .select('id, action, actor_email, context, created_at')
    .eq('action', 'student.section.transfer')
    .in('entity_id', enroleeNumbers)
    .order('created_at', { ascending: false })
    // Bounded by one student's enrolee numbers, so small today — ranged
    // anyway because `audit_log` only grows, and a truncated transfer history
    // silently rewrites where a child has been.
    .range(0, 999);

  if (error) {
    console.warn(
      `[section-history] audit fetch failed for ${studentNumber}:`,
      error.message
    );
    return [];
  }

  type AuditRow = {
    id: string;
    actor_email: string | null;
    context: Record<string, unknown> | null;
    created_at: string;
  };

  return ((data ?? []) as AuditRow[]).map((row) => {
    const ctx = (row.context ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      ayCode: (ctx.ay_code as string | undefined) ?? '',
      fromSection: (ctx.fromSection as string | undefined) ?? '',
      fromLevel: (ctx.fromLevel as string | undefined) ?? '',
      toSection: (ctx.toSection as string | undefined) ?? '',
      toLevel: (ctx.toLevel as string | undefined) ?? '',
      transferDate:
        (ctx.transferDate as string | undefined) ?? row.created_at.slice(0, 10),
      termNumber: (ctx.termNumber as number | null | undefined) ?? null,
      termLabel: (ctx.termLabel as string | null | undefined) ?? null,
      actorEmail: row.actor_email,
      createdAt: row.created_at,
    };
  });
}
