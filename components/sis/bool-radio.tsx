'use client';

import * as React from 'react';

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

/**
 * Yes / No radio pair on a true / false column — the SIS copy of the parent
 * portal's ConsentField (app-online-admission src/components/private/shared/
 * consent-field.tsx). Nothing is picked until someone answers, so "No" and
 * "never answered" stay apart, exactly as the portal keeps them.
 *
 * Extra props (id, aria-describedby, aria-invalid from shadcn's FormControl)
 * go to the radio group.
 */
export function BoolRadio({
  value,
  onChange,
  ...rest
}: {
  value: boolean | null | undefined;
  onChange: (next: boolean) => void;
} & Omit<
  React.ComponentProps<typeof RadioGroup>,
  'value' | 'onValueChange' | 'onChange' | 'defaultValue'
>) {
  return (
    <RadioGroup
      value={value === true ? 'yes' : value === false ? 'no' : ''}
      onValueChange={(next) => onChange(next === 'yes')}
      className="flex h-9 items-center gap-x-5"
      {...rest}
    >
      {(
        [
          ['yes', 'Yes'],
          ['no', 'No'],
        ] as const
      ).map(([v, label]) => (
        <label
          key={v}
          className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
        >
          <RadioGroupItem value={v} />
          {label}
        </label>
      ))}
    </RadioGroup>
  );
}
