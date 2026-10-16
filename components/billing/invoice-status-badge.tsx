import { Badge } from '@/components/ui/badge';
import { INVOICE_STATUS_LABEL, type InvoiceStatus } from '@/lib/billing/view';
import { cn } from '@/lib/utils';

// §9.3 recipes: mint = paid, destructive = overdue / voided, amber = part
// paid, secondary = open (informational).
const TONE: Record<Exclude<InvoiceStatus, 'open'>, string> = {
  paid: 'border-brand-mint bg-brand-mint/30 text-ink',
  overdue: 'border-destructive/40 bg-destructive/10 text-destructive',
  voided:
    'border-destructive/40 bg-destructive/10 text-destructive line-through',
  part: 'border-brand-amber/40 bg-brand-amber/10 text-ink',
};

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: InvoiceStatus;
  className?: string;
}) {
  if (status === 'open')
    return (
      <Badge variant="secondary" className={cn('h-6', className)}>
        {INVOICE_STATUS_LABEL.open}
      </Badge>
    );
  return (
    <Badge variant="outline" className={cn('h-6', TONE[status], className)}>
      {INVOICE_STATUS_LABEL[status]}
    </Badge>
  );
}
