import { ArrowUpRight, FilePlus2 } from 'lucide-react';
import Link from 'next/link';

import { LinkStageInvoice } from '@/components/sis/link-stage-invoice';
import { Button } from '@/components/ui/button';
import {
  canCreateFromStage,
  createFromStageHref,
  showsOpenInvoice,
  showsQuickBooksNote,
  stageCardLine,
  stageInvoiceHref,
  type StageBilling,
} from '@/lib/billing/stage-card';
import { cn } from '@/lib/utils';

// The body of the Registration / Fees stage card (spec 2026-10-21): one line
// about the invoice tied to the stage, then Create invoice in Billing and Link
// an invoice (no live invoice yet) or Open invoice in Billing. Only Billing's roles get the
// actions; anyone else reads the line.
export function BillingStagePanel({
  stage,
  ayCode,
  status,
  invoice,
  paymentDate,
  startDate,
  updatedBy,
  updatedAt,
  connected,
  studentNumber,
  billing,
  canOpen,
}: {
  stage: 'registration' | 'fees';
  ayCode: string;
  status: string | null;
  invoice: string | null;
  paymentDate: string | null;
  startDate: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** QuickBooks is connected: Billing can invoice this stage. */
  connected: boolean;
  studentNumber: string | null;
  /** The invoices tied to the stage; null when not linked. */
  billing: StageBilling | null;
  /** admissions / school_admin / superadmin — may open Billing. */
  canOpen: boolean;
}) {
  const line = stageCardLine({
    stage,
    status,
    invoice,
    paymentDate,
    startDate,
    updatedBy,
    updatedAt,
    billing,
    connected,
  });
  const actions = connected && canOpen;
  const create = actions && canCreateFromStage(status, billing);
  const lead = showsOpenInvoice(status, billing)
    ? (billing?.lead ?? null)
    : null;
  const note = showsQuickBooksNote(status, billing);
  return (
    <div className="space-y-2.5 pl-1">
      <p
        className={cn(
          'text-xs leading-snug tabular-nums',
          line.attention
            ? 'rounded-md border border-brand-amber/40 bg-brand-amber/10 px-2 py-1.5 font-medium text-ink'
            : 'text-ink-3'
        )}
      >
        {line.text}
      </p>
      {note && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Filled in from QuickBooks. Changes there show here on their own.
        </p>
      )}
      {(create || (actions && lead)) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {create &&
            (studentNumber ? (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={createFromStageHref(studentNumber, stage, ayCode)}
                  >
                    <FilePlus2 className="size-3.5" />
                    Create invoice in Billing
                  </Link>
                </Button>
                <LinkStageInvoice
                  studentNumber={studentNumber}
                  stage={stage}
                  ayCode={ayCode}
                />
              </>
            ) : (
              <div className="space-y-1">
                <Button variant="outline" size="sm" disabled>
                  <FilePlus2 className="size-3.5" />
                  Create invoice in Billing
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  No student number yet — Billing needs one
                </p>
              </div>
            ))}
          {actions && lead && studentNumber && (
            <Link
              href={stageInvoiceHref(studentNumber, lead.qboInvoiceId)}
              className="inline-flex items-center gap-1 rounded-sm text-xs font-semibold text-brand-indigo underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Open invoice in Billing
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
