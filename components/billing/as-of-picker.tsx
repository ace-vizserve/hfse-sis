'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';

// A report's "As of" date, kept in the address (`?asOf=`) so a refresh or a
// shared link shows the same report.
export function AsOfPicker({ asOf }: { asOf: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="as-of" className="text-xs text-muted-foreground">
          As of
        </Label>
        <DatePicker
          id="as-of"
          value={asOf}
          allowClear={false}
          onChange={(v) => {
            if (!v) return;
            const next = new URLSearchParams(params.toString());
            next.set('asOf', v);
            start(() => router.push(`${pathname}?${next.toString()}`));
          }}
          className="w-40"
        />
      </div>
      {pending && (
        <Loader2
          className="mb-2.5 size-4 animate-spin text-muted-foreground"
          aria-label="Reading QuickBooks"
        />
      )}
    </div>
  );
}
