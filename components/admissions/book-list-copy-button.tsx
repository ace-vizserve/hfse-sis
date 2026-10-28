'use client';

import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// "Copy from AY2027" on an empty year of /admissions/book-list (plan
// 2026-10-28-books-supplies-tracker.md, Phase 4). The route refuses a year that
// already has a list, so a second click or a second tab cannot duplicate it.
export function CopyBookListButton({
  fromAy,
  toAy,
}: {
  fromAy: string;
  toAy: string;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; copied: number }>(
        '/api/sis/supplies/copy-year',
        jsonInit('POST', { from: fromAy, to: toAy })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function copy() {
    setBusy(true);
    await run(() => mutation.mutateAsync(), {
      pending: `Copying the ${fromAy} book list into ${toAy}…`,
      success: (data) =>
        `Copied ${data.copied} books and supplies from ${fromAy} into ${toAy}`,
    });
    setBusy(false);
  }

  return (
    <Button
      variant="outline"
      onClick={() => void copy()}
      loading={busy}
      loadingText="Copying…"
    >
      <Copy className="size-4" />
      Copy from {fromAy}
    </Button>
  );
}
