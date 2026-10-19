import type { ReactNode } from 'react';

// A Billing page's head in the SIS layout — the canonical hero header
// (09a §8): mono eyebrow, serif headline with its full stop, the page's
// one-line description, and the page's actions on the right. Billing takes
// what each page CONTAINS from QuickBooks; how it LOOKS is always the SIS's.

export type Crumb = { label: string; href?: string };

export function BillingPageHeader({
  crumbs,
  title,
  description,
  actions,
  stackActions = false,
  children,
}: {
  /** Shown as the eyebrow ("Billing · Invoices"). */
  crumbs?: Crumb[];
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Put the actions in one row under the description — for a page with
   *  more actions than fit beside the title. */
  stackActions?: boolean;
  /** Anything under the description (rare). */
  children?: ReactNode;
}) {
  const eyebrow = ['Billing', ...(crumbs ?? []).map((c) => c.label)]
    .filter((l, i, a) => a.indexOf(l) === i)
    .slice(0, 2)
    .join(' · ');
  return (
    <header
      className={
        stackActions
          ? 'flex flex-col gap-5'
          : 'flex flex-col gap-5 md:flex-row md:items-end md:justify-between'
      }
    >
      <div className="min-w-0 flex-1 space-y-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="font-serif text-[38px] font-semibold leading-[1.05] tracking-tight text-foreground md:text-[44px]">
          {title}.
        </h1>
        {description && (
          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        {children}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:flex-nowrap">
          {actions}
        </div>
      )}
    </header>
  );
}
