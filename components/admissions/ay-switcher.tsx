'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { CalendarRange, Loader2 } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function AySwitcher({
  current,
  options,
}: {
  current: string;
  options: readonly string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(code: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('ay', code);
    // Reset the date-range params — they were chosen against the previous
    // AY's calendar and would otherwise carry over into the new AY's view
    // (e.g., switching from AY2025 to AY2027 with a 2025-04 → 2025-06
    // range filter, which then surfaces as wrong-year dates in every
    // drilldown / chart / stat card). The page's resolveRange() falls back
    // to the new AY's default cascade (this term → this AY → last 30 days)
    // on its own.
    next.delete('from');
    next.delete('to');
    next.delete('cmpFrom');
    next.delete('cmpTo');
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <div className="flex items-center gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <CalendarRange className="size-4 text-muted-foreground" />
          )}
          <SelectValue placeholder="Select AY" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 ? (
          <SelectItem value={current} disabled>
            {current}
          </SelectItem>
        ) : (
          options.map((code) => (
            <SelectItem key={code} value={code}>
              {code}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
