import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';

const REMINDER_COOLDOWN_HOURS = 24;

type RawOutreachRow = {
  enrolee_number: string;
  slot_key: string;
  promised_until: string | null;
  note: string | null;
  created_at: string;
};

// Promised-cohort variant: keeps the LATEST kind='promise' row per
// (enrolee, slot) regardless of whether promised_until is in the past.
// `getLatestPromisesForRoster` keeps past-due promises so the chase queue
// can flag missed dates.
export type LatestPromise = {
  promisedUntil: string;
  note: string | null;
};

export async function getLatestPromisesForRoster(
  ayCode: string,
  enroleeNumbers: string[],
  client?: SupabaseClient
): Promise<Map<string, Map<string, LatestPromise>>> {
  if (enroleeNumbers.length === 0) return new Map();

  const service = client ?? createServiceClient();
  const { data, error } = await service
    .from('p_file_outreach')
    .select('enrolee_number, slot_key, promised_until, note, created_at')
    .eq('ay_code', ayCode)
    .eq('kind', 'promise')
    .in('enrolee_number', enroleeNumbers)
    .order('created_at', { ascending: false });

  if (error || !data) return new Map();

  const byStudent = new Map<string, Map<string, LatestPromise>>();
  for (const row of data as Array<
    Pick<
      RawOutreachRow,
      'enrolee_number' | 'slot_key' | 'promised_until' | 'note'
    >
  >) {
    if (row.promised_until === null) continue;
    let bySlot = byStudent.get(row.enrolee_number);
    if (!bySlot) {
      bySlot = new Map();
      byStudent.set(row.enrolee_number, bySlot);
    }
    if (bySlot.has(row.slot_key)) continue; // first row wins (latest by created_at desc)
    bySlot.set(row.slot_key, {
      promisedUntil: row.promised_until,
      note: row.note,
    });
  }
  return byStudent;
}

// Read-only cooldown lookup. Returns the most recent reminder timestamp if one
// is within the cooldown window, else null.
//
// NOT part of the send path any more. `runNotify` used this as a
// check-then-act gate, which raced: two requests both passed it before either
// recorded a send, and a parent got two emails. The cooldown decision now lives
// inside the `claim_pfile_reminder` RPC (migration 096), where the check and
// the insert happen together under an advisory lock.
//
// Kept for display/inspection only. Do NOT reintroduce it as a gate before
// sending — a second cooldown implementation in JS would drift from the RPC's,
// and the JS one cannot be atomic.
export async function getActiveCooldown(
  ayCode: string,
  enroleeNumber: string,
  slotKey: string,
  client?: SupabaseClient
): Promise<{ lastSentAt: string; hoursAgo: number } | null> {
  const service = client ?? createServiceClient();
  const { data, error } = await service
    .from('p_file_outreach')
    .select('created_at')
    .eq('ay_code', ayCode)
    .eq('enrolee_number', enroleeNumber)
    .eq('slot_key', slotKey)
    .eq('kind', 'reminder')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const lastSentAt = (data as { created_at: string }).created_at;
  const hoursAgo = (Date.now() - new Date(lastSentAt).getTime()) / 36e5;
  if (hoursAgo >= REMINDER_COOLDOWN_HOURS) return null;
  return { lastSentAt, hoursAgo };
}
