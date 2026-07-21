'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { SOFT_BADGE_CLASS, type ColorKey } from './tokens';

/**
 * Badge-with-tooltip — a pill whose "why" lives in a hover/focus tooltip
 * instead of a permanent stat block, so a card doesn't spend a quarter of
 * its height explaining one row. Matches `.tooltip-wrap`/`.tooltip-box` in
 * insights-mockup-{admissions,markbook}.html ("Biggest leak" / "Biggest
 * drop").
 *
 * Built on the already-installed shadcn `Tooltip` (Radix) rather than a
 * hand-rolled `group-hover` CSS box — design-system Hard Rule #2 prefers an
 * installed primitive over a custom one, and Radix also gets keyboard-focus
 * reveal and correct z-index/portal escape from a card's `overflow-hidden`
 * for free, neither of which a pure-CSS hover box gets easily. The default
 * `TooltipContent` styling (short mono label) is overridden here for a
 * longer sentence-style explanation instead.
 */

export type BadgeTooltipProps = {
  label: string;
  colorKey: ColorKey;
  tooltip: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
};

export function BadgeTooltip({
  label,
  colorKey,
  tooltip,
  side = 'top',
  className,
}: BadgeTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex cursor-default items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-extrabold',
            SOFT_BADGE_CLASS[colorKey],
            className
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-[232px] text-left font-sans text-[11.5px] font-normal leading-relaxed"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
