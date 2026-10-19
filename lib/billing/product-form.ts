// Billing → Products & services → New service / Edit: the fields of
// QuickBooks' Service form that Billing edits, and the pure mapping to and
// from QuickBooks' Item object. Client-safe.

import { z } from 'zod';

export type ProductForm = {
  name: string;
  sku: string;
  /** QuickBooks category (an Item of type Category); '' = Uncategorized. */
  categoryId: string;
  description: string;
  /** Sales price/rate as typed; '' = none. */
  price: string;
  incomeAccountId: string;
  taxable: boolean;
};

export type QbItem = {
  Id: string;
  SyncToken: string;
  Name: string;
  Sku?: string;
  Type?: string;
  Active?: boolean;
  SubItem?: boolean;
  ParentRef?: { value: string; name?: string };
  Description?: string;
  UnitPrice?: number;
  IncomeAccountRef?: { value: string; name?: string };
  Taxable?: boolean;
};

export const EMPTY_PRODUCT_FORM: ProductForm = {
  name: '',
  sku: '',
  categoryId: '',
  description: '',
  price: '',
  incomeAccountId: '',
  taxable: false,
};

const s = (v: string | undefined | null) => v?.trim() ?? '';

export function toProductForm(i: QbItem): ProductForm {
  return {
    name: s(i.Name),
    sku: s(i.Sku),
    categoryId: i.SubItem && i.ParentRef?.value ? i.ParentRef.value : '',
    description: s(i.Description),
    price: i.UnitPrice ? String(i.UnitPrice) : '',
    incomeAccountId: i.IncomeAccountRef?.value ?? '',
    taxable: i.Taxable === true,
  };
}

/** A typed price as a number: '' → null, else a number ≥ 0 with at most 5
 *  decimals (QuickBooks keeps a rate to 5 places). */
export function parsePrice(v: string): number | null | 'invalid' {
  const t = v.replace(/,/g, '').trim();
  if (!t) return null;
  if (!/^\d+(\.\d{1,5})?$/.test(t)) return 'invalid';
  return Number(t);
}

const LABELS: Record<keyof ProductForm, string> = {
  name: 'Name',
  sku: 'SKU',
  categoryId: 'Category',
  description: 'Sales description',
  price: 'Sales price/rate',
  incomeAccountId: 'Income account',
  taxable: 'Taxable',
};

/** The QuickBooks field names that differ between two forms. */
export function changedProductFields(a: ProductForm, b: ProductForm): string[] {
  return (Object.keys(LABELS) as Array<keyof ProductForm>)
    .filter((k) =>
      k === 'price'
        ? parsePrice(a.price) !== parsePrice(b.price)
        : k === 'taxable'
          ? a.taxable !== b.taxable
          : s(a[k] as string) !== s(b[k] as string)
    )
    .map((k) => LABELS[k]);
}

/** The Item body for a create (no Id) or a sparse update (with Id). */
export function productBody(
  form: ProductForm,
  current?: { Id: string; SyncToken: string }
): Record<string, unknown> {
  const price = parsePrice(form.price);
  const body: Record<string, unknown> = {
    Name: form.name.trim(),
    Sku: form.sku.trim(),
    Description: form.description.trim(),
    IncomeAccountRef: { value: form.incomeAccountId },
    Taxable: form.taxable,
    SubItem: !!form.categoryId,
    ...(form.categoryId ? { ParentRef: { value: form.categoryId } } : {}),
    // A cleared price on Edit is 0, which QuickBooks lists as no price.
    ...(typeof price === 'number'
      ? { UnitPrice: price }
      : current
        ? { UnitPrice: 0 }
        : {}),
  };
  if (current)
    return {
      Id: current.Id,
      SyncToken: current.SyncToken,
      sparse: true,
      ...body,
    };
  return { ...body, Type: 'Service' };
}

const str = (max: number) => z.string().max(max).default('');

/** QuickBooks' Service form as Billing sends it (New service and Edit). */
export const ProductFormBody = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100),
  sku: str(100),
  categoryId: z
    .string()
    .regex(/^\d*$/, 'Pick a category from the list.')
    .default(''),
  description: str(4000),
  price: z
    .string()
    .default('')
    .refine((v) => parsePrice(v) !== 'invalid', 'That is not a price.'),
  incomeAccountId: z
    .string()
    .regex(/^\d+$/, 'Pick the income account it posts to.'),
  taxable: z.boolean().default(false),
  /** One id per Save; QuickBooks replays a repeated write. */
  requestId: z.string().uuid(),
});
