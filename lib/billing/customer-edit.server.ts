import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  changedFields,
  toForm,
  type CustomerForm,
  type QbCustomer,
} from '@/lib/billing/customer-form';
import { qboRequest } from '@/lib/qbo/client';

// Billing → customer page → Edit: the fields of QuickBooks' Customer form
// that Billing edits, read from and written back to QuickBooks (a sparse
// update — every field not sent is left as QuickBooks has it).

export async function readCustomerForm(
  service: SupabaseClient,
  customerId: string
): Promise<CustomerForm> {
  const { Customer } = await qboRequest<{ Customer: QbCustomer }>(
    service,
    'GET',
    `/customer/${encodeURIComponent(customerId)}`
  );
  return toForm(Customer);
}

/**
 * Writes the form to QuickBooks as a sparse update on the customer's current
 * SyncToken (QuickBooks refuses a stale one, so a change made in QuickBooks
 * meanwhile is never overwritten blind). Returns the saved form and what
 * changed.
 */
export async function updateCustomer(
  service: SupabaseClient,
  customerId: string,
  form: CustomerForm,
  requestId: string
): Promise<{ saved: CustomerForm; before: CustomerForm; changed: string[] }> {
  const { Customer: cur } = await qboRequest<{ Customer: QbCustomer }>(
    service,
    'GET',
    `/customer/${encodeURIComponent(customerId)}`
  );
  const before = toForm(cur);
  const changed = changedFields(before, form);
  if (changed.length === 0) return { saved: before, before, changed };
  const blank = (v: string) => (v.trim() ? v.trim() : undefined);
  const body = {
    Id: cur.Id,
    SyncToken: cur.SyncToken,
    sparse: true,
    Title: form.title.trim(),
    GivenName: form.givenName.trim(),
    MiddleName: form.middleName.trim(),
    FamilyName: form.familyName.trim(),
    Suffix: form.suffix.trim(),
    CompanyName: form.companyName.trim(),
    DisplayName: form.displayName.trim(),
    PrimaryEmailAddr: { Address: form.email.trim() },
    PrimaryPhone: { FreeFormNumber: form.phone.trim() },
    Mobile: { FreeFormNumber: form.mobile.trim() },
    Fax: { FreeFormNumber: form.fax.trim() },
    AlternatePhone: { FreeFormNumber: form.other.trim() },
    WebAddr: blank(form.website) ? { URI: form.website.trim() } : undefined,
    BillAddr: {
      ...(cur.BillAddr?.Id ? { Id: cur.BillAddr.Id } : {}),
      Line1: form.billLine1.trim(),
      Line2: form.billLine2.trim(),
      City: form.billCity.trim(),
      CountrySubDivisionCode: form.billState.trim(),
      PostalCode: form.billPostalCode.trim(),
      Country: form.billCountry.trim(),
    },
    Notes: form.notes.trim(),
  };
  const { Customer: next } = await qboRequest<{ Customer: QbCustomer }>(
    service,
    'POST',
    '/customer',
    body,
    { requestId }
  );
  return { saved: toForm(next), before, changed };
}
