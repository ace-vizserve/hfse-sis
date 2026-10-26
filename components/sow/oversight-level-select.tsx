'use client';

import { Layers, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// The oversight page's level, `?level=`. Always set, one level at a time and
// no "All levels" (Mr Ace's rule for a long list); the server reads only the
// level chosen (`loadOversight`).

export function OversightLevelSelect({
  current,
  options,
}: {
  current: string;
  options: { id: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(id: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('level', id);
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-[220px]" aria-label="Level">
        <div className="flex items-center gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Layers className="size-4 text-muted-foreground" />
          )}
          {/* The label as children, so it shows before the list mounts. */}
          <SelectValue placeholder="Level">
            {options.find((l) => l.id === current)?.label}
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent>
        {options.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
