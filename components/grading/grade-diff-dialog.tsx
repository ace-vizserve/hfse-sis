'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

export type AlertComparison = {
  term_label: string;
  term_number: number;
  prior_grade: number;
  /** currentGrade - prior_grade */
  diff: number;
  flagged: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentName: string;
  currentTermLabel: string;
  currentGrade: number;
  comparisons: AlertComparison[];
};

export function GradeDiffDialog({
  open,
  onOpenChange,
  studentName,
  currentTermLabel,
  currentGrade,
  comparisons,
}: Props) {
  const flaggedCount = comparisons.filter((c) => c.flagged).length;
  // Comparison history reads top-to-bottom in term order (T1 → current),
  // so the pinned current-term header above is clearly not part of the list.
  const history = [...comparisons].sort(
    (a, b) => a.term_number - b.term_number
  );
  const priorCount = history.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Grade change analysis</DialogTitle>
          <DialogDescription className="truncate">
            {studentName}
          </DialogDescription>
        </DialogHeader>

        {/* Pinned current term — the subject of the analysis. Kept calm
            (same weight as the comparison cards); it's set apart by the
            "Current term" label + the "Comparison history" divider below,
            not by louder color. */}
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Current term
              </p>
              <p className="mt-0.5 truncate font-serif text-lg font-semibold tracking-tight text-foreground">
                {currentTermLabel}
              </p>
            </div>
            <p className="shrink-0 font-serif text-3xl font-semibold leading-none tabular-nums text-foreground">
              {currentGrade}
            </p>
          </div>
        </div>

        {/* Comparison history — all prior terms, in order, vs the current term. */}
        <div className="space-y-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Comparison history
            {priorCount > 0 && (
              <span className="ml-1.5 font-sans normal-case tracking-normal text-muted-foreground/80">
                · change from each prior term to {currentTermLabel}
              </span>
            )}
          </p>

          {priorCount === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No earlier terms to compare yet.
            </p>
          ) : (
            <ScrollArea className="max-h-[48vh]">
              <div className="space-y-2 pr-4">
                {history.map((c) => {
                  const absDiff = Math.abs(c.diff);
                  const signedDiff =
                    c.diff > 0
                      ? `+${absDiff}`
                      : c.diff < 0
                        ? `−${absDiff}`
                        : '0';
                  const isUp = c.diff > 0;
                  const isDown = c.diff < 0;

                  return (
                    <div
                      key={c.term_number}
                      className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${
                        c.flagged
                          ? 'border-brand-amber/40 bg-brand-amber/5'
                          : 'border-border bg-background'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {c.term_label}
                        </p>
                        <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                          {c.prior_grade}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 font-mono text-sm font-semibold tabular-nums ${
                            c.flagged
                              ? 'text-foreground'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {isUp ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : isDown ? (
                            <TrendingDown className="h-3.5 w-3.5" />
                          ) : (
                            <Minus className="h-3.5 w-3.5" />
                          )}
                          {signedDiff}
                        </span>
                        {c.flagged ? (
                          <Badge
                            variant="warning"
                            className="gap-1 px-1.5 py-0 font-mono text-[9px] font-semibold uppercase tracking-wider"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Significant
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="gap-1 px-1.5 py-0 font-mono text-[9px] font-semibold uppercase tracking-wider"
                          >
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            Within range
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        <p className="border-t border-border pt-3 text-sm text-muted-foreground">
          {flaggedCount === 0
            ? 'No significant grade changes detected (threshold ±5).'
            : flaggedCount === 1
              ? '1 significant change detected (threshold ±5).'
              : `${flaggedCount} significant changes detected (threshold ±5).`}
        </p>
      </DialogContent>
    </Dialog>
  );
}
