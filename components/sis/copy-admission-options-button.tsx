'use client';

import { useMutation } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useWriteAction } from '@/lib/hooks/use-write-action';
import { apiFetch, jsonInit } from '@/lib/query/fetcher';

// "Copy from AY2026" on an empty year of /sis/admin/admission-options — the
// one-click rollover. The route refuses a year that already has options, so a
// second click (or a second tab) cannot duplicate anything.
export function CopyAdmissionOptionsButton({
  fromAy,
  toAy,
}: {
  fromAy: string;
  toAy: string;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; copied: number }>(
        '/api/sis/admission-options/copy',
        jsonInit('POST', { fromAy, toAy })
      ),
  });

  const run = useWriteAction();
  const [busy, setBusy] = useState(false);

  async function copy() {
    setBusy(true);
    await run(() => mutation.mutateAsync(), {
      pending: `Copying the ${fromAy} options into ${toAy}…`,
      success: (data) =>
        `Copied ${data.copied} options from ${fromAy} into ${toAy}`,
    });
    setBusy(false);
  }

  return (
    <Button onClick={() => void copy()} loading={busy} loadingText="Copying…">
      <Copy className="size-4" />
      Copy from {fromAy}
    </Button>
  );
}
