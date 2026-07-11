import type { LucideIcon } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * HubStat — compact stat tile for the SIS Admin hub's stat band (Task V1,
 * `docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html` Screen
 * 1). Deliberately smaller/denser than `<MetricCard>` (no delta chip, no
 * sparkline, no drill) — this is a status glance, not an analytical KPI.
 * Solid-tint icon tile per the standing no-gradients-on-content rule.
 */

export type HubStatTone = 'brand' | 'sky' | 'mint' | 'amber' | 'muted';

const TONE_CLASS: Record<HubStatTone, string> = {
  brand: 'bg-brand-indigo/10 text-brand-indigo',
  sky: 'bg-brand-sky/15 text-brand-sky',
  mint: 'bg-brand-mint/25 text-ink',
  amber: 'bg-brand-amber/25 text-ink',
  muted: 'bg-muted text-muted-foreground',
};

export function HubStat({
  label,
  value,
  icon: Icon,
  tone = 'brand',
  subtext,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: HubStatTone;
  subtext?: string;
}) {
  return (
    <Card className="flex flex-row items-center gap-3 p-3.5">
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl',
          TONE_CLASS[tone]
        )}
      >
        <Icon className="size-[19px]" />
      </div>
      <div className="min-w-0">
        <p className="font-serif text-[21px] font-semibold leading-tight tabular-nums text-foreground">
          {typeof value === 'number' ? value.toLocaleString('en-SG') : value}
        </p>
        {/* `label` names the metric and always renders — a `subtext` used to
            replace it outright, silently erasing what the number counts
            (e.g. "Awaiting approval" with no "Grade changes waiting"
            anywhere on the tile). `subtext`, when present, is a second,
            smaller muted line underneath rather than folded into one line —
            the tile's fixed p-3.5/gap-3 sizing has room for a two-line
            caption without growing the card, and a dash-joined single line
            reads worse at this width once both label + status are present. */}
        <p className="truncate text-[11.5px] text-muted-foreground">{label}</p>
        {subtext && (
          <p className="truncate text-[10.5px] text-muted-foreground/75">
            {subtext}
          </p>
        )}
      </div>
    </Card>
  );
}
