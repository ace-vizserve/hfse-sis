import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  changedProductFields,
  productBody,
  toProductForm,
  type ProductForm,
  type QbItem,
} from '@/lib/billing/product-form';
import { qboQueryAll, qboRequest } from '@/lib/qbo/client';

// Billing → Products & services: New service, Edit and Make inactive, written
// to QuickBooks' Item (a sparse update for Edit and Make inactive — every
// field not sent stays as QuickBooks has it).

export type ProductFormOptions = {
  incomeAccounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
};

/** What the form's two pickers offer: QuickBooks' income accounts and its
 *  product categories. */
export async function readProductFormOptions(
  service: SupabaseClient
): Promise<ProductFormOptions> {
  const [accounts, categories] = await Promise.all([
    qboQueryAll<{ Id: string; FullyQualifiedName?: string; Name: string }>(
      service,
      'Account',
      "AccountType IN ('Income', 'Other Income') AND Active = true"
    ),
    qboQueryAll<{ Id: string; FullyQualifiedName?: string; Name: string }>(
      service,
      'Item',
      "Type = 'Category' AND Active = true"
    ),
  ]);
  const opt = (a: {
    Id: string;
    FullyQualifiedName?: string;
    Name: string;
  }) => ({
    id: a.Id,
    name: a.FullyQualifiedName ?? a.Name,
  });
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  return {
    incomeAccounts: accounts.map(opt).sort(byName),
    categories: categories.map(opt).sort(byName),
  };
}

async function readItem(service: SupabaseClient, itemId: string) {
  const { Item } = await qboRequest<{ Item: QbItem }>(
    service,
    'GET',
    `/item/${encodeURIComponent(itemId)}`
  );
  return Item;
}

export async function readProductForm(
  service: SupabaseClient,
  itemId: string
): Promise<{ form: ProductForm; type: string; active: boolean }> {
  const item = await readItem(service, itemId);
  return {
    form: toProductForm(item),
    type: item.Type ?? 'Service',
    active: item.Active !== false,
  };
}

export async function createService(
  service: SupabaseClient,
  form: ProductForm,
  requestId: string
): Promise<{ id: string; name: string }> {
  const { Item } = await qboRequest<{ Item: QbItem }>(
    service,
    'POST',
    '/item',
    productBody(form),
    { requestId }
  );
  return { id: Item.Id, name: Item.Name };
}

/** Edit → Save, on the item's current SyncToken (QuickBooks refuses a stale
 *  one, so a change made in QuickBooks meanwhile is never overwritten). */
export async function updateService(
  service: SupabaseClient,
  itemId: string,
  form: ProductForm,
  requestId: string
): Promise<{ name: string; changed: string[] }> {
  const cur = await readItem(service, itemId);
  if ((cur.Type ?? 'Service') !== 'Service')
    throw new NotAServiceError(cur.Type ?? '');
  const changed = changedProductFields(toProductForm(cur), form);
  if (changed.length === 0) return { name: cur.Name, changed };
  const { Item } = await qboRequest<{ Item: QbItem }>(
    service,
    'POST',
    '/item',
    productBody(form, cur),
    { requestId }
  );
  return { name: Item.Name, changed };
}

/** Make inactive: QuickBooks keeps the item and its history, it just stops
 *  being offered. Already inactive is not an error. */
export async function makeItemInactive(
  service: SupabaseClient,
  itemId: string,
  requestId: string
): Promise<{ name: string; changed: boolean }> {
  const cur = await readItem(service, itemId);
  if (cur.Active === false) return { name: cur.Name, changed: false };
  const { Item } = await qboRequest<{ Item: QbItem }>(
    service,
    'POST',
    '/item',
    { Id: cur.Id, SyncToken: cur.SyncToken, sparse: true, Active: false },
    { requestId }
  );
  return { name: Item.Name, changed: true };
}

export class NotAServiceError extends Error {
  constructor(type: string) {
    super(
      `This is a${/^[aeiou]/i.test(type) ? 'n' : ''} ${type.toLowerCase()} item. Edit it in QuickBooks.`
    );
  }
}
