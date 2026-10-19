'use client';

import { Loader2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldLabel } from '@/components/ui/field';
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
      <Field className="w-48 gap-1.5">
        <FieldLabel htmlFor="report-period">Report period</FieldLabel>
        <Select value={period} onValueChange={pickPeriod}>
          <SelectTrigger id="report-period" className="w-full">
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
      </Field>
      {kind === 'asOf' ? (
        <Field className="w-44 gap-1.5">
          <FieldLabel htmlFor="report-as-of">As of</FieldLabel>
          <DatePicker
            id="report-as-of"
            value={asOf}
            allowClear={false}
            onChange={(v) => pickDate('asOf', v)}
          />
        </Field>
      ) : (
        <>
          <Field className="w-44 gap-1.5">
            <FieldLabel htmlFor="report-from">From</FieldLabel>
            <DatePicker
              id="report-from"
              value={from}
              allowClear={false}
              onChange={(v) => pickDate('from', v)}
            />
          </Field>
          <Field className="w-44 gap-1.5">
            <FieldLabel htmlFor="report-to">To</FieldLabel>
            <DatePicker
              id="report-to"
              value={to}
              allowClear={false}
              onChange={(v) => pickDate('to', v)}
            />
          </Field>
        </>
      )}
      {pending && (
        <Loader2
          className="mb-3 size-4 animate-spin text-muted-foreground"
          aria-label="Reading QuickBooks"
        />
      )}
    </div>
  );
}
