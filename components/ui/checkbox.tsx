'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-4 shrink-0 rounded border border-hairline bg-background shadow-input transition-all',
      'hover:border-hairline-strong data-[state=unchecked]:hover:border-hairline-strong',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/20 focus-visible:border-brand-indigo/60',
      'data-[state=checked]:border-transparent data-[state=checked]:bg-gradient-to-br data-[state=checked]:from-brand-indigo data-[state=checked]:to-brand-navy data-[state=checked]:text-white data-[state=checked]:shadow-brand-tile',
      'data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-gradient-to-br data-[state=indeterminate]:from-brand-indigo data-[state=indeterminate]:to-brand-navy data-[state=indeterminate]:text-white data-[state=indeterminate]:shadow-brand-tile',
      'disabled:cursor-not-allowed disabled:opacity-60',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className={cn('flex items-center justify-center text-current')}
    >
      <Check className="size-3.5 [[data-state=indeterminate]_&]:hidden" />
      <Minus className="hidden size-3.5 [[data-state=indeterminate]_&]:block" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
