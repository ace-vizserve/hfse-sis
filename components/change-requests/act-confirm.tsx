'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// Client confirm step for the email one-click approve/reject flow. The
// approver is NOT logged in, so the result of their click must render
// inline on this page (a toast alone would vanish). On click we POST the
// signed token to /api/change-requests/act and switch to a success/error
// state in place.

type Field = { label: string; value: string };

type Props = {
  token: string;
  action: 'approve' | 'reject';
  fields: Field[];
  justification: string | null;
  appHref: string;
};

type Phase = 'confirm' | 'done' | 'error';

export function ActConfirm({
  token,
  action,
  fields,
  justification,
  appHref,
}: Props) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isReject = action === 'reject';

  async function submit() {
    if (isReject && note.trim().length === 0) {
      setNoteError('A reason is required to decline a request.');
      return;
    }
    setNoteError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/change-requests/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          decision_note: isReject ? note.trim() : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        setPhase('done');
      } else {
        const msg =
          data.error ?? 'Something went wrong. Please try again from the app.';
        setErrorMessage(msg);
        setPhase('error');
        toast.error(msg);
      }
    } catch {
      const msg =
        'We could not reach the server. Please try again from the app.';
      setErrorMessage(msg);
      setPhase('error');
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'done') {
    return (
      <Shell
        tone="mint"
        icon={CheckCircle2}
        eyebrow="Grade change request"
        title={isReject ? 'Request declined' : 'Request approved'}
      >
        <p>
          {isReject
            ? 'Thank you. The teacher has been notified that the request was declined.'
            : 'Thank you. The request has been approved — the registrar will apply it to the locked sheet.'}
        </p>
        <p>
          <Link
            href={appHref}
            className="font-medium text-brand-indigo underline-offset-4 transition-colors hover:underline"
          >
            Open in the app
          </Link>
        </p>
      </Shell>
    );
  }

  if (phase === 'error') {
    return (
      <Shell
        tone="amber"
        icon={AlertTriangle}
        eyebrow="Grade change request"
        title="We couldn't complete this"
      >
        <p>{errorMessage}</p>
        <p>
          <Link
            href={appHref}
            className="font-medium text-brand-indigo underline-offset-4 transition-colors hover:underline"
          >
            Open in the app
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell
      tone={isReject ? 'destructive' : 'indigo'}
      icon={isReject ? XCircle : ShieldCheck}
      eyebrow="Grade change request"
      title={isReject ? 'Decline this request?' : 'Approve this request?'}
    >
      <p>
        {isReject
          ? 'Please confirm you want to decline this grade change. The teacher will be notified.'
          : 'Please confirm you want to approve this grade change. The registrar will then apply it to the locked sheet.'}
      </p>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 p-4 text-foreground">
        {fields.map((f) => (
          <div key={f.label} className="flex gap-3 text-sm">
            <dt className="w-28 shrink-0 text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 break-words">{f.value}</dd>
          </div>
        ))}
      </dl>

      {justification ? (
        <div className="text-sm">
          <p className="font-medium text-foreground">Teacher&apos;s reason</p>
          <p className="mt-1 text-muted-foreground">{justification}</p>
        </div>
      ) : null}

      {isReject ? (
        <div className="space-y-1.5">
          <label
            htmlFor="decision-note"
            className="text-sm font-medium text-foreground"
          >
            Reason for declining{' '}
            <span className="text-destructive">(required)</span>
          </label>
          <Textarea
            id="decision-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (noteError) setNoteError(null);
            }}
            aria-invalid={noteError ? true : undefined}
            placeholder="Let the teacher know why this request was declined."
            disabled={submitting}
          />
          {noteError ? (
            <p className="text-sm text-destructive">{noteError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant={isReject ? 'destructive' : 'default'}
          onClick={submit}
          disabled={submitting}
        >
          {submitting
            ? isReject
              ? 'Declining…'
              : 'Approving…'
            : isReject
              ? 'Confirm decline'
              : 'Confirm approve'}
        </Button>
        <Link
          href={appHref}
          className="text-sm font-medium text-brand-indigo underline-offset-4 transition-colors hover:underline"
        >
          Open in the app instead
        </Link>
      </div>
    </Shell>
  );
}

function Shell({
  tone,
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  tone: 'indigo' | 'destructive' | 'mint' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  const tile =
    tone === 'mint'
      ? 'bg-gradient-to-br from-brand-mint to-brand-sky'
      : tone === 'amber'
        ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70'
        : tone === 'destructive'
          ? 'bg-gradient-to-br from-destructive to-destructive/70'
          : 'bg-gradient-to-br from-brand-indigo to-brand-navy';
  return (
    <div className="w-full max-w-lg rounded-xl border bg-card px-6 py-8 text-card-foreground shadow-sm sm:px-8">
      <div
        className={`flex size-12 items-center justify-center rounded-2xl text-white shadow-brand-tile ${tile}`}
      >
        <Icon className="size-6" />
      </div>
      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-serif text-2xl text-foreground">{title}</h1>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
