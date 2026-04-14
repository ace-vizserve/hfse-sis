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

type AyOption = { code: string; label: string };

export function AySwitcher({
  current,
  options,
}: {
  current: string;
  options: AyOption[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(code: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('ay', code);
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
          options.map((o) => (
            <SelectItem key={o.code} value={o.code}>
              {o.code} · {o.label}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}
