// lib/sis/year-setup.ts
import type { AcademicYearListItem, TermRow } from './ay-setup/queries';
import type { ReadinessStep, ReadinessStepId } from './readiness';

export type AyStatusTone = 'active' | 'early-bird' | 'inactive';

export const AY_STATUS_LABEL: Record<AyStatusTone, string> = {
  active: 'Active year',
  'early-bird': 'Early-bird open',
  inactive: 'Inactive',
};

/**
 * Resolves which AY the control center should show:
 * the requested ?ay= (if it is a real AY) → the active AY → the first AY → null.
 */
export function resolveSelectedAyCode(
  ays: ReadonlyArray<{ ay_code: string; is_current: boolean }>,
  requested: string | undefined
): string | null {
  if (ays.length === 0) return null;
  if (requested && ays.some((a) => a.ay_code === requested)) return requested;
  const active = ays.find((a) => a.is_current);
  return active ? active.ay_code : ays[0].ay_code;
}

export function ayStatusTone(ay: {
  is_current: boolean;
  accepting_applications: boolean;
}): AyStatusTone {
  if (ay.is_current) return 'active';
  if (ay.accepting_applications) return 'early-bird';
  return 'inactive';
}

/**
 * `terms.start_date`/`end_date` are date-only SGT calendar strings (KD #32).
 * Formatted with an explicit UTC timezone so the displayed day never shifts
 * depending on the rendering machine's local offset (a `new Date('2026-01-06')`
 * parses as UTC midnight; letting `toLocaleDateString` fall back to the local
 * timezone can print the previous day west of UTC).
 */
function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * The plain-English, live-data summary line rendered under each row's title
 * on the Year Setup checklist (`components/sis/year-setup/year-setup-checklist.tsx`).
 * Pure — sources only `step.fraction` (already computed by `lib/sis/readiness.ts`),
 * the selected AY's term rows, and the AY's own counts/flags. No dev jargon
 * (user rule: plain-English UI copy) — not-started fallbacks read like a
 * sentence, never "0/0" or a raw field name.
 */
export function checklistSummary(
  stepId: ReadinessStepId,
  ctx: {
    step: ReadinessStep;
    ay: AcademicYearListItem;
    terms: TermRow[];
  }
): string {
  const { step, ay, terms } = ctx;

  switch (stepId) {
    case 'ay-setup': {
      const total = terms.length;
      if (total === 0) return 'No terms configured for this year yet.';
      const dated = terms.filter((t) => t.start_date && t.end_date);
      if (dated.length === 0) return 'No term dates yet.';
      const base = `${dated.length} of ${total} term${total === 1 ? '' : 's'} dated`;
      const t1 = terms.find(
        (t) => t.term_number === 1 && t.start_date && t.end_date
      );
      if (!t1 || !t1.start_date || !t1.end_date) return `${base}.`;
      return `${base} · T1 ${formatShortDate(t1.start_date)} – ${formatShortDate(t1.end_date)}`;
    }

    case 'calendar': {
      if (!step.fraction) return 'Set term dates first.';
      const { done, total } = step.fraction;
      if (done === total)
        return `School days cover all ${total} term${total === 1 ? '' : 's'}.`;
      const remaining = total - done;
      return `${remaining} term${remaining === 1 ? '' : 's'} still ${remaining === 1 ? 'has' : 'have'} unmarked dates — attendance entry will be blocked there until they're set.`;
    }

    case 'structure-confirmed': {
      if (step.status === 'done') return 'Starting setup confirmed.';
      return 'Sections, subjects, and weights were carried forward from last year — review them, then confirm.';
    }

    case 'sections': {
      if (!step.fraction) return 'No grade levels in use yet.';
      const { done, total } = step.fraction;
      if (total === 0) return 'No grade levels in use yet.';
      return `${done} of ${total} grade level${total === 1 ? '' : 's'} have at least one class section.`;
    }

    case 'subject-weights': {
      if (!step.fraction) return 'No classes created yet.';
      const { done, total } = step.fraction;
      if (total === 0) return 'No classes created yet.';
      if (done === total)
        return `Every level's subjects are configured (${total}/${total}).`;
      const gap = total - done;
      return `${gap} level${gap === 1 ? '' : 's'} ${gap === 1 ? 'has' : 'have'} no subjects configured yet — configure them so grades and report cards have somewhere to go.`;
    }

    case 'advisers': {
      if (!step.fraction) return 'No classes to assign advisers to yet.';
      const { done, total } = step.fraction;
      if (total === 0) return 'No classes to assign advisers to yet.';
      return `${done} of ${total} class${total === 1 ? '' : 'es'} have a form adviser.`;
    }

    case 'grading-sheets': {
      if (!step.fraction) return 'No classes yet.';
      const { done, total } = step.fraction;
      if (total === 0) return 'No classes yet.';
      return `${done} of ${total} class${total === 1 ? '' : 'es'} have grading sheets.`;
    }

    case 'virtue-themes': {
      if (!step.fraction) return 'No Terms 1–3 yet.';
      const { done, total } = step.fraction;
      if (total === 0) return 'No Terms 1–3 yet.';
      return `${done} of ${total} term${total === 1 ? '' : 's'} have a virtue theme set.`;
    }

    case 'letterhead': {
      if (step.status === 'done')
        return 'Organization name and address are set.';
      if (step.status === 'partial')
        return 'Partly set — organization name or address is missing.';
      return 'No letterhead configured yet.';
    }

    case 'app-window': {
      if (ay.accepting_applications) {
        return ay.is_current
          ? 'Live — parents can apply for this year.'
          : 'Open for early-bird applications.';
      }
      return 'Closed — parents cannot apply yet.';
    }

    default:
      return '';
  }
}
