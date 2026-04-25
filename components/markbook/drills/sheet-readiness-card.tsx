'use client';

import * as React from 'react';
import { ListTodo } from 'lucide-react';

import { MarkbookDrillSheet } from '@/components/markbook/drills/markbook-drill-sheet';
import { ComparisonBarChart } from '@/components/dashboard/charts/comparison-bar-chart';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import type { SheetRow } from '@/lib/markbook/drill';

/**
 * SheetReadinessCard — horizontal bar chart of open (non-locked) grading sheets
 * per section. Sorts descending so the sections with the largest backlog
 * surface first. Click a bar to drill into that section's open sheets.
 *
 * Data is derived client-side from the pre-fetched `drillRowSets.sheets` —
 * no extra server round-trip needed since the rollup is a single Map walk
 * over a small array (≤ 1,600 sheets at 1000 students × 10 subjects × 4 terms).
 */
export function SheetReadinessCard({
  sheets,
  ayCode,
}: {
  sheets: SheetRow[];
  ayCode: string;
}) {
  const [openSection, setOpenSection] = React.useState<string | null>(null);

  const data = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sheets) {
      if (s.isLocked) continue;
      counts.set(s.sectionName, (counts.get(s.sectionName) ?? 0) + 1);
    }
    const rows = Array.from(counts.entries()).map(([sectionName, count]) => ({
      category: sectionName,
      current: count,
    }));
    rows.sort((a, b) => b.current - a.current);
    return rows;
  }, [sheets]);

  const totalOpen = data.reduce((sum, r) => sum + r.current, 0);
  const empty = data.length === 0;

  return (
    <Sheet open={!!openSection} onOpenChange={(o) => !o && setOpenSection(null)}>
      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Sheet readiness
          </CardDescription>
          <CardTitle className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Open sheets by section
          </CardTitle>
          <CardAction>
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <ListTodo className="size-4" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {empty ? (
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
              <ListTodo className="size-6 text-muted-foreground/60" />
              <p className="text-sm font-medium text-foreground">No open sheets</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Every grading sheet for this AY is locked. Nothing to chase.
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {totalOpen} open · {data.length} {data.length === 1 ? 'section' : 'sections'}
              </p>
              <ComparisonBarChart
                data={data}
                orientation="horizontal"
                height={Math.min(420, Math.max(220, data.length * 26))}
                yFormat="number"
                onSegmentClick={setOpenSection}
              />
            </>
          )}
        </CardContent>
      </Card>
      {openSection && (
        <MarkbookDrillSheet
          target="sheet-readiness-section"
          segment={openSection}
          ayCode={ayCode}
          initialScope="ay"
          initialSheets={sheets}
        />
      )}
    </Sheet>
  );
}
