import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

// Per-slot outreach summary surfaced on DocumentCards + the completeness
// table. lastReminderAt drives both the cooldown check (server-side) and
// the "Reminded N days ago" badge (UI). activePromise drives the
// "Promised by [date]" badge — only set when the latest kind='promise'
// row's promised_until is today or later.
export type OutreachSummary = {
  lastReminderAt: string | null;
  activePromise: {
    promisedUntil: string;
    note: string | null;
  } | null;
};

export type OutreachKind = "reminder" | "promise";

const REMINDER_COOLDOWN_HOURS = 24;

function emptySummary(): OutreachSummary {
  return { lastReminderAt: null, activePromise: null };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type RawOutreachRow = {
  enrolee_number: string;
  slot_key: string;
  kind: OutreachKind;
  promised_until: string | null;
  note: string | null;
  created_at: string;
};

function reduceRows(rows: RawOutreachRow[]): Map<string, Map<string, OutreachSummary>> {
  // Rows arrive sorted by created_at desc, so the first row we see for a
  // (student, slot, kind) tuple is the latest. We accumulate per
  // (enrolee, slot) and only set each field once.
  const todayIso = todayIsoDate();
  const byStudent = new Map<string, Map<string, OutreachSummary>>();

  for (const row of rows) {
    let bySlot = byStudent.get(row.enrolee_number);
    if (!bySlot) {
      bySlot = new Map();
      byStudent.set(row.enrolee_number, bySlot);
    }
    let summary = bySlot.get(row.slot_key);
    if (!summary) {
      summary = emptySummary();
      bySlot.set(row.slot_key, summary);
    }

    if (row.kind === "reminder" && summary.lastReminderAt === null) {
      summary.lastReminderAt = row.created_at;
    } else if (
      row.kind === "promise" &&
      summary.activePromise === null &&
      row.promised_until !== null &&
      row.promised_until >= todayIso
    ) {
      summary.activePromise = {
        promisedUntil: row.promised_until,
        note: row.note,
      };
    }
  }

  return byStudent;
}

export async function getOutreachForStudent(
  ayCode: string,
  enroleeNumber: string,
  client?: SupabaseClient,
): Promise<Map<string, OutreachSummary>> {
  const service = client ?? createServiceClient();
  const { data, error } = await service
    .from("p_file_outreach")
    .select("enrolee_number, slot_key, kind, promised_until, note, created_at")
    .eq("ay_code", ayCode)
    .eq("enrolee_number", enroleeNumber)
    .order("created_at", { ascending: false });

  if (error || !data) return new Map();

  const byStudent = reduceRows(data as RawOutreachRow[]);
  return byStudent.get(enroleeNumber) ?? new Map();
}

export async function getOutreachForRoster(
  ayCode: string,
  enroleeNumbers: string[],
  client?: SupabaseClient,
): Promise<Map<string, Map<string, OutreachSummary>>> {
  if (enroleeNumbers.length === 0) return new Map();

  const service = client ?? createServiceClient();
  const { data, error } = await service
    .from("p_file_outreach")
    .select("enrolee_number, slot_key, kind, promised_until, note, created_at")
    .eq("ay_code", ayCode)
    .in("enrolee_number", enroleeNumbers)
    .order("created_at", { ascending: false });

  if (error || !data) return new Map();

  return reduceRows(data as RawOutreachRow[]);
}

// Server-side cooldown check used by the notify routes. Returns the most
// recent reminder timestamp if one is within the cooldown window, else
// null. Caller 429s when this returns non-null.
export async function getActiveCooldown(
  ayCode: string,
  enroleeNumber: string,
  slotKey: string,
  client?: SupabaseClient,
): Promise<{ lastSentAt: string; hoursAgo: number } | null> {
  const service = client ?? createServiceClient();
  const { data, error } = await service
    .from("p_file_outreach")
    .select("created_at")
    .eq("ay_code", ayCode)
    .eq("enrolee_number", enroleeNumber)
    .eq("slot_key", slotKey)
    .eq("kind", "reminder")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const lastSentAt = (data as { created_at: string }).created_at;
  const hoursAgo = (Date.now() - new Date(lastSentAt).getTime()) / 36e5;
  if (hoursAgo >= REMINDER_COOLDOWN_HOURS) return null;
  return { lastSentAt, hoursAgo };
}

export { REMINDER_COOLDOWN_HOURS };
