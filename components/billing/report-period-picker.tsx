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
import { REPORT_PERIODS, type ReportPeriod } from '@/lib/billing/report-period';

// QuickBooks' report controls: "Report period" and its "as of" date (or
// From–To for a period report), kept in the address so a refresh or a
// shared link opens the same report. Picking a date makes the period Custom.
export function ReportPeriodPicker({
  kind,
  period,
  asOf,
  from,
  to,
}: {
  kind: 'asOf' | 'range';
  period: ReportPeriod;
  asOf: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const go = (edit: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    edit(next);
    start(() => router.push(`${pathname}?${next.toString()}`));
  };

  const pickPeriod = (v: string) =>
    go((p) => {
      p.set('period', v);
      if (v !== 'custom') ['asOf', 'from', 'to'].forEach((k) => p.delete(k));
      else if (kind === 'asOf') p.set('asOf', asOf);
      else {
        p.set('from', from);
        p.set('to', to);
      }
    });

  const pickDate = (key: 'asOf' | 'from' | 'to', v: string) => {
    if (!v) return;
    go((p) => {
      p.set('period', 'custom');
      if (kind === 'asOf') p.set('asOf', v);
      else {
        let f = key === 'from' ? v : from;
        let t = key === 'to' ? v : to;
        // Keep the period the right way round.
        if (f > t) {
          if (key === 'from') t = v;
          else f = v;
        }
        p.set('from', f);
        p.set('to', t);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label
          htmlFor="report-period"
          className="text-xs text-muted-foreground"
        >
          Report period
        </Label>
        <Select value={period} onValueChange={pickPeriod}>
          <SelectTrigger id="report-period" className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {kind === 'asOf' ? (
        <div className="space-y-1.5">
          <Label
            htmlFor="report-as-of"
            className="text-xs text-muted-foreground"
          >
            as of
          </Label>
          <DatePicker
            id="report-as-of"
            value={asOf}
            allowClear={false}
            onChange={(v) => pickDate('asOf', v)}
            className="w-40"
          />
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label
              htmlFor="report-from"
              className="text-xs text-muted-foreground"
            >
              From
            </Label>
            <DatePicker
              id="report-from"
              value={from}
              allowClear={false}
              onChange={(v) => pickDate('from', v)}
              className="w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="report-to"
              className="text-xs text-muted-foreground"
            >
              To
            </Label>
            <DatePicker
              id="report-to"
              value={to}
              allowClear={false}
              onChange={(v) => pickDate('to', v)}
              className="w-40"
            />
          </div>
        </>
      )}
      {pending && (
        <Loader2
          className="mb-2.5 size-4 animate-spin text-muted-foreground"
          aria-label="Reading QuickBooks"
        />
      )}
    </div>
  );
}
