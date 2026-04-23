import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Canonical empty-state lockup for the Records module — icon tile + serif title
// + body + optional CTA. Per docs/context/09a-design-patterns.md §7.6:
// "Empty states are never blank."
//
// Renders as a centered, bordered placeholder. Use inside a TableCell colSpan
// for empty data tables, or as a Card child for empty tab sections.
export function SisEmptyState({
  icon: Icon,
  title,
  body,
  cta,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  cta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-hairline bg-muted/30 p-10 text-center',
        className ?? '',
      ].join(' ').trim()}
    >
      <div className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="font-serif text-base font-semibold text-foreground">{title}</p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
      {cta && <div className="pt-1">{cta}</div>}
    </div>
  );
}
