'use client';

import { useCallback } from 'react';

import { useWriteAction } from '@/lib/hooks/use-write-action';

// A bulk action is the single-row write run once per ticked row, because the
// routes take one record. This reports it the way every other write reports:
// one pending toast, one outcome. Rows that fail are named, and the call only
// FAILS when nothing went through. Reports through `useWriteAction`, so it
// never rejects and the list refreshes before the success text lands.

export type BulkOptions<R> = {
  /** Shown while it runs, e.g. "Approving 3 requests…". */
  pending: string;
  /** What worked, past tense: (n) => `${n} approved`. */
  done: (n: number) => string;
  /** Names a row in the "not done" list. */
  label: (row: R) => string;
  /** The same single-row call the row control makes. */
  one: (row: R) => Promise<unknown>;
  /** Leads the error toast when every row failed, e.g. "Could not approve". */
  failed: string;
};

type Outcome = { ok: number; failed: string[] };

export function useBulkAction() {
  const run = useWriteAction();
  return useCallback(
    <R>(rows: R[], o: BulkOptions<R>) =>
      run<Outcome>(
        async () => {
          let ok = 0;
          const failed: string[] = [];
          let firstError = '';
          for (const row of rows) {
            try {
              await o.one(row);
              ok += 1;
            } catch (e) {
              failed.push(o.label(row));
              if (!firstError && e instanceof Error) firstError = e.message;
            }
          }
          if (ok === 0) {
            throw new Error(
              `${o.failed}${failed.length === 1 ? ` ${failed[0]}` : ` any of the ${failed.length} selected`}. ${firstError}`.trim()
            );
          }
          return { ok, failed };
        },
        {
          pending: o.pending,
          success: (d) =>
            d.failed.length
              ? `${o.done(d.ok)}. Not done: ${d.failed.join(', ')}.`
              : o.done(d.ok),
        }
      ),
    [run]
  );
}
