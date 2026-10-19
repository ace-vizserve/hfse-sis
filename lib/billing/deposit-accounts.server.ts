import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { qboQueryAll } from '@/lib/qbo/client';

export type DepositChoice = { id: string; label: string };

/**
 * The accounts Record payment offers: QuickBooks' active Bank accounts, by
 * name, read live (KD #232 update 2026-10-16 — nothing is set up in the SIS).
 * Throws when QuickBooks can't be read; pages catch it and show no choices.
 */
export async function loadDepositChoices(
  service: SupabaseClient
): Promise<DepositChoice[]> {
  // ⚠ Unverified: that HFSE's UOB / PayNow / card accounts are type Bank in
  // the production company (the sandbox's are).
  const banks = await qboQueryAll<{ Id: string; Name: string }>(
    service,
    'Account',
    "AccountType = 'Bank' AND Active = true"
  );
  return banks
    .map((b) => ({ id: b.Id, label: b.Name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export type PaymentMethodChoice = { id: string; label: string };

/**
 * Receive Payment's "Payment method": QuickBooks' active payment methods
 * (Cash, Cheque, PayNow…), read live. Throws when QuickBooks can't be read;
 * pages catch it and show no choices (the field is optional).
 */
export async function loadPaymentMethods(
  service: SupabaseClient
): Promise<PaymentMethodChoice[]> {
  const methods = await qboQueryAll<{ Id: string; Name: string }>(
    service,
    'PaymentMethod',
    'Active = true'
  );
  return methods
    .map((m) => ({ id: m.Id, label: m.Name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
