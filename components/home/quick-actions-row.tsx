import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { QuickAction } from '@/lib/home/quick-actions';

export function QuickActionsRow({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {actions.map((action) => (
        <Button key={action.href} asChild>
          <Link href={action.href}>
            {action.label}
            <ArrowUpRight />
          </Link>
        </Button>
      ))}
    </div>
  );
}
