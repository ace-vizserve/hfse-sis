// Masterfile dashboard drill-down derivation (KD #127/#122 — Academic Summary).
//
// CLIENT-SIDE, in-memory only. The Academic Summary dashboard already holds the
// full `MasterfilePayload` in the browser; a drill just surfaces the subset of
// students behind an on-screen aggregate. No API route, no cache, no fetch.
//
// COUNT == DRILL (the KD #124 lesson): every predicate here is shared with
// `computeMasterfileDashboard` via `lib/markbook/masterfile-dashboard.ts`'s
// exported scope/predicate helpers (`scopeRows`, `enrolledScopeRows`,
// `subjectsInScope`, `termIndicesInScope`, `commentTermsInScope`,
// `studentHasMissingGradeInScope`, `studentMissingCommentTerms`,
// `awardTierForRow`, `gaBandTierForRow`, plus the `NeedsDataItem.groupKey`).
// The drill row count for a target MUST equal the aggregate it drills from;
// the parity is unit-tested in `__tests__/markbook/masterfile-drill.test.ts`.

import type { MasterfileDashboardFilters } from '@/lib/markbook/masterfile-dashboard';
import {
  awardTierForRow,
  commentTermsInScope,
  enrolledScopeRows,
  gaBandTierForRow,
  scopeRows,
  studentHasMissingGradeInScope,
  studentMissingCommentTerms,
  subjectsInScope,
  termIndicesInScope,
  unlockedSheetsInScope,
  type AwardTier,
  type GaBandTier,
} from '@/lib/markbook/masterfile-dashboard';
import type {
  MasterfilePayload,
  MasterfileStudentRow,
} from '@/lib/markbook/masterfile';

// ---------- Public types ----------

export type MasterfileDrillTarget =
  | { kind: 'missing-grades' }
  | { kind: 'missing-comments' }
  | { kind: 'incomplete-results' }
  | { kind: 'award'; tier: AwardTier }
  | { kind: 'ga-band'; tier: GaBandTier }
  | { kind: 'needs-data'; groupKey: string };

export type MasterfileDrillStatus = 'Active' | 'Late enrollee' | 'Withdrawn';

export type MasterfileDrillRow = {
  // null when the row isn't a student (e.g. an unlocked-sheet group) or the
  // student has no number — the sheet renders plain text in that case.
  studentNumber: string | null;
  studentName: string;
  sectionName: string;
  status: MasterfileDrillStatus;
  // The one drill-specific stat for this row (column header = `statLabel`).
  stat: string;
};

export type MasterfileDrillResult = {
  rows: MasterfileDrillRow[];
  title: string;
  statLabel: string;
  // One-line unit bridge: the readiness cards count cells / write-up slots /
  // sheets, but these drills list students (or sheets). This sentence tells the
  // operator what each row represents, so the sheet's count never looks like it
  // should equal the card's cell count.
  description: string;
  // The unit each row in this drill represents — 'students' for student lists,
  // 'sheets' for the unlocked-sheets group. Drives the self-labeling header
  // badge ("N students" / "N sheets").
  rowUnit: 'students' | 'sheets';
};

// ---------- Helpers ----------

function statusLabel(r: MasterfileStudentRow): MasterfileDrillStatus {
  switch (r.enrollmentStatus) {
    case 'withdrawn':
      return 'Withdrawn';
    case 'late_enrollee':
      return 'Late enrollee';
    case 'active':
    default:
      return 'Active';
  }
}

// Section then name — matches the loader's row sort and gives a stable list.
function sortRows(rows: MasterfileDrillRow[]): MasterfileDrillRow[] {
  return rows.slice().sort((a, b) => {
    const s = a.sectionName.localeCompare(b.sectionName);
    if (s !== 0) return s;
    return a.studentName.localeCompare(b.studentName);
  });
}

function toRow(r: MasterfileStudentRow, stat: string): MasterfileDrillRow {
  return {
    studentNumber: r.studentNumber || null,
    studentName: r.fullName || r.studentNumber || '—',
    sectionName: r.sectionName,
    status: statusLabel(r),
    stat,
  };
}

const AWARD_TIER_LABEL: Record<AwardTier, string> = {
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  notEligible: 'Not eligible',
};

function gaText(ga: number | null): string {
  return ga == null ? 'GA pending' : `GA ${ga.toFixed(1)}`;
}

// ---------- Main entry ----------

export function buildMasterfileDrillRows(
  payload: MasterfilePayload,
  filters: MasterfileDashboardFilters,
  target: MasterfileDrillTarget
): MasterfileDrillResult {
  // Defensive: tolerate a partial payload exactly like computeMasterfileDashboard.
  const safe: MasterfilePayload = {
    ...payload,
    rows: payload.rows ?? [],
    subjects: payload.subjects ?? [],
    terms: payload.terms ?? [],
    sheets: payload.sheets ?? [],
  };

  const subjects = subjectsInScope(safe, filters);
  const termIdx = termIndicesInScope(safe, filters.termNumber);

  switch (target.kind) {
    case 'missing-grades': {
      // One predicate call per student (Fix 4): flatMap so the shared
      // studentHasMissingGradeInScope isn't evaluated twice.
      const rows = enrolledScopeRows(safe, filters).flatMap((r) => {
        const { hasMissing, count } = studentHasMissingGradeInScope(
          r,
          subjects,
          termIdx
        );
        if (!hasMissing) return [];
        return [toRow(r, `${count} cell${count === 1 ? '' : 's'} missing`)];
      });
      return {
        rows: sortRows(rows),
        title: 'Students with missing grades',
        statLabel: 'Missing',
        description:
          'Each student below has at least one grade cell still blank.',
        rowUnit: 'students',
      };
    }

    case 'missing-comments': {
      const commentTerms = commentTermsInScope(safe, filters.termNumber);
      const rows = enrolledScopeRows(safe, filters)
        .filter((r) => studentMissingCommentTerms(r, commentTerms).length > 0)
        .map((r) => {
          const missing = studentMissingCommentTerms(r, commentTerms);
          const label =
            commentTerms.length > 1
              ? `${missing.length} of ${commentTerms.length} terms blank`
              : 'Comment not written';
          return toRow(r, label);
        });
      return {
        rows: sortRows(rows),
        title: 'Students with no adviser comment',
        statLabel: 'What’s short',
        description:
          'Each student below is missing at least one T1–T3 adviser comment.',
        rowUnit: 'students',
      };
    }

    case 'incomplete-results': {
      // Mirror the "Full results" card exactly. The card's gap is
      // rosterCount − gradableCount, and gradableCount EXCLUDES students with
      // zero examinable subject rows in scope (e.g. a late enrollee with no
      // grades yet). So those students ARE part of the card's gap and MUST
      // appear here too — otherwise the drill under-counts by one per such
      // student (Fix 2). Gradable = every examinable subject in scope has a
      // non-null overall AND at least one examinable row exists.
      const examinableIds = new Set(
        subjects.filter((s) => s.isExaminable).map((s) => s.id)
      );
      const rows = enrolledScopeRows(safe, filters).flatMap((r) => {
        const examRows = (r.subjectRows ?? []).filter((sr) =>
          examinableIds.has(sr.subjectId)
        );
        if (examRows.length === 0) {
          // No examinable data yet → not gradable → part of the card's gap.
          return [toRow(r, 'No examinable results yet')];
        }
        const short = examRows.filter((sr) => sr.overall == null).length;
        if (short === 0) return []; // fully gradable — not in the gap
        return [
          toRow(r, `${short} subject${short === 1 ? '' : 's'} incomplete`),
        ];
      });
      return {
        rows: sortRows(rows),
        title: 'Students without complete results',
        statLabel: 'What’s short',
        description:
          "Students who don't yet have a complete set of examinable results.",
        rowUnit: 'students',
      };
    }

    case 'award': {
      const rows = scopeRows(safe, filters)
        .filter((r) => awardTierForRow(r) === target.tier)
        .map((r) =>
          toRow(
            r,
            `${gaText(r.generalAverage)} · ${AWARD_TIER_LABEL[target.tier]}`
          )
        );
      return {
        rows: sortRows(rows),
        title: `${AWARD_TIER_LABEL[target.tier]} — Overall Academic Award`,
        statLabel: 'Result',
        description: `Students in the ${AWARD_TIER_LABEL[target.tier]} band.`,
        rowUnit: 'students',
      };
    }

    case 'ga-band': {
      const rows = scopeRows(safe, filters)
        .filter((r) => gaBandTierForRow(r, safe.thresholds) === target.tier)
        .map((r) => toRow(r, gaText(r.generalAverage)));
      return {
        rows: sortRows(rows),
        title: 'Students in this General Average band',
        statLabel: 'General Average',
        description: 'Students whose General Average falls in this band.',
        rowUnit: 'students',
      };
    }

    case 'needs-data': {
      return buildNeedsDataDrill(
        safe,
        filters,
        target.groupKey,
        subjects,
        termIdx
      );
    }

    default: {
      // Exhaustiveness guard.
      const _never: never = target;
      void _never;
      return {
        rows: [],
        title: 'Details',
        statLabel: 'Detail',
        description: '',
        rowUnit: 'students',
      };
    }
  }
}

// ---------- needs-data drill ----------
//
// The "Still coming in" list collapses three kinds of work into one set, each
// carrying a stable `groupKey`:
//   missing-grades:<subjectId>   → students missing a cell in that subject
//   unlocked-sheets:<subjectId>  → grading sheets not yet locked (sheet rows)
//   missing-comments             → students missing an FCA write-up (T1–T3)
// We re-derive the matching members here from the same predicates so the drill
// count equals the group's `count` on the dashboard.

function buildNeedsDataDrill(
  payload: MasterfilePayload,
  filters: MasterfileDashboardFilters,
  groupKey: string,
  subjects: ReturnType<typeof subjectsInScope>,
  termIdx: number[]
): MasterfileDrillResult {
  const enrolled = enrolledScopeRows(payload, filters);

  if (groupKey.startsWith('missing-grades:')) {
    const subjectId = groupKey.slice('missing-grades:'.length);
    const scopedSubjects = subjects.filter((s) => s.id === subjectId);
    const subjectName = scopedSubjects[0]?.name ?? 'Subject';
    const rows: MasterfileDrillRow[] = [];
    for (const r of enrolled) {
      const { count } = studentHasMissingGradeInScope(
        r,
        scopedSubjects,
        termIdx
      );
      if (count > 0) {
        rows.push(toRow(r, `${count} cell${count === 1 ? '' : 's'} missing`));
      }
    }
    return {
      rows: sortRows(rows),
      title: `${subjectName} — students missing grades`,
      statLabel: 'Missing',
      description: `Each student below has at least one ${subjectName} grade cell still blank.`,
      rowUnit: 'students',
    };
  }

  if (groupKey.startsWith('unlocked-sheets:')) {
    const subjectId = groupKey.slice('unlocked-sheets:'.length);
    const sheets = unlockedSheetsInScope(payload, filters).filter(
      (s) => s.subjectId === subjectId
    );
    const subjectName =
      payload.subjects.find((s) => s.id === subjectId)?.name ?? 'Subject';
    const sectionNameById = new Map(
      payload.sections.map((s) => [s.id, s.name])
    );
    const termLabelById = new Map(payload.terms.map((t) => [t.id, t.label]));
    const rows: MasterfileDrillRow[] = sheets.map((sh) => ({
      studentNumber: null,
      studentName: `${subjectName} grading sheet`,
      sectionName: sectionNameById.get(sh.sectionId) ?? '—',
      status: 'Active' as const,
      stat: `${termLabelById.get(sh.termId) ?? 'Term'} · not locked`,
    }));
    // Sheets: sort by section then term label for a stable order.
    rows.sort((a, b) => {
      const s = a.sectionName.localeCompare(b.sectionName);
      if (s !== 0) return s;
      return a.stat.localeCompare(b.stat);
    });
    return {
      rows,
      title: `${subjectName} — grading sheets not locked`,
      statLabel: 'Sheet',
      description: `Each row is a ${subjectName} grading sheet that hasn't been locked yet.`,
      rowUnit: 'sheets',
    };
  }

  if (groupKey === 'missing-comments') {
    const commentTerms = commentTermsInScope(payload, filters.termNumber);
    const rows: MasterfileDrillRow[] = [];
    for (const r of enrolled) {
      const missing = studentMissingCommentTerms(r, commentTerms);
      if (missing.length > 0) {
        const termList = missing.map((n) => `T${n}`).join(', ');
        rows.push(toRow(r, `${termList} blank`));
      }
    }
    return {
      rows: sortRows(rows),
      title: 'Adviser comments still coming in',
      statLabel: 'Blank terms',
      description:
        'Each student below is missing at least one T1–T3 adviser comment.',
      rowUnit: 'students',
    };
  }

  return {
    rows: [],
    title: 'Still coming in',
    statLabel: 'Detail',
    description: '',
    rowUnit: 'students',
  };
}
