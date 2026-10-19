'use client';

import {
  ChevronDown,
  CornerDownRight,
  Download,
  ExternalLink,
  Pencil,
  Search,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { BillingPageHeader } from '@/components/billing/billing-page-header';
import { PrintIcon, ToolbarIcon } from '@/components/billing/toolbar-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { exportCsv } from '@/components/ui/data-table/csv';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ACCOUNT_TYPES,
  filterAccounts,
  type AccountRow,
} from '@/lib/billing/accounts';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// QuickBooks' Chart of accounts: Run report and New account ▾ at the top;
// "Filter by name or number" and the account type; Edit mode, export, print
// and settings icons; Name · Account type (BAL / P&L) · Detail type ·
// QuickBooks balance · Action (View register or Run report, ▾ Edit, Run
// report, Reconcile, Create subaccount, Make inactive), in QuickBooks' order
// with sub-accounts under their parent. Accounts are QuickBooks' to set up,
// so Edit, New account and the rest open QuickBooks.

type Col = 'type' | 'detail' | 'balance';
const COLS: Array<{ id: Col; label: string }> = [
  { id: 'type', label: 'Account type' },
  { id: 'detail', label: 'Detail type' },
  { id: 'balance', label: 'QuickBooks balance' },
];

// Accounts QuickBooks reconciles against a statement.
const RECONCILABLE = new Set([
  'Bank',
  'Credit Card',
  'Other Current Asset',
  'Fixed Asset',
  'Other Asset',
  'Other Current Liability',
  'Long Term Liability',
  'Equity',
]);

function QbMenuLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem asChild>
      <a href={href} target="_blank" rel="noreferrer">
        {children}
        <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
      </a>
    </DropdownMenuItem>
  );
}

const reportHref = (id: string) =>
  `/billing/reports/general-ledger?period=this-year&account=${encodeURIComponent(id)}`;

export function ChartOfAccounts({
  rows,
  qbBase,
}: {
  rows: AccountRow[];
  /** The QuickBooks web app's address (sandbox or production). */
  qbBase: string;
}) {
  const [q, setQ] = React.useState('');
  const [type, setType] = React.useState('all');
  const [hidden, setHidden] = React.useState<Set<Col>>(() => new Set());
  const types = ACCOUNT_TYPES.filter((t) =>
    rows.some((r) => r.type === t.type)
  );
  const shown = filterAccounts(rows, q, type);
  const filtering = q.trim() !== '' || type !== 'all';
  const show = (c: Col) => !hidden.has(c);
  const qbCoa = `${qbBase}/app/chartofaccounts`;

  const download = () =>
    exportCsv(
      shown,
      [
        { header: 'Name', accessor: (r: AccountRow) => r.fullName },
        { header: 'Number', accessor: (r: AccountRow) => r.number },
        { header: 'Account type', accessor: (r: AccountRow) => r.typeLabel },
        { header: 'Detail type', accessor: (r: AccountRow) => r.detailType },
        {
          header: 'QuickBooks balance',
          accessor: (r: AccountRow) => r.balance,
        },
      ],
      'chart-of-accounts.csv'
    );

  return (
    <>
      <BillingPageHeader
        crumbs={[{ label: 'Accounting' }, { label: 'Chart of accounts' }]}
        title="Chart of accounts"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/billing/reports/general-ledger?period=this-year">
                Run report
              </Link>
            </Button>
            <div className="flex">
              <Button asChild className="rounded-r-none">
                <a href={qbCoa} target="_blank" rel="noreferrer">
                  New account
                </a>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    className="rounded-l-none border-l border-primary-foreground/20"
                    aria-label="More ways to add accounts"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <QbMenuLink href={qbCoa}>Import</QbMenuLink>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        }
      />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name or number"
              aria-label="Filter by name or number"
              className="pl-9"
            />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger
              className="h-10 w-full sm:w-64"
              aria-label="Account type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {types.map((t) => (
                <SelectItem key={t.type} value={t.type}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 sm:ml-auto">
            <Button asChild variant="ghost" size="sm" className="h-8">
              <a href={qbCoa} target="_blank" rel="noreferrer">
                <Pencil className="size-3.5" />
                Edit mode
              </a>
            </Button>
            <ToolbarIcon icon={Download} label="Export" onClick={download} />
            <PrintIcon />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="Settings"
                >
                  <Settings className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Columns</DropdownMenuLabel>
                {COLS.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={show(c.id)}
                    onCheckedChange={(v) =>
                      setHidden((h) => {
                        const n = new Set(h);
                        if (v) n.delete(c.id);
                        else n.add(c.id);
                        return n;
                      })
                    }
                  >
                    {c.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Name</TableHead>
                {show('type') && <TableHead>Account type</TableHead>}
                {show('detail') && <TableHead>Detail type</TableHead>}
                {show('balance') && (
                  <TableHead className="text-right">
                    QuickBooks balance
                  </TableHead>
                )}
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No account matches. Clear the filter or choose All.
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((r) => {
                  // While filtering, rows stand alone; otherwise sub-accounts
                  // sit indented under their parent, as QuickBooks lists them.
                  const depth = filtering ? 0 : r.depth;
                  return (
                    <TableRow key={r.id}>
                      <TableCell
                        className="py-2.5"
                        style={{ paddingLeft: `${16 + depth * 20}px` }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {depth > 0 && (
                            <CornerDownRight className="size-3.5 text-muted-foreground" />
                          )}
                          {r.number && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {r.number}
                            </span>
                          )}
                          <span className="text-foreground">
                            {filtering && r.depth > 0 ? r.fullName : r.name}
                          </span>
                        </span>
                      </TableCell>
                      {show('type') && (
                        <TableCell className="py-2.5 text-muted-foreground">
                          <span className="flex items-center justify-between gap-3">
                            {r.typeLabel}
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                                r.statement === 'BAL'
                                  ? 'bg-brand-mint/30 text-ink'
                                  : 'bg-accent text-accent-foreground'
                              )}
                              title={
                                r.statement === 'BAL'
                                  ? 'Balance sheet account'
                                  : 'Profit and loss account'
                              }
                            >
                              {r.statement}
                            </span>
                          </span>
                        </TableCell>
                      )}
                      {show('detail') && (
                        <TableCell className="py-2.5 text-muted-foreground">
                          {r.detailType}
                        </TableCell>
                      )}
                      {show('balance') && (
                        <TableCell className="py-2.5 text-right tabular-nums whitespace-nowrap">
                          {r.balance === null ? '' : formatSgd(r.balance)}
                        </TableCell>
                      )}
                      <TableCell className="py-1.5 text-right whitespace-nowrap">
                        <AccountAction row={r} qbBase={qbBase} />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
        <p className="text-sm text-muted-foreground tabular-nums">
          {shown.length === rows.length
            ? `${rows.length} accounts`
            : `${shown.length} of ${rows.length} accounts`}
        </p>
      </div>
    </>
  );
}

/** QuickBooks' Action cell: View register (or Run report) and its ▾. */
function AccountAction({
  row: r,
  qbBase,
}: {
  row: AccountRow;
  qbBase: string;
}) {
  const qbCoa = `${qbBase}/app/chartofaccounts`;
  const linkClass =
    'text-sm font-medium text-primary underline-offset-4 hover:underline';
  const main =
    r.action === 'report' ? (
      <Link href={reportHref(r.id)} className={linkClass}>
        Run report
      </Link>
    ) : r.type === 'Bank' ? (
      <Link
        href={`/billing/banks?account=${encodeURIComponent(r.id)}`}
        className={linkClass}
      >
        View register
      </Link>
    ) : (
      <a
        href={`${qbBase}/app/register?accountId=${encodeURIComponent(r.id)}`}
        target="_blank"
        rel="noreferrer"
        className={cn(linkClass, 'inline-flex items-center gap-1')}
      >
        View register
        <ExternalLink className="size-3" />
      </a>
    );
  return (
    <span className="inline-flex items-center gap-1">
      {main}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`More for ${r.fullName}`}
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <QbMenuLink href={qbCoa}>Edit</QbMenuLink>
          {r.action === 'register' && (
            <DropdownMenuItem asChild>
              <Link href={reportHref(r.id)}>Run report</Link>
            </DropdownMenuItem>
          )}
          {r.action === 'register' && RECONCILABLE.has(r.type) && (
            <QbMenuLink
              href={`${qbBase}/app/reconcile?accountId=${encodeURIComponent(r.id)}`}
            >
              Reconcile
            </QbMenuLink>
          )}
          <QbMenuLink href={qbCoa}>Create subaccount</QbMenuLink>
          <QbMenuLink href={qbCoa}>Make inactive (reduces usage)</QbMenuLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
