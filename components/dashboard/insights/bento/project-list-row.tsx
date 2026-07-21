import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { SOFT_BADGE_CLASS, TILE_GRADIENT, type ColorKey } from './tokens';

/**
 * "Project List" anatomy — icon tile + name + subtitle line, the simplest
 * list row in this library. Matches `.pl2-*` in insights-mockup-records.html
 * ("Late enrollees by level" — the subtitle carries a fraction like "9 late
 * / 168 enrolled" as plain text rather than a separate bar/value column).
 *
 * `value` is an additive escape hatch beyond that base "no trailing value"
 * anatomy — insights-mockup-markbook.html reuses this exact row shape for
 * "Which levels are struggling?" but DOES print a trailing number
 * (`.pl2-val`, e.g. "72.4"). Omit it to get the literal base anatomy;
 * pass it to cover that second real usage without a near-duplicate component.
 *
 * `badge` is a second additive escape hatch (Attendance Insights, KD #142
 * bento rebuild) — insights-mockup-v4.html's "Leave-quota risk" list pairs a
 * trailing value with a status pill (`.rk-right` = `.rk-val` + `.pill`, e.g.
 * "5/5" + "Over"). Renders beside `value` using the same soft-badge tone as
 * every other pill in this library. Omit for the base anatomy.
 *
 * `name` accepts a ReactNode (not just a string) so a row's identifier can
 * stay a real `next/link` (KD #81 linkification) rather than flattening to
 * plain text — a real behaviour the base anatomy's string-only type would
 * otherwise force callers to drop.
 *
 * Renders a single row, not a list — callers map an array of items inside a
 * `<BentoCard>`; the `first:border-t-0` rule assumes this is the first DOM
 * child when it's the first row of the mapped list.
 */

export type ProjectListRowProps = {
  icon: LucideIcon;
  iconGradient: ColorKey;
  name: React.ReactNode;
  subtitle: string;
  value?: string;
  badge?: { text: string; colorKey: ColorKey };
  className?: string;
};

export function ProjectListRow({
  icon: Icon,
  iconGradient,
  name,
  subtitle,
  value,
  badge,
  className,
}: ProjectListRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 border-t border-hairline py-3 first:border-t-0 first:pt-1',
        className
      )}
    >
      <div
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-[10px]',
          TILE_GRADIENT[iconGradient]
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-foreground">
          {name}
        </div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {subtitle}
        </div>
      </div>
      {(value || badge) && (
        <span className="flex shrink-0 items-center gap-2">
          {value && (
            <span className="font-mono text-[13px] font-bold text-foreground">
              {value}
            </span>
          )}
          {badge && (
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-extrabold',
                SOFT_BADGE_CLASS[badge.colorKey]
              )}
            >
              {badge.text}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
