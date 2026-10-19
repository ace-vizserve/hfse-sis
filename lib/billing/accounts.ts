// Billing → Chart of accounts: QuickBooks' accounts in QuickBooks' order —
// by account type (Bank first, as its page lists them), then name, each
// sub-account straight under its parent. Pure.

export type QbAccount = {
  Id: string;
  Name: string;
  AcctNum?: string;
  SubAccount?: boolean;
  ParentRef?: { value?: string };
  FullyQualifiedName?: string;
  Classification?: string;
  AccountType?: string;
  AccountSubType?: string;
  CurrentBalance?: number;
  CurrentBalanceWithSubAccounts?: number;
};

export type AccountRow = {
  id: string;
  name: string;
  number: string | null;
  /** Sub-account depth: 0 for a top-level account. */
  depth: number;
  fullName: string;
  /** QuickBooks' API type ("Bank", "Accounts Receivable", …). */
  type: string;
  /** The type as QuickBooks' page names it ("Accounts receivable (A/R)"). */
  typeLabel: string;
  detailType: string;
  /** QuickBooks balance (a parent's includes its sub-accounts). Null for
   *  income and expense accounts, which QuickBooks shows without one. */
  balance: number | null;
};

/** QuickBooks' account types in the order its Chart of accounts lists
 *  them, with the name its page uses. */
export const ACCOUNT_TYPES: Array<{ type: string; label: string }> = [
  { type: 'Bank', label: 'Bank' },
  { type: 'Accounts Receivable', label: 'Accounts receivable (A/R)' },
  { type: 'Other Current Asset', label: 'Other Current Assets' },
  { type: 'Fixed Asset', label: 'Fixed Assets' },
  { type: 'Other Asset', label: 'Other Assets' },
  { type: 'Accounts Payable', label: 'Accounts payable (A/P)' },
  { type: 'Credit Card', label: 'Credit Card' },
  { type: 'Other Current Liability', label: 'Other Current Liabilities' },
  { type: 'Long Term Liability', label: 'Long Term Liabilities' },
  { type: 'Equity', label: 'Equity' },
  { type: 'Income', label: 'Income' },
  { type: 'Cost of Goods Sold', label: 'Cost of Goods Sold' },
  { type: 'Expense', label: 'Expenses' },
  { type: 'Other Income', label: 'Other Income' },
  { type: 'Other Expense', label: 'Other Expense' },
];

const TYPE_RANK = new Map(ACCOUNT_TYPES.map((t, i) => [t.type, i]));
const TYPE_LABEL = new Map(ACCOUNT_TYPES.map((t) => [t.type, t.label]));

const DETAIL_NAMES: Record<string, string> = {
  CashOnHand: 'Cash on hand',
  AccountsReceivable: 'Accounts Receivable (A/R)',
  AccountsPayable: 'Accounts Payable (A/P)',
  RentOrLeaseOfBuildings: 'Rent or Lease of Buildings',
  OfficeGeneralAdministrativeExpenses: 'Office/General Administrative Expenses',
  LegalProfessionalFees: 'Legal & Professional Fees',
  RepairMaintenance: 'Repair & Maintenance',
  AdvertisingPromotional: 'Advertising/Promotional',
  DuesSubscriptions: 'Dues & subscriptions',
  TravelMeals: 'Travel Meals',
  SuppliesMaterialsCogs: 'Supplies & Materials - COGS',
  SuppliesMaterials: 'Supplies & Materials',
  DiscountsRefundsGiven: 'Discounts/Refunds Given',
  PenaltiesSettlements: 'Penalties & Settlements',
  GlobalTaxPayable: 'Global Tax Payable',
};

/** "CashOnHand" → "Cash on hand"; unknown ones split at capitals. */
export function detailTypeName(sub: string | undefined): string {
  const s = (sub ?? '').trim();
  if (!s) return '';
  return DETAIL_NAMES[s] ?? s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Balance-sheet accounts carry a balance on QuickBooks' page. */
const hasBalance = (c: string | undefined) =>
  c === 'Asset' || c === 'Liability' || c === 'Equity';

export function accountRows(list: QbAccount[]): AccountRow[] {
  const byParent = new Map<string, QbAccount[]>();
  const ids = new Set(list.map((a) => a.Id));
  const roots: QbAccount[] = [];
  for (const a of list) {
    const p = a.SubAccount ? a.ParentRef?.value : undefined;
    if (p && ids.has(p)) {
      const kids = byParent.get(p) ?? [];
      kids.push(a);
      byParent.set(p, kids);
    } else roots.push(a);
  }
  const byName = (a: QbAccount, b: QbAccount) =>
    a.Name.localeCompare(b.Name, 'en', { sensitivity: 'base' });
  roots.sort(
    (a, b) =>
      (TYPE_RANK.get(a.AccountType ?? '') ?? 99) -
        (TYPE_RANK.get(b.AccountType ?? '') ?? 99) || byName(a, b)
  );
  const out: AccountRow[] = [];
  const add = (a: QbAccount, depth: number) => {
    const kids = (byParent.get(a.Id) ?? []).sort(byName);
    const type = a.AccountType ?? '';
    out.push({
      id: a.Id,
      name: a.Name,
      number: a.AcctNum?.trim() || null,
      depth,
      fullName: a.FullyQualifiedName ?? a.Name,
      type,
      typeLabel: TYPE_LABEL.get(type) ?? type,
      detailType: detailTypeName(a.AccountSubType),
      balance: hasBalance(a.Classification)
        ? Number(
            (kids.length
              ? a.CurrentBalanceWithSubAccounts
              : a.CurrentBalance) ?? 0
          )
        : null,
    });
    for (const k of kids) add(k, depth + 1);
  };
  for (const r of roots) add(r, 0);
  return out;
}

/** "Filter by name or number" plus the account-type choice. A sub-account
 *  matches on its full name ("Truck:Depreciation"), so typing the parent
 *  keeps its sub-accounts with it. */
export function filterAccounts(
  rows: AccountRow[],
  q: string,
  type: string
): AccountRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (type === 'all' || r.type === type) &&
      (!needle ||
        r.fullName.toLowerCase().includes(needle) ||
        (r.number ?? '').toLowerCase().includes(needle))
  );
}
