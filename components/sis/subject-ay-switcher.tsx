"use client";

import { useRouter } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Lightweight AY switcher for /sis/admin/subjects. Uses a plain ?ay= query
// string so the page stays a server component.
export function SubjectAySwitcher({
  current,
  options,
}: {
  current: string;
  options: Array<{ ayCode: string; label: string; isCurrent: boolean }>;
}) {
  const router = useRouter();

  function onChange(next: string) {
    if (next === current) return;
    router.push(`/sis/admin/subjects?ay=${encodeURIComponent(next)}`);
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="h-7 w-[160px] text-xs">
        <SelectValue placeholder="Pick AY" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.ayCode} value={o.ayCode} className="text-xs">
            {o.ayCode}
            {o.isCurrent && (
              <span className="ml-2 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                current
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
