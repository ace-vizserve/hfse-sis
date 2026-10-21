'use client';

import { ChevronDown, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// A refund receipt's or credit memo's More ▾, item for item as QuickBooks
// has it (Copy, Void, Delete, Transaction journal, Audit history). Each is
// done in QuickBooks, so each opens the document there.
export function SalesDocActions({ qbUrl }: { qbUrl: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          More
          <ChevronDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          In QuickBooks
        </DropdownMenuLabel>
        {[
          'Open in QuickBooks',
          'Copy',
          'Void',
          'Delete',
          'Transaction journal',
          'Audit history',
        ].map((label) => (
          <DropdownMenuItem key={label} asChild>
            <a href={qbUrl} target="_blank" rel="noreferrer">
              {label}
              <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
