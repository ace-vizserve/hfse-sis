// Pure grouping engine for `subject_report_map` (migration 080) — folds one
// or more *graded* subjects into the subject identity they should display
// as on the report card. Every subject self-maps by default today (the
// migration's seed inserts `select id, id from subjects`), so this file is
// currently a no-op end to end: every group has exactly one mapper and
// passes straight through. It exists now so a future data change (e.g.
// consolidating several letter-graded subjects into one "MAPEH" column, or
// splitting "Mother Tongue" into "Filipino"/"Mandarin" that both report
// back to Mother Tongue) works correctly WITHOUT any code change here — the
// algorithm is generic over the shape of `reportMap`, never over specific
// subject names/codes.
//
// No Supabase, no React — dependency-free like lib/compute/*, so it's
// unit-testable in complete isolation from the DB/rendering layers.
//
// ── Design invariants (read before extending this for the next combine/split) ──
//
// 1. A multi-mapper group must never blend cells from more than one source
//    subject into a single row — it always surfaces exactly one real
//    source's data, never a sum/average across sources. This is why the
//    merged row's `is_examinable` is always coherent (never a mix of
//    numeric-graded and letter-graded semantics on one row).
//
// 2. The parenthetical decision (mapper *count*, a property of the whole
//    catalog's map shape) and the source-selection decision (which mapper
//    actually has grade data for *this* student) are two independent axes.
//    Keep them computed separately — don't conflate "this target is
//    ambiguous in general" with "this target is ambiguous for this
//    student." A target can have 2 mappers in the catalog (parenthetical
//    always considered) while any individual student only ever has real
//    data under one of them (source selection resolves per-row).

import type { SubjectRow } from '@/lib/report-card/build-report-card';

export type ReportTargetMeta = {
  id: string;
  code: string;
  name: string;
  // What prints on the report card, independent of `name` — null falls
  // back to `name`. Resolved by the CALLER at render time for the common
  // (self-map) case; this module composes it directly into `.name` only
  // for the fan-in case below, since that's already synthesizing a new
  // "{Target} ({Source})" string from two subjects' identities, not a
  // simple passthrough.
  report_label: string | null;
  is_examinable: boolean;
};

export type ReportMapEntry = { subject_id: string; report_subject_id: string };

type MinimalCell = { quarterly: number | null; letter: string | null };

/**
 * A cell counts as "has data" when it carries a numeric quarterly score, or
 * a letter that isn't the N.A. marker ('NA' — see lib/compute/letter-grade.ts
 * ::resolveNonExaminableLetter, the only producer of that literal string).
 * A cell with letter=null (no entry at all, or the enrolment-coverage
 * forced-override case in build-report-card.ts which nulls both quarterly
 * AND letter for a non-enrolled term) does NOT count as data.
 */
function cellHasData(cell: MinimalCell): boolean {
  return (
    cell.quarterly != null || (cell.letter != null && cell.letter !== 'NA')
  );
}

function rowHasData(row: SubjectRow): boolean {
  return (
    cellHasData(row.t1) ||
    cellHasData(row.t2) ||
    cellHasData(row.t3) ||
    cellHasData(row.t4) ||
    row.annual != null
  );
}

/**
 * Resolves `subjectId`'s report-card target. An entry in `reportMap` wins;
 * absent any entry, a subject reports as itself (the self-map default —
 * matters for subjects that predate a `subject_report_map` row, or when the
 * fetch in build-report-card.ts comes back empty).
 */
function targetIdFor(
  subjectId: string,
  bySubject: Map<string, string>
): string {
  return bySubject.get(subjectId) ?? subjectId;
}

export function resolveReportSubjects(
  rows: SubjectRow[],
  reportMap: ReportMapEntry[],
  reportTargets: Map<string, ReportTargetMeta>
): SubjectRow[] {
  // subject_id -> report_subject_id (one active mapping per subject, per the
  // write route's delete-then-insert contract — a later entry for the same
  // subject_id in a malformed input wins, matching Map.set's last-write
  // semantics; not expected in practice).
  const bySubject = new Map<string, string>();
  for (const entry of reportMap) {
    bySubject.set(entry.subject_id, entry.report_subject_id);
  }

  // Mapper count is a property of the FULL catalog map, not of what's
  // offered/graded this AY/level — ambiguity ("is this target a real
  // fan-in?") is a catalog-shape question, independent of which subjects
  // happen to appear in `rows` this term.
  const subjectsByTarget = new Map<string, Set<string>>();
  for (const entry of reportMap) {
    const set =
      subjectsByTarget.get(entry.report_subject_id) ?? new Set<string>();
    set.add(entry.subject_id);
    subjectsByTarget.set(entry.report_subject_id, set);
  }
  const mapperCountByTarget = new Map<string, number>();
  for (const [targetId, subjectIds] of subjectsByTarget) {
    mapperCountByTarget.set(targetId, subjectIds.size);
  }

  // Group `rows` by target, preserving first-seen target order.
  const groupOrder: string[] = [];
  const groups = new Map<string, SubjectRow[]>();
  for (const row of rows) {
    const targetId = targetIdFor(row.subject.id, bySubject);
    let group = groups.get(targetId);
    if (!group) {
      group = [];
      groups.set(targetId, group);
      groupOrder.push(targetId);
    }
    group.push(row);
  }

  const output: SubjectRow[] = [];
  for (const targetId of groupOrder) {
    const group = groups.get(targetId)!;
    // Absent reportMap entries for this target => default count of 1 (the
    // common self-map / unmapped-subject case).
    const mapperCount = mapperCountByTarget.get(targetId) ?? 1;
    const target = reportTargets.get(targetId);

    if (mapperCount <= 1) {
      // Plain case — never data-gate, never annotate. When target metadata
      // is known, relabel to the target's own identity (a no-op for a true
      // self-map, since target.id/code/name equal the row's own subject
      // fields there); when it isn't known (empty/failed reportMap fetch,
      // or a subject with no row at all in reportMap), fall through with
      // the row completely untouched.
      for (const row of group) {
        if (!target) {
          output.push(row);
          continue;
        }
        output.push({
          ...row,
          subject: {
            id: target.id,
            code: target.code,
            name: target.name,
            report_label: target.report_label,
            is_examinable: row.subject.is_examinable,
          },
        });
      }
      continue;
    }

    // Real fan-in (mapperCount > 1). Source-selection is per-student: only
    // a mapper with actual grade data is eligible to represent the group.
    const candidates = group.filter(rowHasData);
    if (candidates.length === 0) {
      // Auto-hide: nobody graded under any fanned-in subject this term —
      // drop the row entirely rather than render an all-dash placeholder.
      continue;
    }
    // Guarded invariant: in practice a student is only ever graded under
    // one track of a fan-in group (one-track-per-student), so this should
    // never see >1 candidate. If it ever does, pick deterministically by
    // name rather than throwing — a report card must still render.
    const sourceRow =
      candidates.length === 1
        ? candidates[0]
        : candidates
            .slice()
            .sort((a, b) => a.subject.name.localeCompare(b.subject.name))[0];

    if (!target) {
      // Defensive: reportTargets should always know a real fan-in target
      // (it's built from reportMap's own report_subject_id column), but
      // don't crash the report card if it somehow doesn't.
      output.push(sourceRow);
      continue;
    }
    output.push({
      ...sourceRow,
      subject: {
        id: target.id,
        code: target.code,
        // Composing a new "{Target} ({Source})" string here — a real
        // synthesis of two subjects' identities, not a simple passthrough —
        // so this is the one place report_label resolution happens ahead of
        // render time. `report_label: null` on the output row is correct
        // (not a loss of information): the composed string above already IS
        // the final display text, so a render-time `report_label ?? name`
        // fallback should never re-substitute anything for this row.
        name: `${target.report_label ?? target.name} (${sourceRow.subject.report_label ?? sourceRow.subject.name})`,
        report_label: null,
        is_examinable: sourceRow.subject.is_examinable,
      },
    });
  }

  // Grouping can move a merged row's alphabetical position relative to
  // where its source row(s) sorted — re-sort the final list. (Array.sort is
  // stable, so an input that's already correctly sorted — e.g. every group
  // is single-mapper, nothing changed — round-trips byte-identical.) Sort by
  // the EFFECTIVE display value (report_label ?? name), not the raw
  // catalog name — a subject printed under a different report label should
  // sort where it's shown, not where it's catalogued.
  return output.sort((a, b) =>
    (a.subject.report_label ?? a.subject.name).localeCompare(
      b.subject.report_label ?? b.subject.name
    )
  );
}
