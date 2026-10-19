'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type TermSelectOption = { termNumber: number; label: string };

/**
 * Picks which term of the viewed academic year a Markbook page is about.
 * Writes `?term=<number>` and keeps every other query param. The options
 * must come from the viewed year, so a term can never belong to another one.
 */
export function TermSelect({
  terms,
  selectedTerm,
  className = 'w-40',
}: {
  terms: readonly TermSelectOption[];
  selectedTerm: number;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('term', value);
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <Select value={String(selectedTerm)} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label="Term">
        <div className="flex items-center gap-2">
          {pending ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-hidden
            />
          ) : (
            <CalendarDays
              className="size-4 text-muted-foreground"
              aria-hidden
            />
          )}
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {terms.map((t) => (
          <SelectItem key={t.termNumber} value={String(t.termNumber)}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
