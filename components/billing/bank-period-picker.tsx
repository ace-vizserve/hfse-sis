'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// The Bank Register's two address-bar controls: which bank account (QuickBooks'
// account dropdown, top left) and the period of its transactions (the From /
// To dates inside the filter). Both live in the address, so a refresh or a
// shared link opens the same register.

function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const go = (edit: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    edit(next);
    start(() => router.push(`${pathname}?${next.toString()}`));
  };
  return { go, pending };
}

export function BankAccountSelect({
  accounts,
  value,
}: {
  accounts: Array<{ id: string; name: string }>;
  value: string;
}) {
  const { go, pending } = useSetParams();
  return (
    <div className="flex items-center gap-2">
      <Select
        value={value}
        onValueChange={(v) => go((p) => p.set('account', v))}
      >
        <SelectTrigger className="h-9 w-64" aria-label="Bank account">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {pending && (
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-label="Reading QuickBooks"
        />
      )}
    </div>
  );
}

export function BankPeriodPicker({ from, to }: { from: string; to: string }) {
  const { go, pending } = useSetParams();

  const set = (key: 'from' | 'to', value: string) => {
    if (!value) return;
    go((next) => {
      next.set(key, value);
      // Keep the period the right way round.
      const f = next.get('from') ?? from;
      const t = next.get('to') ?? to;
      if (f > t) next.set(key === 'from' ? 'to' : 'from', value);
    });
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
