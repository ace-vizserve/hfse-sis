'use client';

import { useId } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Date Administered cell. Accepts a real date (via DatePicker) OR the literal
 * "Ongoing" (HFSE's Excel uses both; see KD #105). A single "Ongoing"
 * checkbox toggles between the two — checking it disables the date picker
 * (its value is discarded, matching the prior "Clear ongoing — pick a date
 * instead" behaviour); unchecking clears back to no value so a real date can
 * be picked.
 *
 * Value contract: `'' | 'Ongoing' | 'YYYY-MM-DD'`.
 */
export function DateAdministeredField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const id = useId();
  const isOngoing = value === 'Ongoing';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DatePicker
        value={isOngoing ? '' : value}
        onChange={onChange}
        placeholder="Pick a date"
        disabled={isOngoing}
        className="h-8 w-auto shrink-0 text-[12px]"
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <Checkbox
          id={id}
          checked={isOngoing}
          onCheckedChange={(checked) => onChange(checked ? 'Ongoing' : '')}
        />
        <Label
          htmlFor={id}
          className={cn(
            'cursor-pointer select-none text-[11px] font-medium',
            isOngoing ? 'text-brand-amber' : 'text-muted-foreground'
          )}
        >
          Ongoing
        </Label>
      </div>
    </div>
  );
}
