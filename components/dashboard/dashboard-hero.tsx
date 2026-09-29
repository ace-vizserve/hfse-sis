import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * DashboardHero — canonical hero header per
 * `docs/context/09a-design-patterns.md` §8 "Hero header" pattern.
 *
 * Voice rules (`09-design-system.md` §3.3):
 *   eyebrow:  font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground
 *   headline: font-serif text-[38px] md:text-[44px] tracking-tight text-foreground
 *   body:     text-[15px] leading-relaxed text-muted-foreground
 */

export type HeroBadge = {
  label: string;
  tone?: 'default' | 'mint' | 'amber' | 'muted';
};

export function DashboardHero({
  eyebrow,
  title,
  description,
  badges,
  actions,
  titleMark,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  badges?: HeroBadge[];
  actions?: React.ReactNode;
  /**
   * An identity mark set before the headline — e.g. a house's colour tile on
   * that house's dashboard. Decorative: the title still names the thing.
   */
  titleMark?: React.ReactNode;
}) {
  const heading = (
    <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
      {title}
    </h1>
  );
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div className="space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
        {titleMark ? (
          <div className="flex items-center gap-4">
            {titleMark}
            {heading}
          </div>
        ) : (
          heading
        )}
        {description && (
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {(badges?.length || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {badges?.map((b, i) => (
            <HeroBadgeChip key={i} badge={b} />
          ))}
          {actions}
        </div>
      )}
    </header>
  );
}

/**
 * The hero badge's classes, exported so a clickable badge (the Markbook
 * Insights top-band badge, KD #229) looks exactly like a static one.
 */
export function heroBadgeClassName(
  tone: NonNullable<HeroBadge['tone']>
): string {
  // Mint/amber carry a real semantic ("good"/"watch") — gradient wash, same
  // recipe as MetricCard's delta chip and every other state-bearing tint in
  // the app (KD #84's flat→gradient sweep: no semantic tint is ever flat).
  // Muted is a genuine de-emphasis state (e.g. "Historical", "Building
  // history") and stays flat — same reasoning as bg-muted elsewhere for a
  // true absence/non-signal. Default carries no color signal at all — a
  // light brand wash (matching the scopeNote chip below) reads as
  // "informational" without competing with the semantic tones.
  return cn(
    'h-7 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]',
    tone === 'mint' &&
      'border-brand-mint bg-gradient-to-b from-brand-mint/35 to-brand-mint/15 text-ink',
    tone === 'amber' &&
      'border-brand-amber bg-gradient-to-b from-brand-amber/35 to-brand-amber/15 text-ink',
    tone === 'muted' && 'border-border bg-muted text-muted-foreground',
    tone === 'default' &&
      'border-brand-indigo-soft/50 bg-gradient-to-b from-brand-indigo/12 to-brand-indigo/4 text-brand-indigo-deep'
  );
}

function HeroBadgeChip({ badge }: { badge: HeroBadge }) {
  return (
    <Badge
      variant="outline"
      className={heroBadgeClassName(badge.tone ?? 'default')}
    >
      {badge.label}
    </Badge>
  );
}
