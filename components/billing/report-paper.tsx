'use client';

import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatReportMoney,
  lineCustomerId,
  lineInvoiceId,
  reportCsv,
  reportLines,
  sectionKeys,
  type CustomerSource,
  type ParsedReport,
  type ReportCell,
  type ReportColumn,
  type ReportLine,
} from '@/lib/billing/report';
import { formatDay } from '@/lib/billing/view';
import { cn } from '@/lib/utils';

// A QuickBooks report as QuickBooks prints it, on one sheet of "paper": the
// company, the report's title and date, then its columns, groups (each one
// collapsible, with its "Total for …" line) and the TOTAL line. Names of
// customers who are SIS students open their Billing page; an invoice number
// opens the invoice.

const indent = (depth: number) => ({ paddingLeft: `${16 + depth * 18}px` });

export function ReportPaper({
  reportKey,
  companyName,
  title,
  dateLine,
  report,
  customers,
  countInHeader,
  studentByCustomer,
  readAt,
  csvName,
}: {
  reportKey: string;
  companyName: string;
  title: string;
  dateLine: string;
  report: ParsedReport;
  customers: CustomerSource;
  countInHeader: boolean;
  studentByCustomer: Record<string, string>;
  readAt: string;
  csvName: string;
}) {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set()
  );
  const allKeys = React.useMemo(() => sectionKeys(report.rows), [report.rows]);
  const lines = React.useMemo(
    () => reportLines(report, collapsed),
    [report, collapsed]
  );
  const cols = report.columns;
  const lastMoney = cols.reduce(
    (at, c, i) => (c.kind === 'money' ? i : at),
    -1
  );

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const download = () => {
    const blob = new Blob(['﻿' + reportCsv(report)], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const studentOf = (line: ReportLine) => {
    const id = lineCustomerId(line, cols, customers);
    return id ? (studentByCustomer[id] ?? null) : null;
  };

  return (
    <Card className="mx-auto w-full max-w-6xl gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        {allKeys.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setCollapsed(
                collapsed.size === allKeys.length ? new Set() : new Set(allKeys)
              )
            }
          >
            {collapsed.size === allKeys.length ? 'Expand all' : 'Collapse all'}
          </Button>
        ) : (
          <span />
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={download}
          disabled={report.noData}
        >
          <Download className="size-4" />
          Export CSV
        </Button>
      </div>

      <div className="space-y-1 px-6 pt-7 pb-5 text-center">
        <p className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          {companyName}
        </p>
        <p className="text-sm text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{dateLine}</p>
      </div>

      {report.noData ? (
        <p className="border-t border-border px-6 py-12 text-center text-sm text-muted-foreground">
          QuickBooks has nothing to report for this period. Choose another
          report period above.
        </p>
      ) : (
        <Table data-report={reportKey}>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {cols.map((c, i) => (
                <TableHead
                  key={i}
                  className={cn(
                    'whitespace-nowrap',
                    c.kind === 'money' && 'text-right'
                  )}
                  aria-label={c.title ? undefined : c.label}
                >
                  {c.title}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, n) => {
              if (line.kind === 'header') {
                const s = line.section;
                const sn = studentOf(line);
                const shut = line.collapsed;
                const Chevron = shut ? ChevronRight : ChevronDown;
                return (
                  <TableRow
                    key={`h${s.key}`}
                    className="bg-muted/40 hover:bg-muted/60"
                  >
                    <TableCell
                      className="py-1.5 font-medium whitespace-nowrap"
                      style={indent(line.depth)}
                      colSpan={shut ? 1 : cols.length}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="-ml-1.5 size-6"
                          aria-expanded={!shut}
                          aria-label={`${shut ? 'Expand' : 'Collapse'} ${s.label}`}
                          onClick={() => toggle(s.key)}
                        >
                          <Chevron className="size-3.5" />
                        </Button>
                        <NameLink sn={sn}>{s.label}</NameLink>
                        {countInHeader && s.count > 0 && (
                          <span className="text-muted-foreground tabular-nums">
                            ({s.count})
                          </span>
                        )}
                      </span>
                    </TableCell>
                    {shut &&
                      cols
                        .slice(1)
                        .map((c, i) => (
                          <ValueCell
                            key={i}
                            col={c}
                            cell={s.summary?.[i + 1] ?? { value: '', id: null }}
                            strong
                            prefix={i + 1 === lastMoney}
                          />
                        ))}
                  </TableRow>
                );
              }
              if (line.kind === 'data') {
                const sn = studentOf(line);
                const invoiceId = sn ? lineInvoiceId(line, cols) : null;
                return (
                  <TableRow key={n}>
                    {line.cells.map((cell, i) => {
                      const col = cols[i];
                      const linkName =
                        sn &&
                        ((i === 0 && customers === 'firstColumn') ||
                          (col?.key === 'cust_name' && customers === 'column'));
                      const linkInvoice = invoiceId && col?.key === 'doc_num';
                      return (
                        <ValueCell
                          key={i}
                          col={col}
                          cell={cell}
                          style={i === 0 ? indent(line.depth) : undefined}
                          href={
                            linkName
                              ? `/billing/${encodeURIComponent(sn)}`
                              : linkInvoice
                                ? `/billing/${encodeURIComponent(sn!)}/invoices/${encodeURIComponent(invoiceId!)}`
                                : null
                          }
                        />
                      );
                    })}
                  </TableRow>
                );
              }
              if (line.kind === 'summary')
                return (
                  <TableRow
                    key={`s${line.section.key}`}
                    className="border-t border-border"
                  >
                    {line.cells.map((cell, i) => (
                      <ValueCell
                        key={i}
                        col={cols[i]}
                        cell={cell}
                        strong
                        prefix={i === lastMoney}
                        style={i === 0 ? indent(line.depth) : undefined}
                      />
                    ))}
                  </TableRow>
                );
              return (
                <TableRow
                  key="total"
                  className="border-t-2 border-b-4 border-double border-foreground/30 hover:bg-transparent"
                >
                  {line.cells.map((cell, i) => (
                    <ValueCell
                      key={i}
                      col={cols[i]}
                      cell={cell}
                      strong
                      prefix={i === lastMoney}
                      style={i === 0 ? indent(0) : undefined}
                    />
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <p className="border-t border-border px-6 py-3 text-center text-xs text-muted-foreground">
        Read from QuickBooks {readAt}
      </p>
    </Card>
  );
}

function NameLink({
  sn,
  children,
}: {
  sn: string | null;
  children: React.ReactNode;
}) {
  if (!sn) return <>{children}</>;
  return (
    <Link
      href={`/billing/${encodeURIComponent(sn)}`}
      className="text-primary underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

function ValueCell({
  col,
  cell,
  strong,
  prefix,
  href,
  style,
}: {
  col: ReportColumn | undefined;
  cell: ReportCell;
  strong?: boolean;
  /** Totals print the currency on their last amount: "S$920.00". */
  prefix?: boolean;
  href?: string | null;
  style?: React.CSSProperties;
}) {
  const kind = col?.kind ?? 'text';
  let text = cell.value;
  if (kind === 'money') {
    text = formatReportMoney(cell.value);
    if (prefix && text)
      text = text.startsWith('-') ? `-S$${text.slice(1)}` : `S$${text}`;
  } else if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(cell.value)) {
    text = formatDay(cell.value);
  }
  return (
    <TableCell
      style={style}
      title={kind === 'text' && text.length > 30 ? text : undefined}
      className={cn(
        'py-1.5 whitespace-nowrap',
        kind === 'money' && 'text-right tabular-nums',
        kind === 'date' && 'tabular-nums',
        kind === 'text' && 'max-w-72 truncate',
        strong && 'font-semibold'
      )}
    >
      {href && text ? (
        <Link
          href={href}
          className="text-primary underline-offset-4 hover:underline"
        >
          {text}
        </Link>
      ) : (
        text
      )}
    </TableCell>
  );
}
