'use client';

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Landmark,
  Settings,
  Upload,
} from 'lucide-react';
import * as React from 'react';

import { BankPeriodPicker } from '@/components/billing/bank-period-picker';
import { PrintIcon, ToolbarIcon } from '@/components/billing/toolbar-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { exportCsv } from '@/components/ui/data-table/csv';
import { DataTableEmptyState } from '@/components/ui/data-table/empty-state';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
import type { BankLedgerRow } from '@/lib/billing/bank-ledger';
import { formatDay } from '@/lib/billing/view';
import { formatSgd } from '@/lib/qbo/format';
import { cn } from '@/lib/utils';

// One bank account's transactions as QuickBooks' Bank Register: the paging
// line (Go to · First · Previous · 1-50 of n · Next · Last), the grey bar
// with the filter (Find, Reconcile status, Transaction type, Date) on the
// left and print / export / settings on the right, then Date · Ref no. over
// Type · Payee over Account · Memo · Payment · Deposit · ✓ · Balance, two
// lines a transaction, newest first.

const PAGE = 50;

const STATUS = [
  { value: 'all', label: 'All' },
  { value: 'R', label: 'Reconciled' },
  { value: 'C', label: 'Cleared' },
  { value: 'none', label: 'No status' },
  { value: 'not-R', label: 'Not reconciled' },
] as const;
type Status = (typeof STATUS)[number]['value'];

const matchesStatus = (r: BankLedgerRow, s: Status) =>
  s === 'all'
    ? true
    : s === 'none'
      ? r.cleared === null
      : s === 'not-R'
        ? r.cleared !== 'R'
        : r.cleared === s;

const money = (n: number) => (n > 0 ? formatSgd(n) : '');

export function BankTransactionsTable({
  rows,
  from,
  to,
  accountName,
}: {
  rows: BankLedgerRow[];
  from: string;
  to: string;
  accountName: string;
}) {
  const [find, setFindRaw] = React.useState('');
  const [status, setStatusRaw] = React.useState<Status>('all');
  const [type, setTypeRaw] = React.useState('all');
  const [oneLine, setOneLine] = React.useState(false);
  const [page, setPage] = React.useState(0);
  // A new filter starts again at page 1.
  const setFind = (v: string) => (setFindRaw(v), setPage(0));
  const setStatus = (v: Status) => (setStatusRaw(v), setPage(0));
  const setType = (v: string) => (setTypeRaw(v), setPage(0));

  const types = React.useMemo(
    () => [...new Set(rows.map((r) => r.type))].sort(),
    [rows]
  );
  // QuickBooks lists the register newest first; the report reads oldest
  // first, so it is turned round whole (ties keep their running balance).
  const shown = React.useMemo(() => {
    const needle = find.trim().toLowerCase().replace(/,/g, '');
    return [...rows].reverse().filter((r) => {
      if (type !== 'all' && r.type !== type) return false;
      if (!matchesStatus(r, status)) return false;
      if (!needle) return true;
      return [r.memo, r.number, String(Math.abs(r.amount)), r.name]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(needle));
    });
  }, [rows, find, status, type]);

  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PAGE, at * PAGE + PAGE);
  const filtering = find.trim() !== '' || status !== 'all' || type !== 'all';
  const filterLabel = [
    `${formatDay(from)} – ${formatDay(to)}`,
    type !== 'all' ? type : null,
    status !== 'all' ? STATUS.find((s) => s.value === status)?.label : null,
    find.trim() ? `“${find.trim()}”` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const download = () =>
    exportCsv(
      shown,
      [
        { header: 'Date', accessor: (r: BankLedgerRow) => r.date },
        { header: 'Ref no.', accessor: (r: BankLedgerRow) => r.number },
        { header: 'Type', accessor: (r: BankLedgerRow) => r.type },
        { header: 'Payee', accessor: (r: BankLedgerRow) => r.name },
        { header: 'Account', accessor: (r: BankLedgerRow) => r.split },
        { header: 'Memo', accessor: (r: BankLedgerRow) => r.memo },
        {
          header: 'Payment',
          accessor: (r: BankLedgerRow) => (r.amount < 0 ? -r.amount : null),
        },
        {
          header: 'Deposit',
          accessor: (r: BankLedgerRow) => (r.amount > 0 ? r.amount : null),
        },
        {
          header: 'Reconcile status',
          accessor: (r: BankLedgerRow) => r.cleared,
        },
        { header: 'Balance', accessor: (r: BankLedgerRow) => r.balance },
      ],
      `bank-register-${accountName.replace(/[^\w-]+/g, '-')}-${from}-to-${to}.csv`
    );

  const pager = (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-sm">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Label htmlFor="register-goto">Go to:</Label>
        <Input
          id="register-goto"
          key={at}
          defaultValue={at + 1}
          inputMode="numeric"
          className="h-8 w-12 text-center tabular-nums"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const n = Number((e.target as HTMLInputElement).value);
            if (Number.isInteger(n) && n >= 1 && n <= pages) setPage(n - 1);
          }}
        />
        of {pages}
      </span>
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0"
        disabled={at === 0}
        onClick={() => setPage(0)}
      >
        <ChevronLeft className="size-3.5" />
        First
      </Button>
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0"
        disabled={at === 0}
        onClick={() => setPage(at - 1)}
      >
        Previous
      </Button>
      <span className="tabular-nums text-foreground">
        {shown.length === 0
          ? '0 of 0'
          : `${at * PAGE + 1}-${Math.min(shown.length, (at + 1) * PAGE)} of ${shown.length}`}
      </span>
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0"
        disabled={at >= pages - 1}
        onClick={() => setPage(at + 1)}
      >
        Next
      </Button>
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0"
        disabled={at >= pages - 1}
        onClick={() => setPage(pages - 1)}
      >
        Last
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-3">
      {pager}
      <Card className="gap-0 overflow-hidden py-0">
        {/* QuickBooks' grey bar: the filter, then print / export / settings. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5">
                <Filter className={cn('size-4', filtering && 'text-primary')} />
                <ChevronDown className="size-3.5" />
                <span className="font-normal">{filterLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[22rem] space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="register-find"
                  className="text-xs text-muted-foreground"
                >
                  Find
                </Label>
                <Input
                  id="register-find"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Memo, Ref no., payee or amount"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="register-status"
                    className="text-xs text-muted-foreground"
                  >
                    Reconcile status
                  </Label>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as Status)}
                  >
                    <SelectTrigger id="register-status" className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="register-type"
                    className="text-xs text-muted-foreground"
                  >
                    Transaction type
                  </Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger id="register-type" className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {types.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">Date</p>
                <BankPeriodPicker from={from} to={to} />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!filtering}
                  onClick={() => {
                    setFind('');
                    setStatus('all');
                    setType('all');
                  }}
                >
                  Reset
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex items-center">
            <PrintIcon />
            <ToolbarIcon
              icon={Upload}
              label="Export"
              onClick={download}
              disabled={shown.length === 0}
            />
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
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuCheckboxItem
                  checked={oneLine}
                  onCheckedChange={(v) => setOneLine(Boolean(v))}
                >
                  Show in one line
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {shown.length === 0 ? (
          <DataTableEmptyState
            icon={Landmark}
            title={
              rows.length === 0
                ? 'No transactions in this period'
                : 'No transactions match'
            }
            body={
              rows.length === 0
                ? 'Open the filter and pick an earlier From date to see more of this account.'
                : 'Open the filter and choose Reset.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-28 align-top">Date</TableHead>
                <TableHead className="align-top leading-tight">
                  Ref no.
                  {!oneLine && <span className="block">Type</span>}
                </TableHead>
                {oneLine && <TableHead className="align-top">Type</TableHead>}
                <TableHead className="align-top leading-tight">
                  Payee
                  {!oneLine && <span className="block">Account</span>}
                </TableHead>
                {oneLine && (
                  <TableHead className="align-top">Account</TableHead>
                )}
                <TableHead className="align-top">Memo</TableHead>
                <TableHead className="text-right align-top">Payment</TableHead>
                <TableHead className="text-right align-top">Deposit</TableHead>
                <TableHead
                  className="w-10 text-center align-top"
                  title="Reconcile status"
                >
                  ✓
                </TableHead>
                <TableHead className="text-right align-top">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.map((r) =>
                oneLine ? (
                  <TableRow key={r.key}>
                    <TableCell className="pt-2.5 pb-2 align-top whitespace-nowrap tabular-nums">
                      {formatDay(r.date)}
                    </TableCell>
                    <TableCell className="pt-2.5 pb-2 align-top font-mono text-xs">
                      {r.number ?? ''}
                    </TableCell>
                    <TableCell className="pt-2.5 pb-2 align-top text-muted-foreground">
                      {r.type}
                    </TableCell>
                    <TableCell className="pt-2.5 pb-2 align-top">
                      {r.name ?? ''}
                    </TableCell>
                    <TableCell className="pt-2.5 pb-2 align-top text-muted-foreground">
                      {r.split ?? ''}
                    </TableCell>
                    <MemoCell memo={r.memo} />
                    <MoneyCells row={r} />
                  </TableRow>
                ) : (
                  <React.Fragment key={r.key}>
                    <TableRow className="border-b-0 hover:bg-transparent">
                      <TableCell className="pt-2.5 pb-0.5 align-top whitespace-nowrap tabular-nums">
                        {formatDay(r.date)}
                      </TableCell>
                      <TableCell className="pt-2.5 pb-0.5 align-top font-mono text-xs">
                        {r.number ?? ''}
                      </TableCell>
                      <TableCell className="pt-2.5 pb-0.5 align-top">
                        {r.name ?? ''}
                      </TableCell>
                      <MemoCell memo={r.memo} />
                      <MoneyCells row={r} />
                    </TableRow>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell className="pt-0.5 pb-2.5" />
                      <TableCell className="pt-0.5 pb-2.5 text-muted-foreground">
                        {r.type}
                      </TableCell>
                      <TableCell className="pt-0.5 pb-2.5 text-muted-foreground">
                        {r.split ?? ''}
                      </TableCell>
                      <TableCell colSpan={5} className="pt-0.5 pb-2.5" />
                    </TableRow>
                  </React.Fragment>
                )
              )}
            </TableBody>
          </Table>
        )}
      </Card>
      {pages > 1 && pager}
    </div>
  );
}

function MemoCell({ memo }: { memo: string | null }) {
  return (
    <TableCell className="max-w-64 pt-2.5 pb-2 align-top">
      <span
        className="block truncate text-sm text-muted-foreground"
        title={memo ?? undefined}
      >
        {memo ?? ''}
      </span>
    </TableCell>
  );
}

function MoneyCells({ row: r }: { row: BankLedgerRow }) {
  return (
    <>
      <TableCell className="pt-2.5 pb-2 text-right whitespace-nowrap tabular-nums align-top">
        {money(-r.amount)}
      </TableCell>
      <TableCell className="pt-2.5 pb-2 text-right whitespace-nowrap tabular-nums align-top">
        {money(r.amount)}
      </TableCell>
      <TableCell className="pt-2.5 pb-2 text-center font-mono text-xs align-top">
        {r.cleared ?? ''}
      </TableCell>
      <TableCell className="pt-2.5 pb-2 text-right whitespace-nowrap tabular-nums align-top">
        {r.balance === null ? '—' : formatSgd(r.balance)}
      </TableCell>
    </>
  );
}
