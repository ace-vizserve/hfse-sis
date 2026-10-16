import { CheckCircle2, ReceiptText } from 'lucide-react';

import { QboConnectionActions } from '@/components/billing/qbo-connection-actions';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type { getQboStatus } from '@/lib/qbo/status';

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

export function QboConnectionCard({
  status,
}: {
  status: Awaited<ReturnType<typeof getQboStatus>>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          Connection
        </CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-2 font-serif text-lg font-semibold tracking-tight text-foreground">
          {status.connected
            ? (status.companyName ?? 'Connected')
            : status.loadFailed
              ? 'QuickBooks'
              : 'Not connected'}
          {status.loadFailed ? null : status.connected ? (
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
        {status.loadFailed ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the QuickBooks status. Refresh the page to try
            again.
          </p>
        ) : !status.configured ? (
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
                  <dt className="text-muted-foreground">Last check</dt>
                  <dd className="text-foreground">
                    {status.lastRun
                      ? `${when(status.lastRun.startedAt)} · ${SOURCE[status.lastRun.source] ?? status.lastRun.source}${status.lastRun.error ? ' · had a problem' : ''}`
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
            {status.recentErrors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Recent problems
                </p>
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
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
