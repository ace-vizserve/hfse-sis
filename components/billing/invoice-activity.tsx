import Link from 'next/link';

import { formatDateTime, type ActivityEvent } from '@/lib/billing/activity';
import { cn } from '@/lib/utils';

// QuickBooks-style Invoice activity: a vertical line of events. Done = filled
// indigo, paid = mint, not yet / not available = dashed, voided = destructive.
const DOT: Record<ActivityEvent['tone'], string> = {
  done: 'border-primary bg-primary',
  paid: 'border-brand-mint bg-brand-mint',
  off: 'border-dashed border-border bg-card',
  void: 'border-destructive bg-destructive',
};

export function InvoiceActivity({
  events,
  paymentHref,
}: {
  events: ActivityEvent[];
  /** Where "View payment" goes (the customer page's Payments tab). */
  paymentHref: string;
}) {
  return (
    <ol className="flex flex-col">
      {events.map((e, i) => (
        <li
          key={e.key}
          className="relative grid grid-cols-[18px_1fr] gap-3 pb-5 last:pb-0"
        >
          {i < events.length - 1 && (
            <span
              aria-hidden
              className="absolute bottom-0 left-2 top-5 w-0.5 bg-border"
            />
          )}
          <span
            aria-hidden
            className={cn(
              'mt-0.5 size-[18px] rounded-full border-2',
              DOT[e.tone]
            )}
          />
          <div className="min-w-0">
            <p
              className={cn(
                'text-sm font-semibold text-foreground',
                e.tone === 'off' && 'font-medium text-muted-foreground'
              )}
            >
              {e.label}
            </p>
            {(e.when || e.detail) && (
              <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
                {[e.when ? formatDateTime(e.when) : null, e.detail]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {e.paymentId && (
              <Link
                href={paymentHref}
                className="text-[12px] text-primary underline-offset-4 hover:underline"
              >
                View payment
              </Link>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
