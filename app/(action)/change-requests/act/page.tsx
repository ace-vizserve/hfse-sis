import Link from 'next/link';
import { AlertTriangle, CheckCircle2, FileQuestion } from 'lucide-react';

import { ActConfirm } from '@/components/change-requests/act-confirm';
import { verifyActionToken } from '@/lib/change-requests/action-token';
import { fetchLabels } from '@/lib/change-requests/labels';
import { createServiceClient } from '@/lib/supabase/service';
import { REASON_CATEGORY_LABELS } from '@/lib/schemas/change-request';

export const metadata = {
  title: 'Grade change request',
};

// Unauthenticated confirm page behind the email quick-action buttons. This
// is a GET and MUST NOT mutate — email clients and link scanners prefetch
// GETs. We only READ the request, derive its current state, and either show
// the actionable <ActConfirm> (status pending) or an informational
// "already handled / not found / invalid link" state. The actual decision
// happens on the POST /api/change-requests/act endpoint, triggered by a
// button click in <ActConfirm>.

type Search = { token?: string };

function appHrefFor(requestId: string): string {
  return `/markbook/change-requests?req=${encodeURIComponent(requestId)}`;
}

// Shell with the design-system gradient icon tile + serif headline recipe.
function MessageCard({
  tone,
  eyebrow,
  title,
  children,
}: {
  tone: 'mint' | 'amber' | 'muted';
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  const Icon =
    tone === 'mint'
      ? CheckCircle2
      : tone === 'amber'
        ? AlertTriangle
        : FileQuestion;
  const tile =
    tone === 'mint'
      ? 'bg-gradient-to-br from-brand-mint to-brand-sky'
      : tone === 'amber'
        ? 'bg-gradient-to-br from-brand-amber to-brand-amber/70'
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

function AppLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="font-medium text-brand-indigo underline-offset-4 transition-colors hover:underline"
    >
      {label}
    </Link>
  );
}

export default async function ChangeRequestActPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const token = sp.token ?? '';
  const payload = verifyActionToken(token);

  if (!payload) {
    return (
      <MessageCard
        tone="amber"
        eyebrow="Grade change request"
        title="This link is no longer valid"
      >
        <p>
          The approve / decline link in your email could not be read. It may
          have been mistyped, or it may have been replaced by a newer email.
        </p>
        <p>
          You can still review and act on the request from the app:{' '}
          <AppLink
            href="/markbook/change-requests"
            label="Open change requests"
          />
          .
        </p>
      </MessageCard>
    );
  }

  const appHref = appHrefFor(payload.requestId);
  const service = createServiceClient();

  const { data: existing } = await service
    .from('grade_change_requests')
    .select('*')
    .eq('id', payload.requestId)
    .maybeSingle();

  if (!existing) {
    return (
      <MessageCard
        tone="muted"
        eyebrow="Grade change request"
        title="We couldn't find this request"
      >
        <p>
          The request this link points to no longer exists. It may have been
          removed.
        </p>
        <p>
          <AppLink
            href="/markbook/change-requests"
            label="Open change requests"
          />
          .
        </p>
      </MessageCard>
    );
  }

  // Read-only label hydration for the summary (no writes).
  const labels = await fetchLabels(
    service,
    existing.grading_sheet_id,
    existing.grade_entry_id
  );

  const fields: Array<{ label: string; value: string }> = [
    { label: 'Sheet', value: labels.sheet_label ?? '(sheet)' },
    { label: 'Student', value: labels.student_label ?? '(student)' },
    { label: 'Field', value: String(existing.field_changed) },
    {
      label: 'Current value',
      value: existing.current_value ?? '(blank)',
    },
    { label: 'Proposed value', value: String(existing.proposed_value) },
    {
      label: 'Reason',
      value:
        REASON_CATEGORY_LABELS[
          existing.reason_category as keyof typeof REASON_CATEGORY_LABELS
        ] ?? String(existing.reason_category).replace(/_/g, ' '),
    },
    {
      label: 'Teacher',
      value: existing.requested_by_email ?? '(unknown)',
    },
  ];

  const status = existing.status as string;

  // State derivation (read-only — this GET never mutates). A change request
  // needs TWO designated approvers to co-sign: the first to act flips the
  // status (pending → approved/rejected), the second co-signs the row that's
  // already in approved/rejected. So "status is approved" does NOT mean this
  // approver is done — the SECOND approver still reaches this page on an
  // approved row and must be able to co-sign from their email link.
  //
  // Three outcomes:
  //   1. Terminal (applied / cancelled) → nothing anyone can do here.
  //   2. This approver already acted (they're primary or secondary reviewer)
  //      → static "you've reviewed it" message.
  //   3. Otherwise (pending, OR approved/rejected where THIS approver hasn't
  //      acted = a legitimate co-sign) → render the actionable <ActConfirm>.
  //      decideChangeRequest's own guards produce any remaining
  //      "already handled" outcome on submit (rendered inline by the client).
  const isTerminal = status === 'applied' || status === 'cancelled';
  const alreadyActed =
    payload.approverId === existing.primary_reviewed_by ||
    payload.approverId === existing.secondary_reviewed_by;

  if (!isTerminal && !alreadyActed) {
    return (
      <ActConfirm
        token={token}
        action={payload.action}
        fields={fields}
        justification={existing.justification ?? null}
        appHref={appHref}
      />
    );
  }

  let info: { title: string; body: string };
  if (alreadyActed) {
    info = {
      title: "You've already reviewed this request",
      body: 'Your decision has been recorded. Either the other approver still needs to co-sign, or the request has already been handled — there is nothing more for you to do here.',
    };
  } else {
    // Terminal states only.
    const terminalMessage: Record<string, { title: string; body: string }> = {
      applied: {
        title: 'This change is already live',
        body: 'This request has already been approved and applied to the grading sheet — there is nothing left to do.',
      },
      cancelled: {
        title: 'This request was cancelled',
        body: 'The teacher cancelled this request, so it can no longer be approved or declined.',
      },
    };
    info = terminalMessage[status] ?? {
      title: 'This request has already been handled',
      body: 'No further action is needed on this request.',
    };
  }

  return (
    <MessageCard tone="mint" eyebrow="Grade change request" title={info.title}>
      <p>{info.body}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 p-4 text-foreground">
        {fields.map((f) => (
          <div key={f.label} className="flex gap-3 text-sm">
            <dt className="w-28 shrink-0 text-muted-foreground">{f.label}</dt>
            <dd className="min-w-0 break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
      <p>
        <AppLink href={appHref} label="Open in the app" />
      </p>
    </MessageCard>
  );
}
