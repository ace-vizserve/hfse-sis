import { describe, expect, it } from 'vitest';

import {
  accountRows,
  detailTypeName,
  filterAccounts,
  type QbAccount,
} from '@/lib/billing/accounts';

const acct = (
  a: Partial<QbAccount> & { Id: string; Name: string }
): QbAccount => ({
  Classification: 'Asset',
  AccountType: 'Bank',
  AccountSubType: 'Checking',
  CurrentBalance: 0,
  CurrentBalanceWithSubAccounts: 0,
  ...a,
});

const list: QbAccount[] = [
  acct({
    Id: '1',
    Name: 'Sales',
    Classification: 'Revenue',
    AccountType: 'Income',
    AccountSubType: 'SalesOfProductIncome',
    CurrentBalance: 999,
  }),
  acct({
    Id: '2',
    Name: 'UOB',
    AccountSubType: 'CashOnHand',
    CurrentBalance: 48650,
  }),
  acct({ Id: '3', Name: 'Checking', CurrentBalance: 2001, AcctNum: '1000' }),
  acct({
    Id: '4',
    Name: 'Truck',
    AccountType: 'Fixed Asset',
    AccountSubType: 'Vehicles',
    CurrentBalance: 0,
    CurrentBalanceWithSubAccounts: 13495,
  }),
  acct({
    Id: '5',
    Name: 'Original Cost',
    AccountType: 'Fixed Asset',
    SubAccount: true,
    ParentRef: { value: '4' },
    FullyQualifiedName: 'Truck:Original Cost',
    CurrentBalance: 13495,
  }),
  acct({
    Id: '6',
    Name: 'Depreciation',
    AccountType: 'Fixed Asset',
    AccountSubType: 'AccumulatedDepreciation',
    SubAccount: true,
    ParentRef: { value: '4' },
    FullyQualifiedName: 'Truck:Depreciation',
    CurrentBalance: 0,
  }),
  acct({
    Id: '7',
    Name: 'Accounts Receivable (A/R)',
    AccountType: 'Accounts Receivable',
    AccountSubType: 'AccountsReceivable',
    CurrentBalance: 73151.52,
  }),
];

describe('accountRows', () => {
  it('orders by QuickBooks account type, then name, sub-accounts under their parent', () => {
    const rows = accountRows(list);
    expect(rows.map((r) => `${r.depth}:${r.name}`)).toEqual([
      '0:Checking',
      '0:UOB',
      '0:Accounts Receivable (A/R)',
      '0:Truck',
      '1:Depreciation',
      '1:Original Cost',
      '0:Sales',
    ]);
  });

  it('names types and detail types as QuickBooks’ page does', () => {
    const rows = accountRows(list);
    const ar = rows.find((r) => r.id === '7')!;
    expect(ar.typeLabel).toBe('Accounts receivable (A/R)');
    expect(ar.detailType).toBe('Accounts Receivable (A/R)');
    expect(rows.find((r) => r.id === '2')!.detailType).toBe('Cash on hand');
    expect(detailTypeName('AccumulatedDepreciation')).toBe(
      'Accumulated Depreciation'
    );
  });

  it('shows a parent’s balance with its sub-accounts, and none for income', () => {
    const rows = accountRows(list);
    expect(rows.find((r) => r.id === '4')!.balance).toBe(13495);
    expect(rows.find((r) => r.id === '1')!.balance).toBeNull();
  });
});

describe('filterAccounts', () => {
  const rows = accountRows(list);
  it('filters by name, full name or number, and by type', () => {
    expect(filterAccounts(rows, 'truck', 'all').map((r) => r.id)).toEqual([
      '4',
      '6',
      '5',
    ]);
    expect(filterAccounts(rows, '1000', 'all').map((r) => r.id)).toEqual(['3']);
    expect(filterAccounts(rows, '', 'Bank').map((r) => r.id)).toEqual([
      '3',
      '2',
    ]);
    expect(filterAccounts(rows, 'uob', 'Income')).toEqual([]);
  });
});
