'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { DatePicker } from '@/components/ui/date-picker';

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
  const [pending, setPending] = useState(false);

  async function commit(next: string) {
    const prev = date;
    setDate(next); // optimistic
    setPending(true);
    try {
      const res = await fetch(
        `/api/sis/students/${encodeURIComponent(enroleeNumber)}/pre-course?ay=${encodeURIComponent(ayCode)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionDate: next || null }),
        }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? 'Could not save the session date');
      }
      toast.success(next ? 'Session date saved' : 'Session date cleared');
      router.refresh();
    } catch (err) {
      setDate(prev); // revert
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPending(false);
    }
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
