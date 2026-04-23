import Link from 'next/link';
import { CalendarRange } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { EnrollmentHistoryEntry } from '@/lib/sis/queries';

export function EnrollmentHistoryChips({
  history,
  currentAyCode,
}: {
  history: EnrollmentHistoryEntry[];
  currentAyCode: string;
}) {
  if (history.length === 0) {
    return null;
  }

  // Sort newest first.
  const sorted = [...history].sort((a, b) => b.ayCode.localeCompare(a.ayCode));

  return (
    <div className="rounded-xl border border-hairline bg-card p-4">
      <div className="flex items-start gap-3">
        <CalendarRange className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Enrollment history · {sorted.length} year{sorted.length === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {sorted.map((entry) => {
              const isCurrent = entry.ayCode === currentAyCode;
              const summary = [entry.level, entry.section].filter(Boolean).join(' · ') || '—';
              return (
                <Link
                  key={`${entry.ayCode}:${entry.enroleeNumber}`}
                  href={{
                    pathname: `/records/students/by-enrolee/${entry.enroleeNumber}`,
                    query: { ay: entry.ayCode },
                  }}
                  className={cn(
                    'group inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all',
                    isCurrent
                      ? 'border-brand-indigo bg-brand-indigo/5 text-brand-indigo-deep'
                      : 'border-hairline bg-background text-foreground hover:border-brand-indigo/40 hover:bg-muted/60',
                  )}
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-mono text-[10px] uppercase tracking-wider',
                      isCurrent && 'border-brand-indigo/50 bg-background',
                    )}
                  >
                    {entry.ayCode}
                  </Badge>
                  <span className="text-xs">{summary}</span>
                  {entry.status && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {entry.status}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-brand-indigo">
                      Viewing
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
