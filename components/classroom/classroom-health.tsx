import Link from 'next/link';
import { ArrowUpRight, CheckCircle2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { StudentRecordLink } from '@/components/ui/student-record-link';
import {
  AT_RISK_ATTENDANCE_THRESHOLD_PCT,
  type AtRiskStudent,
} from '@/lib/classroom/health';
import { cn } from '@/lib/utils';

// Classroom Health — the "what needs doing" strip on the Overview tab
// (Phase 5). Two presentational pieces, both fed pre-derived data from the
// page (no fetching here): a compact checklist and the attendance-risk list.
// Every row's number comes straight from computePublishReadiness
// (lib/markbook/publish-readiness.ts) or the pure lib/classroom/health.ts
// helpers — nothing here invents a figure.

export type ClassroomHealthTone = 'ok' | 'warn' | 'info';

export type ClassroomHealthRow = {
  key: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  tone: ClassroomHealthTone;
  /** Omitted for rows with no in-classroom fix surface (e.g. no adviser). */
  href?: string;
};

// §9.3-derived tones for a compact tile, not a full status badge — 'ok' uses
// the healthy mint→sky pair, 'warn' the amber pair, 'info' stays a flat
// muted tile (the "nothing to compare yet" state, same convention as
// `not-started` tiles elsewhere in SIS Admin — see KD #154's visual-pass
// note on flat-vs-gradient tile use).
const TONE_TILE: Record<ClassroomHealthTone, string> = {
  ok: 'bg-gradient-to-br from-brand-mint to-brand-sky text-white shadow-brand-tile',
  warn: 'bg-gradient-to-br from-brand-amber to-brand-amber/80 text-white shadow-brand-tile',
  info: 'bg-muted text-muted-foreground',
};

function HealthRow({ row }: { row: ClassroomHealthRow }) {
  const inner = (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            TONE_TILE[row.tone]
          )}
        >
          <row.icon className="size-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{row.title}</p>
          <p className="text-xs text-muted-foreground">{row.detail}</p>
        </div>
      </div>
      {row.href && (
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  );

  if (!row.href) return inner;
  return (
    <Link
      href={row.href}
      className="group block transition-colors hover:bg-muted/40"
    >
      {inner}
    </Link>
  );
}

export function ClassroomHealthChecklist({
  rows,
}: {
  rows: ClassroomHealthRow[];
}) {
  // Nothing to say (e.g. no term selected, or the readiness read failed) —
  // render nothing rather than an empty card shell.
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        What needs doing
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {rows.map((row) => (
          <HealthRow key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}

export function ClassroomAtRiskPanel({
  students,
  canOpenRecord,
}: {
  /** `null` = no attendance rollup recorded yet this term — hidden entirely,
   * never rendered as a fabricated "0 at risk." An empty array (rollups
   * exist, nobody is below the threshold) is a real, positive result and
   * does render. */
  students: AtRiskStudent[] | null;
  /** Oversight only — from `canOpenStudentRecord(capability)` on the server. */
  canOpenRecord: boolean;
}) {
  if (students === null) return null;

  return (
    <div className="space-y-2">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Attendance risk
        <span className="ml-2 normal-case tracking-normal text-muted-foreground/80">
          below {AT_RISK_ATTENDANCE_THRESHOLD_PCT}% this term
        </span>
      </h2>
      {students.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-card px-5 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-brand-mint" />
          No students below {AT_RISK_ATTENDANCE_THRESHOLD_PCT}% attendance this
          term.
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {students.map((s) => (
            <div
              key={s.sectionStudentId}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {s.indexNumber ?? '—'}
                </span>
                <StudentRecordLink
                  studentNumber={s.studentNumber}
                  canOpen={canOpenRecord}
                >
                  {s.name}
                </StudentRecordLink>
              </div>
              <Badge variant="warning">{s.attendancePct.toFixed(1)}%</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
