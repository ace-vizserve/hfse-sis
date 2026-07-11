import { cn } from '@/lib/utils';

/**
 * CodeChip — mono uppercase identifier pill for table cells (AY codes,
 * discount codes, and similar short codes). Distinct from `<StatusBadge>`
 * (which carries state/severity, §9.3) — this is a neutral identity chip,
 * so it never changes color for meaning. Shape follows the SIS Admin
 * visual-redesign mockup's `.chip` pill
 * (`docs/superpowers/specs/2026-07-11-sis-admin-visual-redesign.html`).
 *
 * `tone="default"` — the row's primary code (bold, full-strength ink).
 * `tone="muted"` — a secondary tag on the row (e.g. an enrolee-type
 * classifier) that shouldn't compete with the primary code for attention.
 */
export function CodeChip({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'muted';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider',
        tone === 'default'
          ? 'border-border bg-muted text-foreground'
          : 'border-hairline bg-muted/60 text-muted-foreground',
        className
      )}
    >
      {children}
    </span>
  );
}
