import Link from 'next/link';
import { ChevronDown, UserCog } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { QuickAction } from '@/lib/home/quick-actions';

/**
 * The home header's right-hand side: Account, and the role's quick actions
 * folded into one "More" menu. Both outline — the page has no primary action
 * of its own; the to-do panel below says what to do next.
 *
 * `/` has no sidebar, so Account here is the only route to it from the page
 * every role lands on after signing in.
 */
export function HomeHeaderActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="flex flex-nowrap items-center gap-2">
      <Button variant="outline" asChild>
        <Link href="/account">
          <UserCog />
          Account
        </Link>
      </Button>
      {actions.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              More
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            {actions.map((action) => (
              <DropdownMenuItem key={action.href} asChild>
                <Link href={action.href}>{action.label}</Link>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
