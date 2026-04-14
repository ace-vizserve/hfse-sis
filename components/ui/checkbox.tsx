'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-4 shrink-0 rounded-[4px] border border-hairline bg-white shadow-input transition-all',
      'hover:border-hairline-strong',
      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/20',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=checked]:border-transparent data-[state=checked]:bg-gradient-to-b data-[state=checked]:from-brand-indigo data-[state=checked]:to-brand-indigo-deep data-[state=checked]:text-white data-[state=checked]:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_1px_2px_rgba(15,23,42,0.1)]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3 w-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
