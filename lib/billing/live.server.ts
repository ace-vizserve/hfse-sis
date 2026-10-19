import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  parseAgedReceivables,
  parseAgingReport,
  type AgingReport,
  type AgingRow,
} from '@/lib/billing/aging';
import { todaySg } from '@/lib/billing/view';
import { qbEscape, qboQuery, qboQueryAll, qboRequest } from '@/lib/qbo/client';
import { invoiceState, type QbInvoice } from '@/lib/qbo/invoice-snapshot';

// Read straight from QuickBooks, never from the stored copy: the figures and
// details a person expects to match QuickBooks exactly (customer profile and
// balance, A/R aging, one invoice in full). Each call is one or two requests.

export type QbAddress = {
  Line1?: string;
  Line2?: string;
  Line3?: string;
  Line4?: string;
  Line5?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
};

/** An address as the lines QuickBooks prints. */
export function addressLines(a?: QbAddress | null): string[] {
  if (!a) return [];
  const lines = [a.Line1, a.Line2, a.Line3, a.Line4, a.Line5]
    .map((l) => l?.trim())
    .filter((l): l is string => !!l);
  const place = [a.City, a.CountrySubDivisionCode, a.PostalCode]
    .map((x) => x?.trim())
    .filter(Boolean)
    .join(' ');
  if (place) lines.push(place);
  if (a.Country?.trim() && !place.includes(a.Country.trim()))
    lines.push(a.Country.trim());
  return lines;
}

const phone = (p?: { FreeFormNumber?: string }) =>
  p?.FreeFormNumber?.trim() || null;

async function refName(
  service: SupabaseClient,
  entity: 'term' | 'paymentmethod' | 'customertype',
  ref?: { value: string; name?: string }
): Promise<string | null> {
  if (!ref) return null;
  if (ref.name) return ref.name;
  try {
    const res = await qboRequest<{
      Term?: { Name: string };
      PaymentMethod?: { Name: string };
      CustomerType?: { Name: string };
    }>(service, 'GET', `/${entity}/${encodeURIComponent(ref.value)}`);
    return (
      res.Term?.Name ??
      res.PaymentMethod?.Name ??
      res.CustomerType?.Name ??
      null
    );
  } catch {
    return null;
  }
}

export type CustomerProfile = {
  id: string;
  displayName: string;
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
  companyName: string | null;
  active: boolean;
  createdAt: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  otherPhone: string | null;
  billAddress: string[];
  /** null when QuickBooks has no separate shipping address. */
  shipAddress: string[] | null;
  terms: string | null;
  paymentMethod: string | null;
  deliveryMethod: string | null;
  currency: string | null;
  notes: string | null;
  fax: string | null;
  website: string | null;
  /** QuickBooks' Customer type, by name. */
  customerType: string | null;
  /** Files attached to the customer in QuickBooks; null when unread. */
  attachments: number | null;
  /** QuickBooks' open balance: owed minus unused credit. */
  balance: number;
};

export async function readCustomerProfile(
  service: SupabaseClient,
  customerId: string
): Promise<CustomerProfile> {
  const { Customer: c } = await qboRequest<{
    Customer: {
      Id: string;
      DisplayName: string;
      GivenName?: string;
      MiddleName?: string;
      FamilyName?: string;
      CompanyName?: string;
      Active?: boolean;
      MetaData?: { CreateTime?: string };
      PrimaryEmailAddr?: { Address?: string };
      PrimaryPhone?: { FreeFormNumber?: string };
      Mobile?: { FreeFormNumber?: string };
      AlternatePhone?: { FreeFormNumber?: string };
      BillAddr?: QbAddress;
      ShipAddr?: QbAddress;
      SalesTermRef?: { value: string; name?: string };
      PaymentMethodRef?: { value: string; name?: string };
      PreferredDeliveryMethod?: string;
      CurrencyRef?: { value: string; name?: string };
      Notes?: string;
      Fax?: { FreeFormNumber?: string };
      WebAddr?: { URI?: string };
      CustomerTypeRef?: { value: string; name?: string };
      Balance?: number;
    };
  }>(service, 'GET', `/customer/${encodeURIComponent(customerId)}`);
  const [terms, paymentMethod, customerType, attachments] = await Promise.all([
    refName(service, 'term', c.SalesTermRef),
    refName(service, 'paymentmethod', c.PaymentMethodRef),
    refName(service, 'customertype', c.CustomerTypeRef),
    qboQuery<{ Id: string }>(
      service,
      'Attachable',
      `AttachableRef.EntityRef.Type = 'Customer' AND AttachableRef.EntityRef.value = '${qbEscape(c.Id)}'`
    )
      .then((rows) => rows.length)
      .catch(() => null),
  ]);
  const bill = addressLines(c.BillAddr);
  const ship = addressLines(c.ShipAddr);
  return {
    id: c.Id,
    displayName: c.DisplayName,
    givenName: c.GivenName ?? null,
    middleName: c.MiddleName ?? null,
    familyName: c.FamilyName ?? null,
    companyName: c.CompanyName ?? null,
    active: c.Active !== false,
    createdAt: c.MetaData?.CreateTime ?? null,
    email: c.PrimaryEmailAddr?.Address?.trim() || null,
    phone: phone(c.PrimaryPhone),
    mobile: phone(c.Mobile),
    otherPhone: phone(c.AlternatePhone),
    billAddress: bill,
    shipAddress:
      ship.length === 0 || ship.join('|') === bill.join('|') ? null : ship,
    terms,
    paymentMethod,
    deliveryMethod:
      c.PreferredDeliveryMethod && c.PreferredDeliveryMethod !== 'None'
        ? c.PreferredDeliveryMethod
        : null,
    currency: c.CurrencyRef?.name ?? c.CurrencyRef?.value ?? null,
    notes: c.Notes?.trim() || null,
    fax: phone(c.Fax),
    website: c.WebAddr?.URI?.trim() || null,
    customerType,
    attachments,
    balance: Number(c.Balance ?? 0),
  };
}

/** QuickBooks' A/R Aging Summary as of today (Singapore), one customer or all. */
export async function readAging(
  service: SupabaseClient,
  opts: { customerId?: string } = {}
): Promise<AgingRow[]> {
  const q = new URLSearchParams({ report_date: todaySg() });
  if (opts.customerId) q.set('customer', opts.customerId);
  const json = await qboRequest<unknown>(
    service,
    'GET',
    `/reports/AgedReceivables?${q.toString()}`
  );
  return parseAgedReceivables(json);
}

export type InvoiceDetailLine = {
  itemId: string | null;
  itemName: string | null;
  description: string | null;
  qty: number | null;
  rate: number | null;
  amount: number;
  /** The GST code QuickBooks put on the line, by name when it can be read. */
  taxCode: string | null;
};

export type InvoiceDetail = {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  total: number;
  balance: number;
  subtotal: number;
  /** The invoice's Discount line, 0 when it has none. */
  discount: number;
  tax: number;
  /** A deposit taken on the invoice, 0 when none. */
  deposit: number;
  state: 'open' | 'paid' | 'voided';
  lines: InvoiceDetailLine[];
  billAddress: string[];
  billEmail: string | null;
  billEmailCc: string | null;
  emailStatus: string | null;
  delivery: { at: string | null; to: string | null } | null;
  createdAt: string | null;
  updatedAt: string | null;
  customerMemo: string | null;
  privateNote: string | null;
  terms: string | null;
  location: string | null;
  customerId: string;
};

// The US sandbox uses these two pseudo-codes instead of real tax codes.
const US_PSEUDO_CODES: Record<string, string> = {
  TAX: 'Taxable',
  NON: 'No tax',
};

export async function readInvoiceDetail(
  service: SupabaseClient,
  qboInvoiceId: string
): Promise<InvoiceDetail> {
  const { Invoice: inv } = await qboRequest<{
    Invoice: QbInvoice & {
      Line?: Array<{
        Amount?: number;
        Description?: string;
        DetailType?: string;
        SalesItemLineDetail?: {
          ItemRef?: { value: string; name?: string };
          Qty?: number;
          UnitPrice?: number;
          TaxCodeRef?: { value: string };
        };
      }>;
      TxnTaxDetail?: { TotalTax?: number };
      Deposit?: number;
      BillAddr?: QbAddress;
      BillEmail?: { Address?: string };
      BillEmailCc?: { Address?: string };
      EmailStatus?: string;
      DeliveryInfo?: { DeliveryType?: string; DeliveryTime?: string };
      MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
      CustomerMemo?: { value?: string };
      SalesTermRef?: { value: string; name?: string };
      DepartmentRef?: { value: string; name?: string };
    };
  }>(service, 'GET', `/invoice/${encodeURIComponent(qboInvoiceId)}`);
  const sales = (inv.Line ?? []).filter(
    (l) => l.DetailType === 'SalesItemLineDetail'
  );
  const codeIds = [
    ...new Set(
      sales
        .map((l) => l.SalesItemLineDetail?.TaxCodeRef?.value)
        .filter((v): v is string => !!v && !(v in US_PSEUDO_CODES))
    ),
  ];
  const codeNames = new Map<string, string>();
  if (codeIds.length) {
    try {
      const codes = await qboQuery<{ Id: string; Name: string }>(
        service,
        'TaxCode',
        `Id IN (${codeIds.map((i) => `'${qbEscape(i)}'`).join(', ')})`
      );
      for (const c of codes) codeNames.set(c.Id, c.Name);
    } catch {
      // Shown by id below; the invoice itself still reads.
    }
  }
  const subtotalLine = (inv.Line ?? []).find(
    (l) => l.DetailType === 'SubTotalLineDetail'
  );
  const lines: InvoiceDetailLine[] = sales.map((l) => {
    const code = l.SalesItemLineDetail?.TaxCodeRef?.value ?? null;
    return {
      itemId: l.SalesItemLineDetail?.ItemRef?.value ?? null,
      itemName: l.SalesItemLineDetail?.ItemRef?.name ?? null,
      description: l.Description?.trim() || null,
      qty: l.SalesItemLineDetail?.Qty ?? null,
      rate: l.SalesItemLineDetail?.UnitPrice ?? null,
      amount: Number(l.Amount ?? 0),
      taxCode: code
        ? (codeNames.get(code) ?? US_PSEUDO_CODES[code] ?? code)
        : null,
    };
  });
  return {
    id: inv.Id,
    docNumber: inv.DocNumber ?? null,
    txnDate: inv.TxnDate ?? null,
    dueDate: inv.DueDate ?? null,
    total: Number(inv.TotalAmt),
    balance: Number(inv.Balance),
    subtotal: Number(
      subtotalLine?.Amount ?? lines.reduce((s, l) => s + l.amount, 0)
    ),
    discount: (inv.Line ?? [])
      .filter((l) => l.DetailType === 'DiscountLineDetail')
      .reduce((s, l) => s + Number(l.Amount ?? 0), 0),
    tax: Number(inv.TxnTaxDetail?.TotalTax ?? 0),
    deposit: Number(inv.Deposit ?? 0),
    state: invoiceState(inv),
    lines,
    billAddress: addressLines(inv.BillAddr),
    billEmail: inv.BillEmail?.Address?.trim() || null,
    billEmailCc: inv.BillEmailCc?.Address?.trim() || null,
    emailStatus: inv.EmailStatus ?? null,
    delivery: inv.DeliveryInfo?.DeliveryTime
      ? {
          at: inv.DeliveryInfo.DeliveryTime,
          to: inv.BillEmail?.Address?.trim() || null,
        }
      : null,
    createdAt: inv.MetaData?.CreateTime ?? null,
    updatedAt: inv.MetaData?.LastUpdatedTime ?? null,
    customerMemo: inv.CustomerMemo?.value?.trim() || null,
    privateNote: inv.PrivateNote?.trim() || null,
    terms:
      inv.SalesTermRef?.name ??
      (await refName(service, 'term', inv.SalesTermRef)),
    location: inv.DepartmentRef?.name ?? null,
    customerId: inv.CustomerRef.value,
  };
}

export type CustomerContact = {
  companyName: string | null;
  phone: string | null;
  email: string | null;
  /** QuickBooks' open balance for the customer. */
  balance: number;
  active: boolean;
};

/** The Company name and Phone of the given QuickBooks customers, by id — the
 *  Customers list's two contact columns. Asked 200 ids at a time, so the
 *  read grows with the linked students, not every customer QuickBooks has. */
export async function readCustomerContacts(
  service: SupabaseClient,
  customerIds: string[]
): Promise<Map<string, CustomerContact>> {
  type C = {
    Id: string;
    CompanyName?: string;
    PrimaryPhone?: { FreeFormNumber?: string };
    Mobile?: { FreeFormNumber?: string };
    PrimaryEmailAddr?: { Address?: string };
    Balance?: number;
    Active?: boolean;
  };
  const ids = [...new Set(customerIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const rows = (
    await Promise.all(
      chunks.map((c) =>
        qboQueryAll<C>(
          service,
          'Customer',
          `Id IN (${c.map((id) => `'${qbEscape(id)}'`).join(', ')})`
        )
      )
    )
  ).flat();
  return new Map(
    rows.map((c) => [
      c.Id,
      {
        companyName: c.CompanyName?.trim() || null,
        phone:
          c.PrimaryPhone?.FreeFormNumber?.trim() ||
          c.Mobile?.FreeFormNumber?.trim() ||
          null,
        email: c.PrimaryEmailAddr?.Address?.trim() || null,
        balance: Number(c.Balance ?? 0),
        active: c.Active !== false,
      },
    ])
  );
}

/** QuickBooks' A/R Aging Summary as of a date, every bucket kept. */
export async function readAgingReport(
  service: SupabaseClient,
  asOf: string
): Promise<AgingReport> {
  const q = new URLSearchParams({ report_date: asOf });
  const json = await qboRequest<unknown>(
    service,
    'GET',
    `/reports/AgedReceivables?${q.toString()}`
  );
  return parseAgingReport(json);
}

export type ProductRow = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  price: number | null;
  incomeAccount: string | null;
  active: boolean;
  sku: string | null;
  /** QuickBooks' product category; null = Uncategorized. */
  category: string | null;
  /** Purchase cost; null when QuickBooks has none (or 0). */
  cost: number | null;
  /** Quantity on hand; null for items that don't track quantity. */
  qtyOnHand: number | null;
  /** QuickBooks' reorder point, for the Low stock filter. */
  reorderPoint: number | null;
  taxable: boolean;
};

// QuickBooks' API item types → the names its Products & services page uses.
const ITEM_TYPE_LABEL: Record<string, string> = {
  Service: 'Service',
  Inventory: 'Inventory',
  NonInventory: 'Non-inventory',
  Group: 'Bundle',
};

/** QuickBooks' Products and Services list, read live (active and inactive).
 *  Categories are not products, so they are left out, as QuickBooks does. */
export async function readProducts(
  service: SupabaseClient
): Promise<ProductRow[]> {
  const rows = await qboQueryAll<{
    Id: string;
    Name: string;
    FullyQualifiedName?: string;
    Type?: string;
    Description?: string;
    UnitPrice?: number;
    IncomeAccountRef?: { name?: string };
    Active?: boolean;
    Sku?: string;
    SubItem?: boolean;
    ParentRef?: { value: string; name?: string };
    PurchaseCost?: number;
    TrackQtyOnHand?: boolean;
    QtyOnHand?: number;
    ReorderPoint?: number;
    Taxable?: boolean;
  }>(service, 'Item', 'Active IN (true, false)');
  const categoryName = new Map(
    rows
      .filter((i) => i.Type === 'Category')
      .map((i) => [i.Id, i.FullyQualifiedName ?? i.Name])
  );
  return rows
    .filter((i) => i.Type !== 'Category')
    .map((i) => {
      const parent = i.SubItem ? i.ParentRef?.value : undefined;
      const category = parent ? (categoryName.get(parent) ?? null) : null;
      return {
        id: i.Id,
        // Under a category QuickBooks shows the item's own name; under a
        // parent item, the full "Parent:Item" name.
        name: category || !parent ? i.Name : (i.FullyQualifiedName ?? i.Name),
        type: ITEM_TYPE_LABEL[i.Type ?? 'Service'] ?? i.Type ?? 'Service',
        description: i.Description?.trim() || null,
        price: typeof i.UnitPrice === 'number' ? i.UnitPrice : null,
        incomeAccount: i.IncomeAccountRef?.name ?? null,
        active: i.Active !== false,
        sku: i.Sku?.trim() || null,
        category,
        cost: i.PurchaseCost ? i.PurchaseCost : null,
        qtyOnHand:
          i.TrackQtyOnHand && typeof i.QtyOnHand === 'number'
            ? i.QtyOnHand
            : null,
        reorderPoint:
          typeof i.ReorderPoint === 'number' ? i.ReorderPoint : null,
        taxable: i.Taxable === true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
