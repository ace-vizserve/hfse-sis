'use client';

import { type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type BulkAction<TRow> = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onTrigger: (selectedRows: TRow[]) => void | Promise<void>;
  destructive?: boolean;
};

type BulkActionFooterProps<TRow> = {
  selectedRows: TRow[];
  actions: Array<BulkAction<TRow>>;
  onClear: () => void;
  className?: string;
};

export function BulkActionFooter<TRow>({
  selectedRows,
  actions,
  onClear,
  className,
}: BulkActionFooterProps<TRow>) {
  // `onTrigger` has always been allowed to return a promise (see the type
  // above) and was never awaited, so a slow bulk action gave no sign it was
  // running and could be fired again by a second click. Today's three consumers
  // are all synchronous — they open a dialog that carries its own feedback — so
  // this is a double-click guard and cover for the first async one, not a fix
  // for something currently broken.
  const [runningKey, setRunningKey] = React.useState<string | null>(null);

  // The footer unmounts the moment the selection empties, which an action that
  // clears on success will do while its promise is still settling.
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function trigger(action: BulkAction<TRow>) {
    if (runningKey) return;
    setRunningKey(action.key);
    try {
      await action.onTrigger(selectedRows);
    } catch (err) {
      // An action is expected to report its own failure — `useWriteAction`
      // never rejects, so getting here means one didn't. Swallowing it would
      // leave a failure looking like a success, so it goes to the console
      // rather than nowhere. The footer can't word the toast itself; only the
      // action knows what it was doing.
      console.error(`Bulk action "${action.key}" failed`, err);
    } finally {
      if (mountedRef.current) setRunningKey(null);
    }
  }

  if (selectedRows.length === 0) return null;
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        className
      )}
      role="region"
      aria-label="Bulk actions"
    >
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground">
          {selectedRows.length} selected
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onClear}
          // Clearing empties the selection, which unmounts this footer and
          // takes the running action's only progress indicator with it.
          disabled={runningKey !== null}
        >
          Clear
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const isRunning = runningKey === action.key;
          return (
            <Button
              key={action.key}
              size="sm"
              variant={action.destructive ? 'destructive' : 'default'}
              onClick={() => void trigger(action)}
              // The spinner replaces the icon in place; the label is left
              // alone because only the action knows its own present tense
              // ("Send reminders" → "Sending…" can't be derived here).
              loading={isRunning}
              disabled={runningKey !== null && !isRunning}
              className="h-8"
            >
              {Icon && !isRunning && <Icon className="mr-1 h-3.5 w-3.5" />}
              {action.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
