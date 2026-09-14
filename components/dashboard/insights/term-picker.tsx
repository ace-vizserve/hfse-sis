'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

export type TermOption = {
  termNumber: 1 | 2 | 3 | 4;
  /** Shown under the label so a term reads as a real slice of the year. */
  from: string;
  to: string;
};

/**
 * Which term an Insights page is reporting on.
 *
 * WHY A TERM AND NOT A DATE RANGE. Attendance is term-scoped: the marks carry
 * a `term_id`, the rollups are per term, and the comparison this page exists
 * for is "this term against the same term last year". A date range could
 * express that, and the page used to work that way — it resolved a range, then
 * tried to recover which term it was by string-matching the window against
 * each term's start and end:
 *
 *     .find(([, w]) => w && w.from === rangeInput.from && w.to === rangeInput.to)
 *
 * When that match failed — which is precisely when somebody used the freedom a
 * date picker is for — the comparison fell back to the whole of the other
 * academic year, and still called itself a comparison. Naming the term makes
 * the alignment exact and that failure mode impossible.
 *
 * ⚠ Sits beside <CompareAyPicker> and deliberately mirrors it: same Select,
 * same trigger, same "Label: value" shape. The two read as one pair — what am I
 * looking at, and what am I comparing it to.
 */
export function TermPicker({
  terms,
  selectedTerm,
}: {
  /** Only terms whose dates are actually set in this AY. */
  terms: readonly TermOption[];
  selectedTerm: 1 | 2 | 3 | 4;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('term', value);
    // The old range params would otherwise sit in the URL contradicting the
    // term that is now in charge.
    params.delete('from');
    params.delete('to');
    params.delete('preset');
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <Select value={String(selectedTerm)} onValueChange={handleChange}>
      <SelectTrigger
        className="h-9 w-auto min-w-[9rem] border-border bg-card font-normal"
        aria-label="Term"
      >
        {isPending ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            <span className="font-mono text-[12px]">Loading…</span>
          </span>
        ) : (
          <span className="font-mono text-[12px]">
            Term: <span className="text-foreground">{selectedTerm}</span>
          </span>
        )}
      </SelectTrigger>
      <SelectContent>
        {terms.map((t) => (
          <SelectItem key={t.termNumber} value={String(t.termNumber)}>
            <span className="font-mono">Term {t.termNumber}</span>
            <span className="ml-2 text-[11px] text-muted-foreground">
              {formatWindow(t.from, t.to)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function formatWindow(from: string, to: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-SG', {
      day: 'numeric',
      month: 'short',
    });
  return `${fmt(from)} – ${fmt(to)}`;
}
