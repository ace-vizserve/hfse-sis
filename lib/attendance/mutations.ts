import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttendanceStatus, ExReason } from '@/lib/schemas/attendance';

// Attendance module — server-side write helpers.
//
// All writes go through service-role (KD #22) — the RLS policies in
// migration 014 deny INSERT/UPDATE/DELETE on `authenticated`. Callers must
// have already gated on role + teacher-assignment via the API route.
//
// Ledger is append-only per the doc + Hard Rule #6 spirit: corrections
// INSERT a new row that supersedes by `recorded_at desc`. After each daily
// write we call `recompute_attendance_rollup(term_id, section_student_id)`
// (defined in migration 014) to refresh `attendance_records` atomically.

export type DailyWriteInput = {
  sectionStudentId: string;
  termId: string;
  date: string; // yyyy-MM-dd
  status: AttendanceStatus;
  exReason?: ExReason | null;
  /** Free-text "why" for an EX mark (migration 109). EX-only, ≤300 chars. */
  exNote?: string | null;
  periodId?: string | null; // Phase 1: always null / omitted
  recordedBy: string | null;
};

export type RollupAfterWrite = {
  schoolDays: number;
  daysPresent: number;
  daysLate: number;
  daysExcused: number;
  daysAbsent: number;
  attendancePct: number | null;
};

// Insert one daily row + recompute rollup. Returns the recomputed rollup
// so the API route can hand the client an optimistic update.
//
// The two statements are NOT atomic at the JS level; the RPC is. Between
// them is a millisecond-scale window where a concurrent recompute could
// see the insert without triggering its own. Outcome either way: next
// write re-converges, so at worst the rollup is stale by one write.
export async function writeDailyEntry(
  service: SupabaseClient,
  input: DailyWriteInput
): Promise<RollupAfterWrite> {
  const { error: insertErr } = await service.from('attendance_daily').insert({
    section_student_id: input.sectionStudentId,
    term_id: input.termId,
    date: input.date,
    status: input.status,
    ex_reason: input.status === 'EX' ? (input.exReason ?? null) : null,
    // Same guard as ex_reason: a note must never survive a switch away from
    // EX, or "Medical certificate submitted" ends up attached to a Present.
    ex_note: input.status === 'EX' ? (input.exNote ?? null) : null,
    period_id: input.periodId ?? null,
    recorded_by: input.recordedBy,
  });
  if (insertErr) {
    throw new Error(`attendance_daily insert failed: ${insertErr.message}`);
  }
  return recomputeRollup(service, input.termId, input.sectionStudentId);
}

/**
 * One ledger row from one input. Shared so the single, batch and import
 * writers cannot drift on the EX guards — a reason or note must never survive
 * a switch away from EX.
 */
function toLedgerRow(i: DailyWriteInput) {
  return {
    section_student_id: i.sectionStudentId,
    term_id: i.termId,
    date: i.date,
    status: i.status,
    ex_reason: i.status === 'EX' ? (i.exReason ?? null) : null,
    ex_note: i.status === 'EX' ? (i.exNote ?? null) : null,
    period_id: i.periodId ?? null,
    recorded_by: i.recordedBy,
  };
}

/** Rollups run this many at a time. See writeDailyBatch. */
export const ROLLUP_CONCURRENCY = 8;

/**
 * Batch daily write for ONE user action — a Daily submit covering a class.
 * Returns each affected (term, student)'s recomputed rollup, keyed
 * `${termId}|${sectionStudentId}`.
 *
 * WHY IT EXISTS. The Daily route used to call `writeDailyEntry` in a `for`
 * loop, and the client submits one entry per student on the roster rather than
 * only the changed ones. A class of 30 therefore cost 30 inserts and 30 rollup
 * RPCs, strictly one after another, plus an awaited audit insert each — about
 * 90 sequential round-trips for one click of Submit.
 *
 * Here it is one insert, then the rollups in bounded-concurrency waves: ~4
 * round-trips of latency for the same class.
 *
 * The bound matters and is not arbitrary. `writeDailyBulk` below runs its
 * rollups strictly sequentially, and its comment records why: an import can
 * carry 1,500+ pairs, and firing that many RPCs at once exhausts the client's
 * connection pool and draws rate-limit warnings. A class-sized batch is two
 * orders of magnitude smaller, so it can afford concurrency — but capped, so
 * the same failure cannot reappear if somebody submits a whole level.
 */
export async function writeDailyBatch(
  service: SupabaseClient,
  inputs: DailyWriteInput[]
): Promise<Map<string, RollupAfterWrite>> {
  const rollups = new Map<string, RollupAfterWrite>();
  if (inputs.length === 0) return rollups;

  const { error: insertErr } = await service
    .from('attendance_daily')
    .insert(inputs.map(toLedgerRow));
  if (insertErr) {
    throw new Error(`attendance_daily insert failed: ${insertErr.message}`);
  }

  const pairs = [
    ...new Set(inputs.map((i) => `${i.termId}|${i.sectionStudentId}`)),
  ];
  for (let i = 0; i < pairs.length; i += ROLLUP_CONCURRENCY) {
    const wave = pairs.slice(i, i + ROLLUP_CONCURRENCY);
    const settled = await Promise.all(
      wave.map(async (key) => {
        const [termId, sectionStudentId] = key.split('|');
        return [
          key,
          await recomputeRollup(service, termId, sectionStudentId),
        ] as const;
      })
    );
    for (const [key, rollup] of settled) rollups.set(key, rollup);
  }
  return rollups;
}

// Bulk daily write — used by the import route. Inserts all rows in one
// batch, then recomputes rollup once per unique (term, section_student).
export async function writeDailyBulk(
  service: SupabaseClient,
  inputs: DailyWriteInput[]
): Promise<{ inserted: number; rollupsRecomputed: number }> {
  if (inputs.length === 0) return { inserted: 0, rollupsRecomputed: 0 };

  const rows = inputs.map(toLedgerRow);

  const { error: insertErr } = await service
    .from('attendance_daily')
    .insert(rows);
  if (insertErr) {
    throw new Error(
      `attendance_daily bulk insert failed: ${insertErr.message}`
    );
  }

  // Unique (term, student) pairs to recompute.
  const pairs = new Set<string>();
  for (const i of inputs) {
    pairs.add(`${i.termId}|${i.sectionStudentId}`);
  }

  let recomputed = 0;
  // Sequential on purpose — Supabase's JS client pools connections, but each
  // rpc call is a round-trip; running 1,500+ in parallel overwhelms the pool
  // and produces rate-limit warnings. Batched imports happen rarely.
  for (const key of pairs) {
    const [termId, ssId] = key.split('|');
    await recomputeRollup(service, termId, ssId);
    recomputed += 1;
  }
  return { inserted: rows.length, rollupsRecomputed: recomputed };
}

// Wraps the RPC defined in migration 014.
async function recomputeRollup(
  service: SupabaseClient,
  termId: string,
  sectionStudentId: string
): Promise<RollupAfterWrite> {
  const { data, error } = await service.rpc('recompute_attendance_rollup', {
    p_term_id: termId,
    p_section_student_id: sectionStudentId,
  });
  if (error) {
    throw new Error(`recompute_attendance_rollup failed: ${error.message}`);
  }
  // RPC returns TABLE — Supabase hands it back as an array.
  const row = Array.isArray(data) ? data[0] : data;
  return {
    schoolDays: row?.school_days ?? 0,
    daysPresent: row?.days_present ?? 0,
    daysLate: row?.days_late ?? 0,
    daysExcused: row?.days_excused ?? 0,
    daysAbsent: row?.days_absent ?? 0,
    attendancePct: row?.attendance_pct ?? null,
  };
}
