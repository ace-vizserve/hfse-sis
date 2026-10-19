'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';

// The period of the bank register (QuickBooks' Date filter): From and To live
// in the address, so a refresh or a shared link opens the same register.

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
      <Field className="w-40 gap-1.5">
        <FieldLabel htmlFor="bank-from">From</FieldLabel>
        <DatePicker
          id="bank-from"
          value={from}
          onChange={(v) => set('from', v)}
        />
      </Field>
      <Field className="w-40 gap-1.5">
        <FieldLabel htmlFor="bank-to">To</FieldLabel>
        <DatePicker id="bank-to" value={to} onChange={(v) => set('to', v)} />
      </Field>
      {pending && (
        <Loader2
          className="mb-3 size-4 animate-spin text-muted-foreground"
          aria-label="Reading QuickBooks"
        />
      )}
    </div>
  );
}
