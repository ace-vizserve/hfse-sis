'use client';

import { useRouter } from 'next/navigation';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CalendarRange } from 'lucide-react';

// Lightweight AY switcher for /sis/admin/subjects. Uses a plain ?ay= query
// string so the page stays a server component.
export function SubjectAySwitcher({
  current,
  options,
  levelType,
}: {
  current: string;
  options: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
  /** The page's current `?level=` selection — threaded through so an AY
   * switch preserves it. Without this, switching AY while viewing
   * Secondary silently bounced the user back to the page's Primary
   * default (the page's own `levelHref` helper preserves `?ay=` on a
   * level switch; this is the reverse direction). */
  levelType: 'primary' | 'secondary';
}) {
  const router = useRouter();

  function onChange(next: string) {
    if (next === current) return;
    router.push(
      `/sis/admin/subjects?ay=${encodeURIComponent(next)}&level=${encodeURIComponent(levelType)}`
    );
    // Same route + changed ?ay= → force the RSC to re-fetch the subject-config
    // matrix for the new AY (the client Router Cache would otherwise replay the
    // prior AY's matrix until a hard reload).
    router.refresh();
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="h-10 w-full">
        <SelectValue placeholder="Pick AY" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.ayCode} value={o.ayCode} className="text-xs">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-4 text-muted-foreground" />
              {o.ayCode}
              {o.isCurrent && (
                <span className="ml-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  current
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
