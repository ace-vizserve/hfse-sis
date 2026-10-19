'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';

// The period of the transactions below: two dates, kept in the address so a
// refresh or a shared link shows the same period.
export function BankPeriodPicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (key: 'from' | 'to', value: string) => {
    if (!value) return;
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    // Keep the period the right way round.
    const f = next.get('from') ?? from;
    const t = next.get('to') ?? to;
    if (f > t) next.set(key === 'from' ? 'to' : 'from', value);
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="bank-from" className="text-xs text-muted-foreground">
          From
        </Label>
        <DatePicker
          id="bank-from"
          value={from}
          onChange={(v) => set('from', v)}
          className="w-40"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bank-to" className="text-xs text-muted-foreground">
          To
        </Label>
        <DatePicker
          id="bank-to"
          value={to}
          onChange={(v) => set('to', v)}
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
