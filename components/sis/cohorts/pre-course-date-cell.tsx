'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { useWriteAction } from '@/lib/hooks/use-write-action';
import { DatePicker } from '@/components/ui/date-picker';
import { ApiError, apiFetch, jsonInit } from '@/lib/query/fetcher';

// Inline editable pre-course SESSION DATE on the pre-course cohort tracker.
// Setting a date records it (the route flips preCourseAnswer→'Yes' → Counselled);
// clearing reverts to Not-yet. After a successful write we router.refresh() so the
// status badge, the Not-yet/Counselled tab membership, and the dashboard stat all
// reconcile from the server (the cell only owns its own displayed date).

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function PreCourseDateCell({
  enroleeNumber,
  ayCode,
  value,
}: {
  enroleeNumber: string;
  ayCode: string;
  value: string | null;
}) {
  const [date, setDate] = useState<string>(value ?? '');

  // Tier-1 optimistic: `date` is local display state. onMutate snapshots the
  // prior value (from the closure) + sets the new value immediately; onError
  // restores it. The route's `body.error` is preserved via ApiError.body
  // (fallback 'Could not save the session date' for an absent error, then
  // 'Save failed' for a non-API error — both unchanged from the original).
  const commitMutation = useMutation({
    mutationFn: (next: string) =>
      apiFetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/pre-course?ay=${encodeURIComponent(ayCode)}`,
        jsonInit('PATCH', { sessionDate: next || null })
      ),
    onMutate: (next) => {
      const prev = date;
      setDate(next); // optimistic
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      if (ctx) setDate(ctx.prev); // revert
    },
  });

  const run = useWriteAction();
  const [pending, setPending] = useState(false);

  async function commit(next: string) {
    setPending(true);
    await run(() => commitMutation.mutateAsync(next), {
      // The cell already shows the new date optimistically.
      pending: false,
      success: next ? 'Session date saved' : 'Session date cleared',
      error: (err) => {
        if (err instanceof ApiError) {
          const body = err.body;
          const errStr =
            body && typeof body === 'object'
              ? (body as Record<string, unknown>).error
              : undefined;
          return typeof errStr === 'string' && errStr
            ? errStr
            : 'Could not save the session date';
        }
        return err instanceof Error ? err.message : 'Save failed';
      },
    });
    setPending(false);
  }

  return (
    <div className="w-40">
      {date ? (
        <span>{formatDate(date)}</span>
      ) : (
        <DatePicker
          value={date}
          onChange={(next) => void commit(next)}
          allowClear
          disabled={pending}
          placeholder="Record session"
        />
      )}
    </div>
  );
}
