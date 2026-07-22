import * as React from 'react';
import { ArrowDownIcon, ArrowUpIcon, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DELTA_PILL_CLASS, TILE_GRADIENT, type ColorKey } from './tokens';

/**
 * Bento stat card content — gradient icon tile + delta pill, big serif
 * value, muted label, mono date-pill caption. Matches `.stat-top`/`.tile`/
 * `.pill`/`.stat-val`/`.stat-lbl`/`.date-pill` across every locked mockup
 * (e.g. insights-mockup-v4.html's "Attendance rate this period" card).
 *
 * This is content only, not a card shell — callers place it inside a
 * `<BentoCard span={3}>`, matching how the mockups always render 3-4 of
 * these across one bento row.
 *
 * Not click-through — an earlier version made the whole card a button that
 * opened a drill-down sheet, but the drill's underlying row filter didn't
 * always share the same status/scope exclusions as the aggregate powering
 * the number (e.g. "Conversion rate" excludes cancelled/withdrawn from its
 * denominator; the generic drill route didn't). `tooltip` is the honest
 * substitute — it can only restate what the caller already computed for
 * `value`, so it can't silently disagree with what's on screen.
 */

export type StatCardDelta = {
  /** Pre-formatted delta text, e.g. "1.2pp" or "17.2%" — the caller owns rounding/units. */
  value: string;
  direction: 'up' | 'down';
};

export type StatCardProps = {
  icon: LucideIcon;
  iconGradient: ColorKey;
  value: string | number;
  label: string;
  delta?: StatCardDelta;
  /** Mono pill under the label, e.g. "This term" / "AY2026 · n=374". */
  caption?: string;
  /** Optional hover-reveal explaining exactly what's counted (and what isn't), e.g. "Excludes cancelled and withdrawn applications." Rendered on the icon tile. Omit for no tooltip. */
  tooltip?: React.ReactNode;
  className?: string;
};

export function StatCard({
  icon: Icon,
  iconGradient,
  value,
  label,
  delta,
  caption,
  tooltip,
  className,
}: StatCardProps) {
  const DeltaIcon = delta?.direction === 'up' ? ArrowUpIcon : ArrowDownIcon;

  const iconTile = (
    <div
      className={cn(
        'flex size-9 items-center justify-center rounded-xl',
        TILE_GRADIENT[iconGradient]
      )}
    >
      <Icon className="size-4" />
    </div>
  );

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="mb-3 flex items-start justify-between">
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div tabIndex={0} className="outline-hidden">
                {iconTile}
              </div>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-55 text-left font-sans text-[11.5px] font-normal leading-relaxed"
            >
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          iconTile
        )}
        {delta && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-extrabold',
              DELTA_PILL_CLASS[delta.direction]
            )}
          >
            <DeltaIcon className="size-2.5" strokeWidth={3} />
            {delta.value}
          </span>
        )}
      </div>
      <p className="font-serif text-[27px] font-bold leading-none text-foreground">
        {value}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">{label}</p>
      {caption && (
        <span className="mt-3.5 inline-block w-fit rounded-full border border-hairline bg-muted px-2.5 py-1 font-mono text-[10.5px] font-semibold text-muted-foreground">
          {caption}
        </span>
      )}
    </div>
  );
}
