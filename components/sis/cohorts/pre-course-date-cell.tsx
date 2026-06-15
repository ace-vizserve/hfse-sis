'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

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
  const router = useRouter();
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
    onSuccess: (_data, next) => {
      toast.success(next ? 'Session date saved' : 'Session date cleared');
      router.refresh();
    },
    onError: (err, _next, ctx) => {
      if (ctx) setDate(ctx.prev); // revert
      if (err instanceof ApiError) {
        const body = err.body;
        const errStr =
          body && typeof body === 'object'
            ? (body as Record<string, unknown>).error
            : undefined;
        toast.error(
          typeof errStr === 'string' && errStr
            ? errStr
            : 'Could not save the session date'
        );
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const pending = commitMutation.isPending;

  function commit(next: string) {
    commitMutation.mutate(next);
  }

  return (
    <div className="w-40">
      {date ? (
        <span>{formatDate(date)}</span>
      ) : (
        <DatePicker
          value={date}
          onChange={commit}
          allowClear
          disabled={pending}
          placeholder="Record session"
        />
      )}
    </div>
  );
}
