/**
 * Copies HFSE's production Products & services list into the QuickBooks
 * SANDBOX: every product with its type, category, SKU, rates, descriptions,
 * income / expense / inventory accounts (made as the same sub-accounts) and
 * preferred supplier. Discounts come too — HFSE gives a discount as its own
 * product with a minus rate (Sibling Discount, Other Discounts…).
 *
 *   npx tsx --conditions=react-server --env-file=.env.development.local \
 *     scripts/qbo/seed-sandbox-products.ts <ProductsServicesList….csv> [--apply]
 *
 * The CSV is QuickBooks' Products & services export (kept outside git). Dry
 * run by default; --apply writes. Idempotent: accounts, categories, suppliers
 * and products are found by their full name first and left as they are.
 * Bundles are not copied: the export does not list what is in a bundle.
 * Refuses to run unless the SIS is connected to a SANDBOX company and
 * Supabase is localhost.
 */
import { readFileSync } from 'node:fs';

import { qboErrorMessage, qboQueryAll, qboRequest } from '@/lib/qbo/client';
import { createServiceClient } from '@/lib/supabase/service';

const service = createServiceClient();
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const file = argv.find((a) => !a.startsWith('--'));

type Ref = { value: string; name?: string };
type Named = {
  Id: string;
  SyncToken?: string;
  Type?: string;
  AccountType?: string;
  AccountSubType?: string;
  Name?: string;
  DisplayName?: string;
  FullyQualifiedName?: string;
};

async function guard() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  if (!/localhost|127\.0\.0\.1/.test(url))
    throw new Error('Refusing: Supabase is not the local stack.');
  const { data } = await service
    .from('qbo_connection')
    .select('environment')
    .eq('id', 1)
    .maybeSingle();
  if (data?.environment !== 'sandbox')
    throw new Error('Refusing: the SIS is not connected to a sandbox company.');
}

/** QuickBooks' CSV export: quoted fields, "" for a quote, CRLF rows. */
function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      out.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

type Product = {
  name: string;
  qty: number;
  type: string;
  category: string;
  sku: string;
  purchaseTaxIncluded: boolean;
  salesTaxIncluded: boolean;
  price: number | null;
  cost: number | null;
  income: string;
  expense: string;
  asset: string;
  salesDesc: string;
  purchaseDesc: string;
  reorder: number | null;
  supplier: string;
};

function readProducts(path: string): Product[] {
  const [head, ...rows] = csvRows(readFileSync(path, 'utf8'));
  const at = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`The file has no "${name}" column.`);
    return i;
  };
  const c = {
    name: at('Product/Service Name'),
    qty: at('Quantity on hand'),
    type: at('Item type'),
    category: at('Category'),
    sku: at('SKU'),
    pIncl: at('Purchase cost includes tax'),
    sIncl: at('Sales price includes tax'),
    price: at('Price'),
    cost: at('Cost'),
    income: at('Income Account'),
    expense: at('Expense Account'),
    asset: at('Inventory asset account'),
    sDesc: at('Sales Description'),
    pDesc: at('Purchase Description'),
    reorder: at('Reorder Point'),
    supplier: at('Preferred Supplier'),
  };
  const num = (s: string) =>
    s.trim() === '' ? null : Number(s.replace(/,/g, ''));
  return rows
    .filter((r) => r[c.name]?.trim())
    .map((r) => ({
      name: r[c.name].trim(),
      qty: num(r[c.qty]) ?? 0,
      type: r[c.type],
      category: r[c.category].trim(),
      sku: r[c.sku].trim(),
      purchaseTaxIncluded: r[c.pIncl] === 'Yes',
      salesTaxIncluded: r[c.sIncl] === 'Yes',
      price: num(r[c.price]),
      cost: num(r[c.cost]),
      income: r[c.income].trim(),
      expense: r[c.expense].trim(),
      asset: r[c.asset].trim(),
      salesDesc: r[c.sDesc],
      purchaseDesc: r[c.pDesc],
      reorder: num(r[c.reorder]),
      supplier: r[c.supplier].trim(),
    }));
}

const key = (s: string) => s.trim().toLowerCase();
const stats = { created: 0, kept: 0, failed: [] as string[] };

async function create<T extends Named>(
  entity: 'Account' | 'Item' | 'Vendor',
  label: string,
  body: Record<string, unknown>
): Promise<T | null> {
  if (!apply) {
    console.log(`  would add ${entity} ${label}`);
    stats.created++;
    return { Id: `dry:${label}` } as T;
  }
  const res = await qboRequest<Record<string, T>>(
    service,
    'POST',
    `/${entity.toLowerCase()}`,
    body
  );
  console.log(`  + ${entity} ${label}`);
  stats.created++;
  return res[entity];
}

// Account types by HFSE's account names (the export gives names only).
function accountType(kind: 'income' | 'expense' | 'asset', fqn: string) {
  if (kind === 'asset')
    return { AccountType: 'Other Current Asset', AccountSubType: 'Inventory' };
  if (kind === 'expense')
    // An inventory product's cost account must be Cost of Goods Sold with
    // detail type Supplies and Materials (QuickBooks refuses any other).
    return /^cost of/i.test(fqn)
      ? {
          AccountType: 'Cost of Goods Sold',
          AccountSubType: 'SuppliesMaterialsCogs',
        }
      : { AccountType: 'Expense' };
  if (/^current liabilities|^deferred income|^advance customers/i.test(fqn))
    return { AccountType: 'Other Current Liability' };
  if (/^discounts given/i.test(fqn))
    return { AccountType: 'Income', AccountSubType: 'DiscountsRefundsGiven' };
  return { AccountType: 'Income' };
}

async function main() {
  if (!file)
    throw new Error(
      'Pass the Products & services export (.csv) as the first argument.'
    );
  await guard();
  const products = readProducts(file);
  console.log(
    `${products.length} products in ${file}${apply ? '' : ' (dry run)'}`
  );

  // Accounts, made as the same sub-accounts ("Parent:Child").
  const accounts = new Map(
    (await qboQueryAll<Named>(service, 'Account')).map((a) => [
      key(a.FullyQualifiedName ?? a.Name ?? ''),
      a,
    ])
  );
  async function account(
    kind: 'income' | 'expense' | 'asset',
    fqn: string
  ): Promise<Ref | null> {
    if (!fqn) return null;
    const parts = fqn.split(':');
    let parent: Named | null = null;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join(':');
      let a: Named | null | undefined = accounts.get(key(path));
      if (!a) {
        a = await create<Named>('Account', path, {
          Name: parts[i],
          ...accountType(kind, fqn),
          ...(parent
            ? { SubAccount: true, ParentRef: { value: parent.Id } }
            : {}),
        });
        if (!a) return null;
        accounts.set(key(path), a);
      }
      parent = a;
    }
    return parent ? { value: parent.Id } : null;
  }

  console.log('Accounts');
  const acc = {
    income: new Map<string, Ref | null>(),
    expense: new Map<string, Ref | null>(),
    asset: new Map<string, Ref | null>(),
  };
  for (const p of products)
    for (const kind of ['income', 'expense', 'asset'] as const) {
      const name = p[kind];
      if (name && !acc[kind].has(name))
        acc[kind].set(name, await account(kind, name));
    }
  const fallbackIncome = await account('income', 'Sales of Product Revenue');
  const fallbackAsset = await account('asset', 'Inventory Asset');
  const fallbackCogs = await account('expense', 'Cost of sales');

  // Cost of Goods Sold accounts an earlier run made without the detail type
  // inventory products need.
  for (const a of accounts.values())
    if (
      a.AccountType === 'Cost of Goods Sold' &&
      a.AccountSubType !== 'SuppliesMaterialsCogs' &&
      /^cost of/i.test(a.FullyQualifiedName ?? '')
    ) {
      if (apply) {
        const res = await qboRequest<{ Account: Named }>(
          service,
          'POST',
          '/account',
          {
            Id: a.Id,
            SyncToken: a.SyncToken,
            sparse: true,
            Name: a.Name,
            AccountSubType: 'SuppliesMaterialsCogs',
          }
        );
        Object.assign(a, res.Account);
      }
      console.log(
        `  ~ Account ${a.FullyQualifiedName}: Supplies and Materials`
      );
    }
  // An inventory product's income account must be Income with detail type
  // Sales of Product Income: set it on the ones inventory products use.
  const byId = (r: Ref | null) =>
    r ? [...accounts.values()].find((a) => a.Id === r.value) : undefined;
  const productIncome = new Set(
    products
      .filter((p) => p.type === 'Inventory')
      .map((p) => acc.income.get(p.income) ?? fallbackIncome)
      .map((r) => byId(r))
      .filter((a): a is Named => a?.AccountType === 'Income')
  );
  for (const a of productIncome)
    if (a.AccountSubType !== 'SalesOfProductIncome') {
      if (apply) {
        const res = await qboRequest<{ Account: Named }>(
          service,
          'POST',
          '/account',
          {
            Id: a.Id,
            SyncToken: a.SyncToken,
            sparse: true,
            Name: a.Name,
            AccountSubType: 'SalesOfProductIncome',
          }
        );
        Object.assign(a, res.Account);
      }
      console.log(
        `  ~ Account ${a.FullyQualifiedName}: Sales of Product Income`
      );
    }
  const isProductIncome = (r: Ref | null) =>
    byId(r)?.AccountSubType === 'SalesOfProductIncome' || (!apply && !!r);
  const isCogs = (r: Ref | null) =>
    !!r &&
    [...accounts.values()].some(
      (a) => a.Id === r.value && a.AccountType === 'Cost of Goods Sold'
    );

  // Items: one list, as QuickBooks names must be unique across all items.
  const items = new Map(
    (await qboQueryAll<Named>(service, 'Item')).map((i) => [
      key(i.FullyQualifiedName ?? i.Name ?? ''),
      i,
    ])
  );
  const names = new Set([...items.values()].map((i) => key(i.Name ?? '')));

  console.log('Categories');
  const categories = new Map<string, Ref>();
  for (const fqn of new Set(products.map((p) => p.category).filter(Boolean))) {
    const parts = fqn.split(':');
    let parent: Named | null = null;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join(':');
      const isCat = (x: Named | undefined) =>
        x && x.Type === 'Category' ? x : undefined;
      let c: Named | null | undefined = isCat(items.get(key(path)));
      if (!c) {
        // A category may not share a name with a product (HFSE has a
        // "Tuition Fees" category and product).
        const clash =
          i === 0 && products.some((p) => key(p.name) === key(parts[i]));
        const name = clash ? `${parts[i]} (category)` : parts[i];
        c = isCat(items.get(key(parts.slice(0, i).concat(name).join(':'))));
        if (!c) {
          try {
            c = await create<Named>('Item', path, {
              Name: name,
              Type: 'Category',
              ...(parent
                ? { SubItem: true, ParentRef: { value: parent.Id } }
                : {}),
            });
          } catch (e) {
            stats.failed.push(`Category ${path}: ${qboErrorMessage(e)}`);
            break;
          }
          if (!c) break;
          items.set(key(path), c);
        }
      }
      parent = c;
    }
    if (parent) categories.set(fqn, { value: parent.Id });
  }

  console.log('Suppliers');
  const vendors = new Map(
    (await qboQueryAll<Named>(service, 'Vendor')).map((v) => [
      key(v.DisplayName ?? ''),
      v,
    ])
  );
  const supplier = new Map<string, Ref>();
  for (const name of new Set(products.map((p) => p.supplier).filter(Boolean))) {
    let v: Named | null | undefined = vendors.get(key(name));
    if (!v) {
      try {
        v = await create<Named>('Vendor', name, { DisplayName: name });
      } catch (e) {
        stats.failed.push(`Supplier ${name}: ${qboErrorMessage(e)}`);
      }
    }
    if (v) supplier.set(name, { value: v.Id });
  }

  console.log('Products');
  const skipped: string[] = [];
  for (const p of products) {
    if (p.type === 'Bundle') {
      skipped.push(p.name);
      continue;
    }
    if (names.has(key(p.name))) {
      stats.kept++;
      continue;
    }
    const type =
      p.type === 'Inventory'
        ? 'Inventory'
        : p.type === 'Non-Inventory'
          ? 'NonInventory'
          : 'Service';
    let income = acc.income.get(p.income) ?? null;
    let expense = acc.expense.get(p.expense) ?? null;
    const cat = p.category ? categories.get(p.category) : undefined;
    const body: Record<string, unknown> = {
      Name: p.name,
      Type: type,
      ...(p.sku ? { Sku: p.sku } : {}),
      ...(p.salesDesc ? { Description: p.salesDesc.slice(0, 4000) } : {}),
      ...(p.purchaseDesc
        ? { PurchaseDesc: p.purchaseDesc.slice(0, 1000) }
        : {}),
      ...(p.price != null ? { UnitPrice: p.price } : {}),
      ...(p.cost != null ? { PurchaseCost: p.cost } : {}),
      SalesTaxIncluded: p.salesTaxIncluded,
      PurchaseTaxIncluded: p.purchaseTaxIncluded,
      ...(cat ? { SubItem: true, ParentRef: cat } : {}),
      ...(supplier.get(p.supplier)
        ? { PrefVendorRef: supplier.get(p.supplier) }
        : {}),
    };
    if (type === 'Inventory') {
      if (!isProductIncome(income)) income = fallbackIncome;
      // "Office Costs:Purchases" is an expense account; QuickBooks needs
      // Cost of Goods Sold on an inventory product.
      if (!isCogs(expense)) expense = fallbackCogs;
      Object.assign(body, {
        TrackQtyOnHand: true,
        QtyOnHand: Math.max(0, p.qty),
        InvStartDate: '2025-01-01',
        AssetAccountRef: acc.asset.get(p.asset) ?? fallbackAsset,
        ...(p.reorder != null ? { ReorderPoint: p.reorder } : {}),
      });
    }
    if (!income && !expense) income = fallbackIncome;
    if (income) body.IncomeAccountRef = income;
    if (expense) body.ExpenseAccountRef = expense;
    try {
      await create('Item', p.name, body);
    } catch (e) {
      // Retry once without what a sandbox commonly refuses (tax-inclusive
      // flags without tax codes; an expense-only product).
      try {
        delete body.SalesTaxIncluded;
        delete body.PurchaseTaxIncluded;
        body.IncomeAccountRef ??= fallbackIncome;
        await create('Item', p.name, body);
      } catch (e2) {
        stats.failed.push(
          `${p.name}: ${qboErrorMessage(e2)} (first: ${qboErrorMessage(e)})`
        );
      }
    }
    names.add(key(p.name));
  }

  console.log(
    `\nDone${apply ? '' : ' (dry run — nothing written)'}: ${stats.created} added, ${stats.kept} products already there, ${skipped.length} bundles not copied, ${stats.failed.length} failed.`
  );
  if (skipped.length) console.log(`Bundles: ${skipped.join(' · ')}`);
  for (const f of stats.failed) console.log(`  ! ${f}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
