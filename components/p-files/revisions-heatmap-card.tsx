'use client';

import * as React from 'react';
import { Calendar } from 'lucide-react';

import { PFilesDrillSheet } from '@/components/p-files/drills/pfiles-drill-sheet';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { RevisionsHeatmapCell } from '@/lib/p-files/dashboard';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * RevisionsHeatmapCard — 12-week × 7-day calendar grid of P-Files revision
 * counts. Empty cells render as muted; populated cells use brand-indigo→navy
 * gradient with opacity scaled by intensity. Hover cell to scale + see the
 * date + count tooltip; click to drill into that day's revisions.
 *
 * Backed by lib/p-files/dashboard.ts::getRevisionsHeatmap which queries
 * p_file_revisions filtered by ay_code + replaced_at >= 12 weeks ago.
 */
export function RevisionsHeatmapCard({
  data,
  ayCode,
  weeks = 12,
}: {
  data: RevisionsHeatmapCell[];
  ayCode: string;
  weeks?: number;
}) {
  const [openDate, setOpenDate] = React.useState<string | null>(null);

  const max = data.reduce((m, c) => (c.count > m ? c.count : m), 0);
  const total = data.reduce((s, c) => s + c.count, 0);
  const intensity = (count: number): number => {
    if (count === 0 || max === 0) return 0;
    return Math.min(1, count / max);
  };

  // Lay out chronologically into a 7-row × N-column grid (rows = days of
  // week, cols = weeks). The data array's first cell determines row 0's
  // start day.
  const grid: (RevisionsHeatmapCell | null)[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: weeks }, () => null as RevisionsHeatmapCell | null),
  );
  if (data.length > 0) {
    const firstDate = new Date(data[0].date);
    // JS getDay(): Sun=0..Sat=6 → remap to Mon=0..Sun=6
    const firstDow = (firstDate.getDay() + 6) % 7;
    let week = 0;
    let dow = firstDow;
    for (const cell of data) {
      if (week >= weeks) break;
      grid[dow][week] = cell;
      dow += 1;
      if (dow >= 7) {
        dow = 0;
        week += 1;
      }
    }
  }

  return (
    <Sheet open={!!openDate} onOpenChange={(o) => !o && setOpenDate(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Revisions activity
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Last {weeks} weeks
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <Calendar className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex gap-1.5">
            <div className="flex flex-col gap-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {DAY_LABELS.map((d) => (
                <div key={d} className="flex h-3.5 items-center leading-3">
                  {d}
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: weeks }).map((_, weekIdx) => (
                <div key={weekIdx} className="flex flex-col gap-1.5">
                  {grid.map((row, dayIdx) => {
                    const cell = row[weekIdx];
                    if (!cell) return <div key={dayIdx} className="size-3.5" />;
                    const i = intensity(cell.count);
                    return (
                      <button
                        key={cell.date}
                        type="button"
                        onClick={() => setOpenDate(cell.date)}
                        title={`${cell.date} — ${cell.count} ${cell.count === 1 ? 'revision' : 'revisions'}`}
                        className={cn(
                          'size-3.5 rounded-sm transition-transform',
                          cell.count === 0
                            ? 'bg-muted'
                            : 'bg-gradient-to-br from-brand-indigo to-brand-navy hover:scale-125',
                        )}
                        style={cell.count === 0 ? undefined : { opacity: 0.3 + i * 0.7 }}
                        aria-label={`${cell.date}: ${cell.count} revisions`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {total} revisions · max {max}/day
          </p>
        </CardContent>
      </Card>
      {openDate && (
        <PFilesDrillSheet
          target="revisions-on-day"
          segment={openDate}
          ayCode={ayCode}
          initialScope="ay"
        />
      )}
    </Sheet>
  );
}
