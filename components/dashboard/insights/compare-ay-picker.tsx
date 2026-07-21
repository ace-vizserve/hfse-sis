'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { COMPARE_NONE } from '@/lib/dashboard/comparison';

/** Sentinel used for the "no comparison" option. Radix Select forbids empty-string values.
 *  We reuse COMPARE_NONE ('none') so the URL param value is stable. */
const NONE_SENTINEL = COMPARE_NONE;

export type CompareAyPickerProps = {
  /** The AY currently being viewed — excluded from the options list. */
  primaryAy: string;
  /** All available AY codes, newest-first. The primary AY will be filtered out. */
  ayCodes: readonly string[];
  /** The currently selected comparison AY, or null if none. */
  compareAy: string | null;
};

/**
 * Single-select AY comparison picker for Insights pages.
 * Commits immediately on change (no Apply button) and preserves all
 * existing URL search params — including `ay` — while setting/clearing
 * `compareAy`.
 */
export function CompareAyPicker({
  primaryAy,
  ayCodes,
  compareAy,
}: CompareAyPickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const options = ayCodes.filter((code) => code !== primaryAy);

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    // Always set the param (even for None) so the RSC can distinguish
    // "user explicitly turned it off" from "param absent → infer prior".
    params.set('compareAy', value);
    startTransition(() => {
      router.push(`?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <Select value={compareAy ?? NONE_SENTINEL} onValueChange={handleChange}>
      <SelectTrigger
        className="h-9 w-auto min-w-[13rem] border-border bg-card font-normal"
        aria-label="Compare against academic year"
      >
        {isPending ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            <span className="font-mono text-[12px]">Loading…</span>
          </span>
        ) : (
          <span className="font-mono text-[12px]">
            Compare against:{' '}
            <span className="text-foreground">{compareAy ?? 'None'}</span>
          </span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_SENTINEL}>
          <span className="text-muted-foreground">None (no comparison)</span>
        </SelectItem>
        {options.map((code) => (
          <SelectItem key={code} value={code}>
            <span className="font-mono">{code}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
