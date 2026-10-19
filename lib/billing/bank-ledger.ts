// One bank account's transactions as QuickBooks' own General Ledger report
// shows them (`/reports/GeneralLedger?account=…`): every line with its
// running balance, plus the "Beginning Balance" line for the period. Pure
// parser — the figures are QuickBooks', the SIS adds none up beyond the
// period's money in / money out.

export type BankLedgerRow = {
  /** Position in the report — a transaction can appear on two lines. */
  key: string;
  date: string;
  type: string;
  txnId: string | null;
  number: string | null;
  name: string | null;
  memo: string | null;
  /** The other account of the transaction (QuickBooks' "Split"). */
  split: string | null;
  amount: number;
  balance: number | null;
};

export type BankLedger = {
  /** QuickBooks' balance at the start of the period; null when it gave none. */
  opening: number | null;
  rows: BankLedgerRow[];
  moneyIn: number;
  moneyOut: number;
  /** The running balance after the period's last line, else the opening. */
  closing: number | null;
};

/** The `columns` the page asks QuickBooks for, in order. */
export const BANK_LEDGER_COLUMNS = [
  'tx_date',
  'txn_type',
  'doc_num',
  'name',
  'memo',
  'split_acc',
  'subt_nat_amount',
  'rbal_nat_amount',
] as const;

type Col = { value?: string; id?: string };
type Row = {
  type?: string;
  ColData?: Col[];
  Rows?: { Row?: Row[] };
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: string | undefined): number | null => {
  const s = (v ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const text = (v: string | undefined) => (v ?? '').trim() || null;

export function parseBankLedger(json: unknown): BankLedger {
  const j = (json ?? {}) as {
    Columns?: {
      Column?: Array<{ MetaData?: Array<{ Name?: string; Value?: string }> }>;
    };
    Rows?: { Row?: Row[] };
  };
  const keys = (j.Columns?.Column ?? []).map(
    (c) => c.MetaData?.find((m) => m.Name === 'ColKey')?.Value ?? ''
  );
  const at = (k: string) => keys.indexOf(k);
  const iDate = at('tx_date');
  const iType = at('txn_type');
  const iNum = at('doc_num');
  const iName = at('name');
  const iMemo = at('memo');
  const iSplit = at('split_acc');
  const iAmount = at('subt_nat_amount');
  const iBal = at('rbal_nat_amount');

  const out: BankLedger = {
    opening: null,
    rows: [],
    moneyIn: 0,
    moneyOut: 0,
    closing: null,
  };
  if (iDate < 0 || iAmount < 0) return out;

  const walk = (rows: Row[]) => {
    for (const r of rows) {
      const c = r.ColData;
      if (c?.length && r.type === 'Data') {
        const first = (c[iDate]?.value ?? '').trim();
        if (first === 'Beginning Balance') {
          if (out.opening === null && iBal >= 0)
            out.opening = money(c[iBal]?.value);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
          const amount = money(c[iAmount]?.value) ?? 0;
          out.rows.push({
            key: String(out.rows.length),
            date: first,
            type: text(c[iType]?.value) ?? '—',
            txnId: text(c[iType]?.id),
            number: iNum >= 0 ? text(c[iNum]?.value) : null,
            name: iName >= 0 ? text(c[iName]?.value) : null,
            memo: iMemo >= 0 ? text(c[iMemo]?.value) : null,
            split: iSplit >= 0 ? text(c[iSplit]?.value) : null,
            amount,
            balance: iBal >= 0 ? money(c[iBal]?.value) : null,
          });
          if (amount > 0) out.moneyIn += amount;
          else out.moneyOut -= amount;
        }
      }
      if (r.Rows?.Row) walk(r.Rows.Row);
    }
  };
  walk(j.Rows?.Row ?? []);

  out.moneyIn = r2(out.moneyIn);
  out.moneyOut = r2(out.moneyOut);
  // No "Beginning Balance" line means the period starts before the account's
  // first transaction: it opened at zero.
  if (out.opening === null && out.rows.length > 0) out.opening = 0;
  out.closing = out.rows.at(-1)?.balance ?? out.opening;
  return out;
}
