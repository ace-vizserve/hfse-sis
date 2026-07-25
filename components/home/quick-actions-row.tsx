import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { QuickAction } from '@/lib/home/quick-actions';

export function QuickActionsRow({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action, index) => (
        // Exactly one primary CTA per role (§9.2) — the first action is
        // already the role's top-priority link in lib/home/quick-actions.ts,
        // so it alone carries the gradient; the rest are secondary
        // navigation triggers (outline).
        <Button
          key={action.href}
          variant={index === 0 ? 'default' : 'outline'}
          asChild
        >
          <Link href={action.href}>
            {action.label}
            <ArrowUpRight />
          </Link>
        </Button>
      ))}
    </div>
  );
}
