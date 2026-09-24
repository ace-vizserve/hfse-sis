import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  levelAliasConflictMessage,
  planCountsAsChange,
  planLevelAlias,
  type NameRow,
} from '@/lib/admissions/options';
import { logAction } from '@/lib/audit/log-action';
import {
  canonicalizeLevelLabel,
  getLevelRows,
  type LevelAliasRow,
  type LevelRow,
} from '@/lib/sis/levels';

// Shared by the write routes under app/api/sis/admission-options/**. Server
// only: every function here takes the service client, because
// `admission_options` has RLS on and no policies (migration 174).

export type AyRef = { id: string; ay_code: string };

/** The academic year by code, or null when there is no such year. */
export async function findAcademicYear(
  service: SupabaseClient,
  ayCode: string
): Promise<AyRef | null> {
  const { data, error } = await service
    .from('academic_years')
    .select('id, ay_code')
    .eq('ay_code', ayCode)
    .maybeSingle();
  if (error) throw error;
  return (data as AyRef | null) ?? null;
}

type AuditActorInput = {
  id: string;
  email: string | null;
  role: string | null;
};

export type EnsureAliasResult =
  /** `created` — an alias row was written, so level-mismatch counts moved. */
  | { ok: true; level: LevelRow; created: boolean }
  | { ok: false; status: 404 | 409 | 500; error: string };

/**
 * Makes `label` resolve to `levelId` in the SIS, so an application carrying
 * that level name is placed without a trip to /records/level-mismatches.
 *
 * Mirrors `app/api/sis/level-aliases/route.ts` for the write and the audit row
 * (`level.alias.create`, same context keys, so the log reads the same whichever
 * screen made the mapping) — with one deliberate difference: a name already
 * aliased to a DIFFERENT level is REFUSED here, not re-pointed. That route is
 * the reconciliation screen, whose whole job is correcting a mapping; this one
 * is option setup, and silently re-pointing a name would change how every past
 * application carrying it resolves.
 *
 * A name that equals a level's own label needs no alias and writes nothing.
 */
export async function ensureLevelAliasForOption(
  service: SupabaseClient,
  label: string,
  levelId: string,
  actor: AuditActorInput
): Promise<EnsureAliasResult> {
  const levels = await getLevelRows(service);
  const target = levels.find((l) => l.id === levelId);
  if (!target) {
    return {
      ok: false,
      status: 404,
      error: 'That level no longer exists. Reload the page and choose again.',
    };
  }

  const { data: aliasRows, error: aliasErr } = await service
    .from('level_aliases')
    .select('raw_label, level_id')
    .eq('raw_label', label);
  if (aliasErr) return { ok: false, status: 500, error: aliasErr.message };

  const plan = planLevelAlias(
    label,
    levelId,
    levels,
    (aliasRows ?? []) as LevelAliasRow[],
    canonicalizeLevelLabel
  );

  if (plan.kind === 'conflict') {
    return {
      ok: false,
      status: 409,
      error: levelAliasConflictMessage(label, plan.levelLabel, target.label),
    };
  }
  if (plan.kind === 'none') return { ok: true, level: target, created: false };

  // Plain insert, not an upsert: the plan established there is no row for this
  // name, and an upsert would re-point one that appeared since. A unique
  // violation means another save got there first — re-read and decide again.
  const { error: insErr } = await service.from('level_aliases').insert({
    raw_label: label,
    level_id: levelId,
    created_by: actor.id,
  });
  if (insErr) {
    if (insErr.code === '23505') {
      const { data: raced } = await service
        .from('level_aliases')
        .select('raw_label, level_id')
        .eq('raw_label', label);
      const again = planLevelAlias(
        label,
        levelId,
        levels,
        (raced ?? []) as LevelAliasRow[],
        canonicalizeLevelLabel
      );
      if (again.kind === 'conflict') {
        return {
          ok: false,
          status: 409,
          error: levelAliasConflictMessage(
            label,
            again.levelLabel,
            target.label
          ),
        };
      }
      return { ok: true, level: target, created: false };
    }
    return { ok: false, status: 500, error: insErr.message };
  }

  await logAction({
    service,
    actor,
    action: 'level.alias.create',
    entityType: 'level',
    entityId: levelId,
    context: {
      raw_label: label,
      mapped_to_code: target.code ?? null,
      mapped_to_label: target.label,
      source: 'admission_options',
    },
  });

  return { ok: true, level: target, created: true };
}

/**
 * The correction case of a group edit: the level NAME stays and "Counts as"
 * changes. Decided by `planCountsAsChange` (lib/admissions/options.ts): the
 * name's meaning is global, so EVERY `admission_options` row carrying it — any
 * year, any class type — moves to the new level, and then the alias follows.
 *
 * ORDER: rows first, alias second. The alias write is a compare-and-set on the
 * level it pointed at when we read it, so a mapping someone else changed in
 * the meantime is not overwritten; if it misses or errors, the rows are put
 * back to the level each one held, and nothing has changed.
 *
 * A re-point is audited as `level.alias.remap` with the context keys
 * app/api/sis/level-aliases/route.ts writes, plus `source` and `rows_updated`.
 */
export type RecountResult =
  | {
      ok: true;
      level: LevelRow;
      /** The alias table changed, so level-mismatch counts may have moved. */
      created: boolean;
      /** Every year whose rows moved — the caller busts each one's tag. */
      touchedAyCodes: string[];
      rowsUpdated: number;
    }
  | { ok: false; status: 404 | 409 | 500; error: string };

export async function recountLevelNameForOption(
  service: SupabaseClient,
  args: {
    label: string;
    newLevelId: string;
    actor: AuditActorInput;
  }
): Promise<RecountResult> {
  const { label, newLevelId, actor } = args;
  const levels = await getLevelRows(service);
  const target = levels.find((l) => l.id === newLevelId);
  if (!target) {
    return {
      ok: false,
      status: 404,
      error: 'That level no longer exists. Reload the page and choose again.',
    };
  }

  const [aliasRes, rowsRes] = await Promise.all([
    service
      .from('level_aliases')
      .select('raw_label, level_id')
      .eq('raw_label', label),
    service
      .from('admission_options')
      .select('id, level_id, academic_years(ay_code)')
      .eq('level_label', label),
  ]);
  if (aliasRes.error) {
    return { ok: false, status: 500, error: aliasRes.error.message };
  }
  if (rowsRes.error) {
    return { ok: false, status: 500, error: rowsRes.error.message };
  }

  const rows: NameRow[] = (
    (rowsRes.data ?? []) as unknown as Array<{
      id: string;
      level_id: string;
      academic_years: { ay_code: string } | { ay_code: string }[] | null;
    }>
  ).map((r) => {
    const ay = Array.isArray(r.academic_years)
      ? r.academic_years[0]
      : r.academic_years;
    return { id: r.id, level_id: r.level_id, ayCode: ay?.ay_code ?? '' };
  });

  const plan = planCountsAsChange({
    label,
    newLevelId,
    levels,
    aliases: (aliasRes.data ?? []) as LevelAliasRow[],
    rows,
    canonicalize: canonicalizeLevelLabel,
  });
  if (plan.kind === 'refuse') {
    return { ok: false, status: 409, error: plan.message };
  }

  // 1. Rows first.
  if (plan.updateIds.length > 0) {
    const { error: rowErr } = await service
      .from('admission_options')
      .update({ level_id: newLevelId })
      .in('id', plan.updateIds);
    if (rowErr) return { ok: false, status: 500, error: rowErr.message };
  }

  const revertRows = async () => {
    for (const { levelId, ids } of plan.revert) {
      const { error } = await service
        .from('admission_options')
        .update({ level_id: levelId })
        .in('id', ids);
      if (error) {
        console.error(
          '[admission-options] could not revert rows after a failed alias write',
          { label, levelId, ids, error: error.message }
        );
      }
    }
  };

  // 2. Then the alias.
  const done = (created: boolean): RecountResult => ({
    ok: true,
    level: target,
    created,
    touchedAyCodes: plan.touchedAyCodes,
    rowsUpdated: plan.updateIds.length,
  });

  if (plan.alias === 'none') return done(false);

  if (plan.alias === 'insert') {
    const { error: insErr } = await service.from('level_aliases').insert({
      raw_label: label,
      level_id: newLevelId,
      created_by: actor.id,
    });
    if (insErr) {
      await revertRows();
      return insErr.code === '23505'
        ? {
            ok: false,
            status: 409,
            error: `"${label}" was changed by someone else just now. Reload the page and try again.`,
          }
        : { ok: false, status: 500, error: insErr.message };
    }
    await logAction({
      service,
      actor,
      action: 'level.alias.create',
      entityType: 'level',
      entityId: newLevelId,
      context: {
        raw_label: label,
        mapped_to_code: target.code ?? null,
        mapped_to_label: target.label,
        source: 'admission_options',
        rows_updated: plan.updateIds.length,
      },
    });
    return done(true);
  }

  const from = plan.alias;
  const { data: updated, error: updErr } = await service
    .from('level_aliases')
    .update({ level_id: newLevelId })
    .eq('raw_label', label)
    .eq('level_id', from.fromLevelId)
    .select('raw_label');
  if (updErr) {
    await revertRows();
    return { ok: false, status: 500, error: updErr.message };
  }
  if ((updated ?? []).length === 0) {
    await revertRows();
    return {
      ok: false,
      status: 409,
      error: `"${label}" was changed by someone else just now. Reload the page and try again.`,
    };
  }

  const fromLevel = levels.find((l) => l.id === from.fromLevelId);
  await logAction({
    service,
    actor,
    action: 'level.alias.remap',
    entityType: 'level',
    entityId: newLevelId,
    context: {
      raw_label: label,
      mapped_to_code: target.code ?? null,
      mapped_to_label: target.label,
      remapped_from_level_id: from.fromLevelId,
      remapped_from_code: fromLevel?.code ?? null,
      remapped_from_label: fromLevel?.label ?? from.fromLevelLabel,
      source: 'admission_options',
      rows_updated: plan.updateIds.length,
    },
  });

  return done(true);
}
