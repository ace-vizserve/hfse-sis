import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[84px] w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-foreground shadow-input transition-all',
        'placeholder:text-ink-5',
        'hover:border-hairline-strong',
        'focus-visible:border-brand-indigo/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-indigo/20 focus-visible:shadow-sm',
        'aria-[invalid=true]:border-destructive/60 aria-[invalid=true]:focus-visible:ring-2 aria-[invalid=true]:focus-visible:ring-destructive/30',
        'disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
