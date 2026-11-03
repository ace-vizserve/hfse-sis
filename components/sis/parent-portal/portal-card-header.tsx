import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// The titled card header every SIS Admin page uses: mono eyebrow, serif title,
// gradient icon tile beside it. Same shape as the Staff "Directory" card.
export function PortalCardHeader({
  eyebrow,
  title,
  icon: Icon,
  action,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  icon: LucideIcon;
  /** The card's control, top right: a year picker or a button. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <CardHeader className={className}>
      <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
        {eyebrow}
      </CardDescription>
      <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
            <Icon className="size-4" />
          </span>
          {title}
        </span>
      </CardTitle>
      {action && <CardAction>{action}</CardAction>}
    </CardHeader>
  );
}
