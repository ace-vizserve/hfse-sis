'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Masked-by-default text input with a per-field reveal toggle — used for
// passport/pass numbers (KD pending: student-profile validation-parity
// design, 2026-07-28). `type="password"` is used purely for its visual
// masking behavior, not real credential handling — `autoComplete="new-
// password"` plus the data-*-ignore attributes below tell browsers and
// password managers not to treat these as login fields (Chrome/Safari/
// 1Password otherwise may offer to save, or worse, autofill a stored
// password into a passport-number column).
//
// Forwards `ref` and any extra props (id/aria-describedby/aria-invalid)
// through to the underlying <Input> so this works correctly inside shadcn's
// <FormControl> (a Radix Slot that clones those props onto this component's
// element) — without this, the form label/error message have no way to
// associate with the actual input.
export const SensitiveInput = React.forwardRef<
  HTMLInputElement,
  {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    className?: string;
  } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'value' | 'onChange' | 'type'
  >
>(function SensitiveInput(
  { value, onChange, placeholder, className, ...rest },
  ref
) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
        className={cn('pr-9', className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
        aria-label={revealed ? 'Hide value' : 'Show value'}
      >
        {revealed ? (
          <EyeOff className="size-3.5" />
        ) : (
          <Eye className="size-3.5" />
        )}
      </button>
    </div>
  );
});
