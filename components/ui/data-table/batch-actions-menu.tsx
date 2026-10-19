'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import type { BulkAction } from './bulk-action-footer';

// QuickBooks-style "Batch actions ▾": the bulk actions as a menu at the start
// of the toolbar, usable once rows are ticked. One action runs at a time; an
// action reports its own result (it is expected to use useWriteAction).
export function BatchActionsMenu<TRow>({
  selectedRows,
  actions,
}: {
  selectedRows: TRow[];
  actions: Array<BulkAction<TRow>>;
}) {
  const [running, setRunning] = React.useState<string | null>(null);
  const none = selectedRows.length === 0;
  async function run(a: BulkAction<TRow>) {
    if (running) return;
    setRunning(a.key);
    try {
      await a.onTrigger(selectedRows);
    } catch (err) {
      console.error(`Batch action "${a.key}" failed`, err);
    } finally {
      setRunning(null);
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={none || !!running}
          loading={!!running}
          title={none ? 'Tick rows to use batch actions' : undefined}
        >
          Batch actions
          {!none && (
            <span className="tabular-nums text-muted-foreground">
              ({selectedRows.length})
            </span>
          )}
          {!running && <ChevronDown className="size-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.key}
            onSelect={() => void run(a)}
            className={cn(a.destructive && 'text-destructive')}
          >
            {a.icon && <a.icon className="size-4" />}
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
