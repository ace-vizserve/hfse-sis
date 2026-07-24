import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatRelativeTime, type ActivityRow } from '@/lib/account/activity';

const DOT_TONE_CLASS: Record<ActivityRow['tone'], string> = {
  default: 'bg-brand-indigo',
  info: 'bg-brand-sky',
  warning: 'bg-brand-amber',
  destructive: 'bg-destructive',
};

/**
 * The account page's "Recent activity" panel — the signed-in account's own
 * last N `audit_log` rows (already humanized by `getRecentActivity`,
 * lib/account/activity.ts), capped at 6 by the caller. Pure presentation:
 * no data fetching here. Spec:
 * docs/superpowers/specs/2026-07-24-account-page-role-aware-design.md §3.
 */
export function RecentActivityCard({
  rows,
  viewAllHref,
}: {
  rows: ActivityRow[];
  viewAllHref: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Recent activity
        </CardTitle>
        <CardDescription>
          Your last {rows.length ? rows.length : ''} actions on this system.
        </CardDescription>
      </CardHeader>
      <CardContent className="border-t border-border p-0">
        {rows.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-muted-foreground">
            No activity yet.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-6 py-3">
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_TONE_CLASS[row.tone]}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">
                      {row.label}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {formatRelativeTime(row.createdAt)}
                    </span>
                  </div>
                  {row.summary && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {row.summary}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={viewAllHref}
          className="flex items-center justify-center gap-1.5 border-t border-border px-6 py-3 text-sm font-semibold text-brand-indigo transition-colors hover:bg-muted/50"
        >
          View all activity
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
