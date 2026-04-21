import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Check,
  ClipboardList,
  FileCheck2,
  Lock,
  MessageSquareWarning,
  Pencil,
  Unlock,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { RecentMarkbookActivityRow } from '@/lib/markbook/dashboard';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function RecentMarkbookActivity({ rows }: { rows: RecentMarkbookActivityRow[] }) {
  const empty = rows.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Activity · Last {rows.length || 0} updates
        </CardDescription>
        <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
          Recent Markbook activity
        </CardTitle>
        <CardAction>
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Activity className="size-4" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {empty ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center">
            <Activity className="size-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">No recent activity</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Sheet locks, grade edits, publications, and change-request transitions appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((r) => {
              const { Icon, label, tint } = describeAction(r.action);
              return (
                <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                  <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${tint}`}>
                    <Icon className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm text-foreground">
                      <span className="font-medium">{label}</span>
                      {r.entityId && (
                        <>
                          {' · '}
                          <span className="font-mono text-[12px] text-muted-foreground">
                            {r.entityId}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {r.actorEmail ?? 'system'} · {formatRelative(r.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {!empty && (
        <CardFooter className="flex items-center justify-end border-t border-border px-5 py-3 text-xs">
          <Link
            href="/markbook/audit-log"
            className="inline-flex items-center gap-1 font-medium text-foreground hover:text-brand-indigo-deep"
          >
            Full audit log
            <ArrowRight className="size-3" />
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}

const ACTION_MAP: Record<string, { label: string; Icon: LucideIcon; tint: string }> = {
  'sheet.create': { label: 'Grading sheet created', Icon: ClipboardList, tint: 'bg-accent text-brand-indigo-deep' },
  'sheet.lock': { label: 'Sheet locked', Icon: Lock, tint: 'bg-brand-mint/30 text-ink' },
  'sheet.unlock': { label: 'Sheet unlocked', Icon: Unlock, tint: 'bg-brand-amber/30 text-ink' },
  'entry.update': { label: 'Grade entry updated', Icon: Pencil, tint: 'bg-accent text-brand-indigo-deep' },
  'totals.update': { label: 'Sheet totals updated', Icon: Pencil, tint: 'bg-accent text-brand-indigo-deep' },
  'student.sync': { label: 'Students synced', Icon: Users, tint: 'bg-accent text-brand-indigo-deep' },
  'student.add': { label: 'Student added manually', Icon: UserPlus, tint: 'bg-accent text-brand-indigo-deep' },
  'assignment.create': { label: 'Teacher assigned', Icon: UserPlus, tint: 'bg-accent text-brand-indigo-deep' },
  'assignment.delete': { label: 'Assignment removed', Icon: Users, tint: 'bg-muted text-muted-foreground' },
  'attendance.update': { label: 'Attendance updated', Icon: Pencil, tint: 'bg-accent text-brand-indigo-deep' },
  'comment.update': { label: 'Adviser comment updated', Icon: Pencil, tint: 'bg-accent text-brand-indigo-deep' },
  'publication.create': { label: 'Report cards published', Icon: FileCheck2, tint: 'bg-brand-mint/30 text-ink' },
  'publication.delete': { label: 'Publication window removed', Icon: FileCheck2, tint: 'bg-muted text-muted-foreground' },
  'grade_change_requested': { label: 'Change request filed', Icon: MessageSquareWarning, tint: 'bg-brand-amber/30 text-ink' },
  'grade_change_approved': { label: 'Change request approved', Icon: Check, tint: 'bg-brand-mint/30 text-ink' },
  'grade_change_rejected': { label: 'Change request rejected', Icon: MessageSquareWarning, tint: 'bg-destructive/10 text-destructive' },
  'grade_change_cancelled': { label: 'Change request cancelled', Icon: MessageSquareWarning, tint: 'bg-muted text-muted-foreground' },
  'grade_change_applied': { label: 'Change request applied', Icon: Check, tint: 'bg-brand-mint/30 text-ink' },
  'grade_correction': { label: 'Data-entry correction', Icon: Pencil, tint: 'bg-accent text-brand-indigo-deep' },
};

function describeAction(action: string) {
  return (
    ACTION_MAP[action] ?? {
      label: action.replace(/\./g, ' '),
      Icon: Check,
      tint: 'bg-muted text-muted-foreground',
    }
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.round((now - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
}
