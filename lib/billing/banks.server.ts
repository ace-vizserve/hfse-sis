import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  BANK_LEDGER_COLUMNS,
  parseBankLedger,
  type BankLedger,
} from '@/lib/billing/bank-ledger';
import { qboQueryAll, qboRequest } from '@/lib/qbo/client';

// Billing → Bank accounts. QuickBooks' active Bank accounts with the balance
// QuickBooks shows for each, and one account's transactions for a period,
// both read live (a wrapper: the figures are QuickBooks').

export type BankAccount = {
  id: string;
  name: string;
  /** QuickBooks' balance for this account alone (a sub-account is listed
   *  on its own), matching its transactions below. */
  balance: number;
};

export async function loadBankAccounts(
  service: SupabaseClient
): Promise<BankAccount[]> {
  const rows = await qboQueryAll<{
    Id: string;
    Name: string;
    FullyQualifiedName?: string;
    CurrentBalance?: number;
  }>(service, 'Account', "AccountType = 'Bank' AND Active = true");
  return rows
    .map((a) => ({
      id: a.Id,
      name: a.FullyQualifiedName ?? a.Name,
      balance: Number(a.CurrentBalance ?? 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readBankLedger(
  service: SupabaseClient,
  accountId: string,
  from: string,
  to: string
): Promise<BankLedger> {
  const q = new URLSearchParams({
    account: accountId,
    start_date: from,
    end_date: to,
    columns: BANK_LEDGER_COLUMNS.join(','),
    sort_order: 'ascend',
  });
  const json = await qboRequest<unknown>(
    service,
    'GET',
    `/reports/GeneralLedger?${q.toString()}`
  );
  return parseBankLedger(json);
}
