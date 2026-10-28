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

// The Book list page's level, `?level=<code>`. Always set, one level at a
// time and no "All levels" (Mr Ace's rule for a long list); the server reads
// only the level chosen. Changing level drops `?type=`, which belongs to the
// level it was picked on.

export function BookListLevelSelect({
  current,
  options,
}: {
  current: string;
  options: { code: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(code: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set('level', code);
    next.delete('type');
    startTransition(() => {
      router.push(`?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-[220px]" aria-label="Level">
        <div className="flex items-center gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Layers className="size-4 text-muted-foreground" />
          )}
          {/* The label as children, so it shows before the list mounts. */}
          <SelectValue placeholder="Level">
            {options.find((l) => l.code === current)?.label}
          </SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent>
        {options.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
