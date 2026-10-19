import type { ReactNode } from 'react';

// One block of a Billing form sheet, the way SIS form sheets group their
// fields (Records → Edit profile): a mono indigo label, an optional aside on
// the right of it (a count, a search box), then the fields. Sheets stack
// these with `space-y-8`.

export function SheetSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-indigo-deep">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The two-column field grid inside a section. */
export function SheetFields({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
  );
}
