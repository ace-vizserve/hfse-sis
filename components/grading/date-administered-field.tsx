'use client';

import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';

/**
 * Date Administered cell. Accepts a real date (via DatePicker) OR the literal
 * "Ongoing" (HFSE's Excel uses both; see KD #105). When "Ongoing", shows an
 * amber pill + clear button; otherwise shows the picker plus an "Ongoing"
 * quick-set button.
 *
 * Value contract: `'' | 'Ongoing' | 'YYYY-MM-DD'`.
 */
export function DateAdministeredField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  if (value === 'Ongoing') {
    return (
      <div className="flex items-center gap-1">
        <span className="inline-flex items-center rounded-md border border-brand-amber/30 bg-brand-amber/10 px-2 py-1 font-mono text-[11px] font-semibold text-brand-amber">
          Ongoing
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground"
          aria-label="Clear ongoing — pick a date instead"
          onClick={() => onChange('')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <DatePicker
        value={value}
        onChange={onChange}
        placeholder="Pick a date"
        className="h-8"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 px-2 text-[11px] text-muted-foreground"
        aria-label="Mark as ongoing"
        onClick={() => onChange('Ongoing')}
      >
        Ongoing
      </Button>
    </div>
  );
}
