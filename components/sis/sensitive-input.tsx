'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// Masked-by-default text input with a per-field reveal toggle — used for
// passport/pass numbers (KD pending: student-profile validation-parity
// design, 2026-07-28). Not a real password field (no autocomplete
// implications intended) — `type="password"` is used purely for its
// visual masking behavior.
export function SensitiveInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <div className="relative">
      <Input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('pr-9', className)}
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
}
