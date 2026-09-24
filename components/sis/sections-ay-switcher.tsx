'use client';

import { useRouter } from 'next/navigation';
import { CalendarRange } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// AY switcher for /sis/sections — the current year plus the upcoming one
// (taking applications), so next year's sections can be set up before that
// year is current. Same ?ay= shape as SubjectAySwitcher; the page stays a
// server component.
export function SectionsAySwitcher({
  current,
  options,
}: {
  current: string;
  options: Array<{ ayCode: string; isCurrent: boolean }>;
}) {
  const router = useRouter();

  function onChange(next: string) {
    if (next === current) return;
    const isCurrent = options.find((o) => o.ayCode === next)?.isCurrent;
    router.push(
      isCurrent
        ? '/sis/sections'
        : `/sis/sections?ay=${encodeURIComponent(next)}`
    );
    // Same route, changed ?ay= — force the RSC to re-fetch rather than replay
    // the prior year from the client Router Cache.
    router.refresh();
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-auto gap-2 bg-card text-xs">
        <SelectValue placeholder="Pick year" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.ayCode} value={o.ayCode} className="text-xs">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 text-muted-foreground" />
              {o.ayCode}
              <span className="text-muted-foreground">
                {o.isCurrent ? 'current' : 'upcoming'}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
