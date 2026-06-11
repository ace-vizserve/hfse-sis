// Pure derivation of a section's publish-readiness "concerns" (the actionable
// items behind a warn/blocked pill) + the fix-link each concern points to.
// Used by the bulk-publish dialog's expandable per-section rows so each concern
// deep-links to the right surface carrying the selected term — mirroring the
// single-section publish-window-panel (KD #75), condensed. Pure + unit-tested;
// no React, no fetches.

export type Concern = {
  code: string;
  label: string;
  severity: 'hard' | 'soft';
};

type PublishGap = { code: string; label: string; count?: number };

type CommentGate = {
  ok: boolean;
  gaps: { term_number: number; virtue_missing: boolean; missing: unknown[] }[];
};

export type ConcernSource = {
  comment_gate: CommentGate;
  hardBlockers?: PublishGap[];
  softGaps?: PublishGap[];
};

function gapLabel(g: PublishGap): string {
  return g.count != null ? `${g.label} (${g.count})` : g.label;
}

// Derive the concern list. `comments_incomplete` is expanded into up to two
// concrete concerns (adviser comments / virtue theme) using the comment-gate
// detail, so each gets its own fix link — exactly like the single-section panel.
export function concernsFor(src: ConcernSource): Concern[] {
  const out: Concern[] = [];

  const push = (gaps: PublishGap[] | undefined, severity: 'hard' | 'soft') => {
    for (const g of gaps ?? []) {
      if (g.code === 'comments_incomplete') {
        const gaps = src.comment_gate?.gaps ?? [];
        if (gaps.some((cg) => cg.missing.length > 0)) {
          out.push({ code: 'comments', label: 'Adviser comments', severity });
        }
        if (gaps.some((cg) => cg.virtue_missing)) {
          out.push({ code: 'virtue', label: 'Virtue theme', severity });
        }
        // If the gate detail is empty for some reason, fall back to the raw gap
        // so the concern is never silently dropped.
        if (gaps.length === 0) {
          out.push({ code: 'comments', label: gapLabel(g), severity });
        }
        continue;
      }
      out.push({ code: g.code, label: gapLabel(g), severity });
    }
  };

  push(src.hardBlockers, 'hard');
  push(src.softGaps, 'soft');
  return out;
}

export type ConcernHrefContext = {
  sectionId: string;
  sectionName: string;
  termId: string;
};

// Map a concern code to its fix surface, carrying the selected term where the
// destination supports it (attendance + evaluation accept `?term_id=`; grading
// uses the client-side `grading.section` facet per KD #84). Structural blockers
// with no single-click fix (`no_students`) return null (label-only).
export function concernHref(
  code: string,
  { sectionId, sectionName, termId }: ConcernHrefContext
): string | null {
  switch (code) {
    case 'attendance_incomplete':
      return `/attendance/${sectionId}?term_id=${termId}`;
    case 'comments':
      return `/evaluation/sections/${sectionId}?term_id=${termId}`;
    case 'virtue':
      return '/evaluation/virtue-themes';
    case 'no_grading_sheets':
    case 'sheets_unlocked':
    case 'grades_missing':
      return `/markbook/grading?grading.section=${encodeURIComponent(sectionName)}`;
    case 'nonexam_finals_missing':
      return '/markbook/report-cards';
    case 'letterhead_incomplete':
      return '/sis/admin/school-config';
    case 'no_students':
    default:
      return null;
  }
}
