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

/** The form as it opens, with the SyncToken of the version it shows. */
export async function readCustomerForm(
  service: SupabaseClient,
  customerId: string
): Promise<{ form: CustomerForm; syncToken: string }> {
  const { Customer } = await qboRequest<{ Customer: QbCustomer }>(
    service,
    'GET',
    `/customer/${encodeURIComponent(customerId)}`
  );
  return { form: toForm(Customer), syncToken: Customer.SyncToken };
}

/**
 * Writes the form to QuickBooks as a sparse update on the SyncToken of the
 * version the form OPENED with: if the customer changed in QuickBooks since,
 * QuickBooks refuses the save instead of it overwriting that change. What
 * changed is measured against the opened form, so a retry after a lost
 * answer (QuickBooks replays it for the same requestId) still reports and
 * audits the change.
 *
 * The billing address is sent whole (QuickBooks replaces a nested address
 * object), built on QuickBooks' current one so lines the form doesn't show
 * (Line3–5, coordinates) are kept.
 */
export async function updateCustomer(
  service: SupabaseClient,
  customerId: string,
  args: {
    form: CustomerForm;
    opened: CustomerForm;
    syncToken: string;
    requestId: string;
  }
): Promise<{ saved: CustomerForm; changed: string[] }> {
  const { form } = args;
  const changed = changedFields(args.opened, form);
  if (changed.length === 0) return { saved: args.opened, changed };
  const { Customer: cur } = await qboRequest<{ Customer: QbCustomer }>(
    service,
    'GET',
    `/customer/${encodeURIComponent(customerId)}`
  );
  const body = {
    Id: cur.Id,
    SyncToken: args.syncToken,
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
    // An empty URI clears it; leaving WebAddr out would keep the old one.
    WebAddr: { URI: form.website.trim() },
    BillAddr: {
      ...(cur.BillAddr ?? {}),
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
    { requestId: args.requestId }
  );
  return { saved: toForm(next), changed };
}
