import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * 12-column bento grid + card, the shared shell for every module's
 * `/insights` page (Attendance/Admissions/Records/Markbook — see
 * docs/superpowers/plans/2026-07-22-insights-bento-redesign.md). Mirrors the
 * `.bento`/`.card`/`.c-N` classes shared verbatim across all four locked
 * mockups (insights-mockup-{v4,admissions,records,markbook}.html).
 *
 * `BentoCard` is intentionally a plain div, not a re-export of the shadcn
 * `Card` — the bento anatomy is more compact (single padded surface, no
 * header/content/footer slots) and every locked mockup renders it that way.
 */

// Tailwind needs literal class strings to statically discover them — a
// template-literal `md:col-span-${span}` would not reliably survive the
// production build's class scan.
const SPAN_CLASSES: Record<BentoSpan, string> = {
  1: 'md:col-span-1',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
  5: 'md:col-span-5',
  6: 'md:col-span-6',
  7: 'md:col-span-7',
  8: 'md:col-span-8',
  9: 'md:col-span-9',
  10: 'md:col-span-10',
  11: 'md:col-span-11',
  12: 'md:col-span-12',
};

export type BentoSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type BentoGridProps = {
  children: React.ReactNode;
  className?: string;
};

export function BentoGrid({ children, className }: BentoGridProps) {
  return (
    <div className={cn('grid grid-cols-12 gap-4', className)}>{children}</div>
  );
}

export type BentoCardProps = {
  /** Column span at the `md` breakpoint and up (1-12). Every card is full-width below `md`, matching the mockups' `max-width: 980px` collapse rule. */
  span: BentoSpan;
  children: React.ReactNode;
  className?: string;
};

export function BentoCard({ span, children, className }: BentoCardProps) {
  return (
    <div
      className={cn(
        // 18px radius + a soft, barely-there shadow are load-bearing for the
        // "floating card" read every locked mockup has — the design-system
        // token scale tops out at rounded-xl (10px, --radius-xl), well short
        // of it, so this is an arbitrary value rather than a token (no color
        // involved, so Hard Rule #7 doesn't apply to it). shadow-xs is the
        // closest existing token to the mockups' bespoke two-layer recipe.
        'col-span-12 rounded-[18px] border border-hairline bg-card px-6 py-[22px] shadow-xs',
        SPAN_CLASSES[span],
        className
      )}
    >
      {children}
    </div>
  );
}
