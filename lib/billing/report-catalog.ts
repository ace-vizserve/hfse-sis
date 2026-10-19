import type { CustomerSource } from '@/lib/billing/report';

// Billing → Reports: the QuickBooks reports the SIS opens, named and grouped
// as QuickBooks' Standard reports list names them. Each one was checked
// against the Reports API (2026-10-19); QuickBooks reports the API cannot
// produce (Collections Report, Invoices and Received Payments, Statement
// List, Terms List, Unbilled charges) are listed in QB_ONLY_REPORTS and open
// in QuickBooks.

export type ReportDef = {
  key: string;
  /** The name in QuickBooks' Standard reports list. */
  title: string;
  /** The title QuickBooks prints on the report itself. */
  paperTitle: string;
  group: 'Who owes you' | 'For my accountant';
  /** One line for the list. */
  blurb: string;
  endpoint: string;
  /** "As of" a date, or a From–To period. */
  period: 'asOf' | 'range';
  /** Fixed query parameters (e.g. the columns QuickBooks' page shows). */
  params?: Record<string, string>;
  customers: CustomerSource;
  /** Detail reports print "(n)" after each group's name. */
  countInHeader: boolean;
};

export const REPORTS: ReportDef[] = [
  {
    key: 'aging-summary',
    title: 'Accounts receivable aging summary',
    paperTitle: 'A/R Aging Summary Report',
    group: 'Who owes you',
    blurb: 'What each customer owes, by how long past due.',
    endpoint: 'AgedReceivables',
    period: 'asOf',
    customers: 'firstColumn',
    countInHeader: false,
  },
  {
    key: 'aging-detail',
    title: 'Accounts receivable aging detail',
    paperTitle: 'A/R Aging Detail Report',
    group: 'Who owes you',
    blurb: 'Every unpaid invoice, grouped by how long past due.',
    endpoint: 'AgedReceivableDetail',
    period: 'asOf',
    customers: 'column',
    countInHeader: true,
  },
  {
    key: 'customer-balance-summary',
    title: 'Customer Balance Summary',
    paperTitle: 'Customer Balance Summary',
    group: 'Who owes you',
    blurb: 'Each customer’s balance, one line each.',
    endpoint: 'CustomerBalance',
    period: 'asOf',
    customers: 'firstColumn',
    countInHeader: false,
  },
  {
    key: 'customer-balance-detail',
    title: 'Customer Balance Detail',
    paperTitle: 'Customer Balance Detail',
    group: 'Who owes you',
    blurb: 'The open invoices and payments behind each balance.',
    endpoint: 'CustomerBalanceDetail',
    period: 'asOf',
    customers: 'section',
    countInHeader: true,
  },
  {
    // QuickBooks' Open Invoices report has no API endpoint of its own; it is
    // Customer Balance Detail with the Open Invoices columns.
    key: 'open-invoices',
    title: 'Open Invoices',
    paperTitle: 'Open Invoices Report',
    group: 'Who owes you',
    blurb: 'Invoices not yet fully paid, by customer.',
    endpoint: 'CustomerBalanceDetail',
    period: 'asOf',
    params: {
      columns: 'tx_date,txn_type,doc_num,term_name,due_date,subt_open_bal',
    },
    customers: 'section',
    countInHeader: true,
  },
  {
    key: 'general-ledger',
    title: 'General Ledger',
    paperTitle: 'General Ledger',
    group: 'For my accountant',
    blurb: 'Every transaction, account by account, with its running balance.',
    endpoint: 'GeneralLedger',
    period: 'range',
    params: { sort_order: 'ascend' },
    customers: 'none',
    countInHeader: true,
  },
];

export const REPORT_GROUPS: ReportDef['group'][] = [
  'Who owes you',
  'For my accountant',
];

/** QuickBooks' own order of its Standard reports list (2026-10-19), which
 *  is not alphabetical; a report not in it goes last. */
export const QB_LIST_ORDER = [
  'Accounts receivable aging summary',
  'Accounts receivable aging detail',
  'Collections Report',
  'Customer Balance Summary',
  'Customer Balance Detail',
  'Invoice List',
  'Invoices and Received Payments',
  'Open Invoices',
  'Statement List',
  'Terms List',
  'Unbilled charges',
  'Unbilled time',
  'General Ledger',
];

/** The rest of QuickBooks' "Who owes you" list (2026-10-19). The Reports API
 *  can't produce these, so the list opens them in QuickBooks. */
export const QB_ONLY_REPORTS: Array<{
  title: string;
  group: ReportDef['group'];
}> = [
  { title: 'Collections Report', group: 'Who owes you' },
  { title: 'Invoice List', group: 'Who owes you' },
  { title: 'Invoices and Received Payments', group: 'Who owes you' },
  { title: 'Statement List', group: 'Who owes you' },
  { title: 'Terms List', group: 'Who owes you' },
  { title: 'Unbilled charges', group: 'Who owes you' },
  { title: 'Unbilled time', group: 'Who owes you' },
];

export function reportDef(key: string): ReportDef | null {
  return REPORTS.find((r) => r.key === key) ?? null;
}
