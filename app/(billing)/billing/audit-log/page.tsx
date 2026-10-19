import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  ListChecks,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  AuditLogDataTable,
  type MergedRow,
} from '@/components/audit/audit-log-data-table';
import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { MetricCard } from '@/components/dashboard/metric-card';
import { PageShell } from '@/components/ui/page-shell';
import { loadAuditActorEmails } from '@/lib/audit/actor-emails';
import { applyAuditFilters, parseAuditFilters } from '@/lib/audit/filters';
import { canInvoiceInQbo } from '@/lib/qbo/roles';
import { createClient, getSessionUser } from '@/lib/supabase/server';

// Billing → Audit log: every change the SIS made in QuickBooks (invoices,
// payments, customers, products, the connection) and every student linked to
// a customer, with who did it and when. The same audit table and data table
// as the other modules' audit logs, in the Billing layout.

const BILLING_AUDIT_ALLOWLIST = [
  'qbo.invoice.create',
  'qbo.invoice.send',
  'qbo.invoice.void',
  'qbo.invoice.link',
  'qbo.payment.create',
  'qbo.payment.apply_credit',
  'qbo.customer.create',
  'qbo.customer.update',
  'qbo.customer.link',
  'qbo.item.create',
  'qbo.item.update',
  'qbo.connection.connect',
  'qbo.connection.disconnect',
  'billing.link.run',
  // Settings that Billing no longer has (migration 193); kept so their
  // history stays readable.
  'billing.mapping.update',
  'billing.years.update',
  'billing.deposit_accounts.update',
] as const;

const INVOICE_ACTIONS = new Set([
  'qbo.invoice.create',
  'qbo.invoice.send',
  'qbo.invoice.void',
]);
const PAYMENT_ACTIONS = new Set([
  'qbo.payment.create',
  'qbo.payment.apply_credit',
]);

export default async function BillingAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    pageSize?: string;
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (!canInvoiceInQbo(sessionUser.role)) redirect('/');

  const canExport =
    sessionUser.role === 'school_admin' || sessionUser.role === 'superadmin';
  const params = await searchParams;
  const PAGE_SIZE = Math.min(Number(params.pageSize ?? 50), 200);
  const page = Math.max(Number(params.page ?? 1), 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const supabase = await createClient();

  const filters = parseAuditFilters(params, BILLING_AUDIT_ALLOWLIST);

  const [actorOptions, logResult] = await Promise.all([
    loadAuditActorEmails(supabase, BILLING_AUDIT_ALLOWLIST, 'billing'),
    applyAuditFilters(
      supabase
        .from('audit_log')
        .select(
          'id, actor_email, actor_role, action, entity_type, entity_id, context, created_at',
          { count: 'exact' }
        )
        .in('action', BILLING_AUDIT_ALLOWLIST),
      filters
    )
      .order('created_at', { ascending: false })
      .range(from, to),
  ]);
  const { data, count, error } = logResult;
  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  const rows: MergedRow[] = (
    (data ?? []) as Array<{
      id: string;
      actor_email: string;
      actor_role: string | null;
      action: string;
      entity_type: string;
      entity_id: string | null;
      context: Record<string, unknown>;
      created_at: string;
    }>
  ).map((r) => ({
    id: `new-${r.id}`,
    at: r.created_at,
    actor: r.actor_email,
    actorRole: r.actor_role,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    context: r.context ?? {},
    sheet_id: null,
    source: 'audit_log' as const,
  }));

  const n = (v: number) => v.toLocaleString('en-SG');
  const uniqueActors = new Set(rows.map((r) => r.actor)).size;
  const invoices = rows.filter((r) => INVOICE_ACTIONS.has(r.action)).length;
  const payments = rows.filter((r) => PAYMENT_ACTIONS.has(r.action)).length;

  return (
    <PageShell>
      <Link
        href="/billing"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Customers
      </Link>
      <BillingPageHeader
        crumbs={[{ label: 'Audit log' }]}
        title="Audit log"
        description="Everything the SIS did in QuickBooks — invoices, payments, customers, products and the connection — and every student linked to a customer, with who did it and when."
      />

      <div className="@container/main">
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          <MetricCard
            label="Entries"
            value={n(count ?? rows.length)}
            icon={ListChecks}
            subtext={`Page ${page} of ${totalPages} · ${PAGE_SIZE} per page`}
          />
          <MetricCard
            label="People"
            value={n(uniqueActors)}
            icon={Users}
            subtext="Different accounts on this page"
          />
          <MetricCard
            label="Invoice changes"
            value={n(invoices)}
            icon={FileText}
            subtext="Created, emailed or voided, on this page"
          />
          <MetricCard
            label="Payments"
            value={n(payments)}
            icon={Wallet}
            subtext="Recorded or paid from credit, on this page"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold leading-tight text-foreground">
              The audit log couldn&rsquo;t be read
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {error.message}
            </p>
          </div>
        </div>
      )}

      <AuditLogDataTable
        rows={rows}
        currentAction={filters.action}
        currentActor={filters.actor}
        currentFrom={filters.from}
        currentTo={filters.to}
        actionOptions={[...BILLING_AUDIT_ALLOWLIST]}
        actorOptions={actorOptions}
        canExport={canExport}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          totalPages,
          total: count ?? 0,
        }}
      />
    </PageShell>
  );
}
