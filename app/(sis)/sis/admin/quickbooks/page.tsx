import { AlertTriangle, CheckCircle2, ReceiptText } from 'lucide-react';
import { redirect } from 'next/navigation';

import { QboConnectionActions } from '@/components/sis/qbo-connection-actions';
import { SisPageHeader } from '@/components/sis/sis-page-header';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { getQboStatus } from '@/lib/qbo/status';
import { getSessionUser } from '@/lib/supabase/server';

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-SG', {
        timeZone: 'Asia/Singapore',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
const SOURCE: Record<string, string> = {
  webhook: 'Instant update',
  hourly: 'Hourly check',
  manual: 'Refresh button',
};

// SIS Admin → QuickBooks. Superadmin connects the school's QuickBooks once;
// this page then shows whether it is connected and when it last synced.
export default async function QuickBooksAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) redirect('/login');
  if (sessionUser.role !== 'superadmin') redirect('/sis');
  const [status, params] = await Promise.all([getQboStatus(), searchParams]);

  return (
    <PageShell>
      <SisPageHeader
        group="Access & system"
        title="QuickBooks."
        description="Connect the school's QuickBooks company so admissions can invoice Registration and Fees from the SIS."
      />

      {params.error && (
        <div className="flex items-start gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground shadow-brand-tile">
            <AlertTriangle className="size-4" />
          </div>
          <div className="flex-1 space-y-1.5">
            <p className="font-serif text-base font-semibold text-foreground">
              QuickBooks wasn&apos;t connected
            </p>
            <p className="text-sm text-muted-foreground">{params.error}</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
            Connection
          </CardDescription>
          <CardTitle className="flex flex-wrap items-center gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
            {status.connected
              ? (status.companyName ?? 'Connected')
              : 'Not connected'}
            {status.connected ? (
              <Badge
                variant="outline"
                className="h-6 border-brand-mint bg-brand-mint/30 text-ink"
              >
                <CheckCircle2 className="h-3 w-3" /> Connected
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-6 border-destructive/40 bg-destructive/10 text-destructive"
              >
                Not connected
              </Badge>
            )}
            {status.environment === 'sandbox' && (
              <Badge variant="secondary" className="h-6">
                Test company
              </Badge>
            )}
          </CardTitle>
          <CardAction>
            <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-indigo to-brand-navy text-white shadow-brand-tile">
              <ReceiptText className="size-5" />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          {!status.configured ? (
            <p className="text-sm text-muted-foreground">
              The QuickBooks app keys aren&apos;t set on this server yet, so it
              can&apos;t be connected.
            </p>
          ) : (
            <>
              {status.connected && (
                <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">Connected</dt>
                    <dd className="text-foreground">
                      {when(status.connectedAt)}
                      {status.connectedByEmail
                        ? ` by ${status.connectedByEmail}`
                        : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last sync</dt>
                    <dd className="text-foreground">
                      {status.lastRun
                        ? `${when(status.lastRun.startedAt)} · ${SOURCE[status.lastRun.source] ?? status.lastRun.source}`
                        : 'Not yet'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Invoices updated</dt>
                    <dd className="tabular-nums text-foreground">
                      {status.lastRun?.invoicesUpdated ?? 0}
                    </dd>
                  </div>
                </dl>
              )}
              <QboConnectionActions connected={status.connected} />
            </>
          )}
        </CardContent>
      </Card>

      {status.recentErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
              Problems
            </CardDescription>
            <CardTitle className="font-serif text-lg font-semibold tracking-tight text-foreground">
              Recent sync problems
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {status.recentErrors.map((e) => (
                <li
                  key={e.startedAt + e.source}
                  className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[10rem_1fr]"
                >
                  <span className="text-muted-foreground">
                    {when(e.startedAt)} · {SOURCE[e.source] ?? e.source}
                  </span>
                  <span className="text-foreground">{e.error}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
