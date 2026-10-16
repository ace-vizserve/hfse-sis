import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import type { TileLine } from '@/lib/billing/tile-line';
import { cn } from '@/lib/utils';

const TONE: Record<TileLine['tone'], string> = {
  paid: 'text-ink',
  open: 'text-foreground',
  attention:
    'rounded-md border border-brand-amber/40 bg-brand-amber/10 px-2 py-1.5 text-ink',
  none: 'text-muted-foreground',
};

// The Registration / Fees tile's QuickBooks line — read-only. The whole line
// opens the student's Billing page (or their To review entry when they are not
// linked yet). Status, number and payment date are filled by the sync.
export function BillingTileLine({
  line,
  stage,
  stageStatus,
  startDate,
  studentNumber,
  linked,
  canOpen,
}: {
  line: TileLine | null;
  stage: 'registration' | 'fees';
  stageStatus: string | null;
  startDate: string | null;
  studentNumber: string | null;
  linked: boolean;
  /** Only Billing's roles get a link; anyone else sees the line as text. */
  canOpen: boolean;
}) {
  // Fees paid in QuickBooks but no start date yet: the server line can't
  // know the start date, the tile can.
  const shown: TileLine | null =
    line &&
    stage === 'fees' &&
    line.tone === 'paid' &&
    stageStatus !== 'Paid' &&
    stageStatus !== 'Cancelled' &&
    !startDate?.trim()
      ? { text: 'Paid in QuickBooks — add the start date', tone: 'attention' }
      : line;
  const text = !studentNumber
    ? 'No student number yet — Billing needs one'
    : !linked
      ? 'Not linked to QuickBooks yet'
      : (shown?.text ?? 'Not billed in QuickBooks yet');
  const tone = !studentNumber || !linked ? 'none' : (shown?.tone ?? 'none');
  const href = studentNumber
    ? linked
      ? `/billing/${encodeURIComponent(studentNumber)}`
      : `/billing/review?student=${encodeURIComponent(studentNumber)}`
    : null;
  const body = (
    <span
      className={cn(
        'flex items-center justify-between gap-2 text-[11px] font-medium tabular-nums',
        TONE[tone]
      )}
    >
      <span>{text}</span>
      {canOpen && href && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-brand-indigo">
          {linked ? 'Open in Billing' : 'Find in Billing'}
          <ArrowUpRight className="size-3" aria-hidden />
        </span>
      )}
    </span>
  );
  return (
    <div className="ml-1 border-t border-hairline pt-2.5">
      {canOpen && href ? (
        <Link
          href={href}
          className="block rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}
