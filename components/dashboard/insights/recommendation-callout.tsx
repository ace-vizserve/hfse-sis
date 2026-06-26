import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Compact inline annotation strip for dashboard insights.
 *
 * Surfaces a single "what this means / do this" sentence with a left-border
 * accent stripe + icon as dual non-colour-only signal channels (§9.3).
 *
 * Tones follow §9.1 semantic palette:
 *   positive → brand-mint (healthy/open)
 *   watch    → brand-amber (informational/attention)
 *   act      → destructive (blocked/required action)
 *
 * Token note: icon for `positive` uses text-foreground (not text-brand-mint,
 * which §3.1 reserves for positive status on *dark* surfaces). The mint border
 * + background wash carry the colour signal; the CheckCircle2 icon shape
 * provides the semantic channel.
 */

type Tone = 'positive' | 'watch' | 'act';

const DEFAULT_ICONS: Record<Tone, LucideIcon> = {
  positive: CheckCircle2,
  watch: AlertTriangle,
  act: ArrowRight,
};

const TONE_CLASSES: Record<Tone, { container: string; icon: string }> = {
  positive: {
    container: 'border-l-2 border-l-brand-mint bg-brand-mint/15 text-ink',
    icon: 'text-foreground',
  },
  watch: {
    container: 'border-l-2 border-l-brand-amber bg-brand-amber/15 text-ink',
    icon: 'text-brand-amber',
  },
  act: {
    container:
      'border-l-2 border-l-destructive bg-destructive/10 text-destructive',
    icon: 'text-destructive',
  },
};

export function RecommendationCallout({
  tone,
  icon: IconProp,
  children,
  className,
}: {
  tone: Tone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  const Icon = IconProp ?? DEFAULT_ICONS[tone];
  const { container, icon } = TONE_CLASSES[tone];

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-r-md px-3 py-2',
        container,
        className
      )}
    >
      <Icon aria-hidden className={cn('h-4 w-4 shrink-0', icon)} />
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}
