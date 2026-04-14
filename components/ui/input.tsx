import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base
          'flex h-10 w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-foreground shadow-input transition-all',
          // File inputs
          'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          // Placeholder
          'placeholder:text-ink-5',
          // Hover (on non-disabled)
          'hover:border-hairline-strong',
          // Focus — crafted brand indigo ring (matches login)
          'focus-visible:border-brand-indigo focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-indigo/15',
          // Invalid (aria-invalid / error state)
          'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive/15',
          // Disabled
          'disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-70',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
