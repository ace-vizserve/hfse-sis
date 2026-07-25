import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import type { QuickAction } from '@/lib/home/quick-actions';

export function QuickActionsRow({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mb-6 flex flex-wrap gap-5 border-b border-border pb-3.5">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="flex items-center gap-1 text-sm font-semibold text-brand-indigo hover:underline"
        >
          {action.label}
          <ArrowUpRight className="size-3.5" />
        </Link>
      ))}
    </div>
  );
}
