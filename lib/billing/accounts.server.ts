import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  accountRows,
  type AccountRow,
  type QbAccount,
} from '@/lib/billing/accounts';
import { qboQueryAll } from '@/lib/qbo/client';

/** QuickBooks' active accounts, read live, in its Chart of accounts order. */
export async function loadChartOfAccounts(
  service: SupabaseClient
): Promise<AccountRow[]> {
  const list = await qboQueryAll<QbAccount>(
    service,
    'Account',
    'Active = true'
  );
  return accountRows(list);
}
