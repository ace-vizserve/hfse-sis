import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { pickDefaultDeposit } from '@/lib/billing/deposit-default';
import { qboQuery, qboQueryAll } from '@/lib/qbo/client';

/** isDefault: the one Deposit to starts on (the form falls back to the first). */
export type DepositChoice = { id: string; label: string; isDefault?: boolean };

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
  const choices = banks
    .map((b) => ({ id: b.Id, label: b.Name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const preset = pickDefaultDeposit(
    choices,
    await lastDepositAccountId(service)
  );
  return choices.map((c) => ({ ...c, isDefault: c.id === preset?.id }));
}

/**
 * The account of the company's most recently entered Payment: what
 * QuickBooks prefills Deposit to with. Newest by creation time, so editing an
 * old payment or back-dating one doesn't move it. Never throws: a failed read
 * just means the form starts on the first bank.
 */
async function lastDepositAccountId(
  service: SupabaseClient
): Promise<string | null> {
  try {
    const [p] = await qboQuery<{ DepositToAccountRef?: { value?: string } }>(
      service,
      'Payment',
      '',
      'orderby MetaData.CreateTime desc maxresults 1'
    );
    return p?.DepositToAccountRef?.value ?? null;
  } catch (e) {
    console.error('[billing] last deposit account not read', e);
    return null;
  }
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
