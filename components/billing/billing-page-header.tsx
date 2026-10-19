import Link from 'next/link';
import type { ReactNode } from 'react';

// A Billing page's head, laid out as QuickBooks lays its pages out: a small
// breadcrumb ("Sales / Invoices"), the page title, and the page's buttons on
// the right (secondary first, the primary — often a split "New …" button —
// last). The SIS look stays: serif title, SIS buttons and tokens.

export type Crumb = { label: string; href?: string };

export function BillingPageHeader({
  crumbs,
  title,
  actions,
  children,
}: {
  crumbs?: Crumb[];
  title: string;
  /** Right-hand buttons, as QuickBooks places them. */
  actions?: ReactNode;
  /** Anything QuickBooks shows under the title (tabs, a notice). */
  children?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      {crumbs && crumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground"
        >
          {crumbs.map((c, i) => (
            <span key={c.label} className="inline-flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              {c.href ? (
                <Link href={c.href} className="hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-[30px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </header>
  );
}
