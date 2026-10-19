'use client';

import { CornerDownRight, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Card } from '@/components/ui/card';
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

// QuickBooks' Chart of accounts: "Filter by name or number", the account
// type choice, and Name · Account type · Detail type · QuickBooks balance ·
// Action, in QuickBooks' order with sub-accounts under their parent.
export function ChartOfAccounts({ rows }: { rows: AccountRow[] }) {
  const [q, setQ] = React.useState('');
  const [type, setType] = React.useState('all');
  const types = ACCOUNT_TYPES.filter((t) =>
    rows.some((r) => r.type === t.type)
  );
  const shown = filterAccounts(rows, q, type);
  const filtering = q.trim() !== '' || type !== 'all';

  return (
    <div className="space-y-4">
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
        <p className="text-sm text-muted-foreground tabular-nums sm:ml-auto">
          {shown.length === rows.length
            ? `${rows.length} accounts`
            : `${shown.length} of ${rows.length} accounts`}
        </p>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Name</TableHead>
              <TableHead>Account type</TableHead>
              <TableHead>Detail type</TableHead>
              <TableHead className="text-right">QuickBooks balance</TableHead>
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
                    <TableCell className="py-2.5 text-muted-foreground">
                      {r.typeLabel}
                    </TableCell>
                    <TableCell className="py-2.5 text-muted-foreground">
                      {r.detailType}
                    </TableCell>
                    <TableCell className="py-2.5 text-right tabular-nums whitespace-nowrap">
                      {r.balance === null ? '' : formatSgd(r.balance)}
                    </TableCell>
                    <TableCell className="py-2.5 text-right whitespace-nowrap">
                      <Link
                        href={
                          r.type === 'Bank'
                            ? `/billing/banks?account=${encodeURIComponent(r.id)}`
                            : `/billing/reports/general-ledger?period=this-year&account=${encodeURIComponent(r.id)}`
                        }
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {r.type === 'Bank' ? 'View register' : 'Run report'}
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
