// lib/sis/hub-readiness-summary.ts
import type { ReadinessStep, ReadinessStepId } from './readiness';

/** Ring fill percentage for a step's progress ring. Boolean steps (no
 * fraction, e.g. letterhead/app-window) render full or empty by status. */
export function ringPercent(step: ReadinessStep): number {
  if (step.fraction) {
    const { done, total } = step.fraction;
    return total > 0 ? (done / total) * 100 : 0;
  }
  return step.status === 'done' ? 100 : 0;
}

/** Right-side badge text — honest per-step state, never a fabricated trend. */
export function stepBadgeLabel(step: ReadinessStep): string {
  if (step.status === 'done') return 'Ready';
  if (step.status === 'partial' && step.fraction) {
    return `${step.fraction.done}/${step.fraction.total}`;
  }
  return step.required ? 'Not started' : 'Optional';
}

// Mirrors CLUSTER_LABEL_BEFORE in components/sis/year-setup/year-setup-checklist.tsx —
// keep these two maps in sync if the checklist's own grouping ever changes.
const POPOVER_CLUSTERS: Array<{ label: string; stepIds: ReadinessStepId[] }> = [
  { label: 'Core setup', stepIds: ['ay-setup', 'calendar'] },
  {
    label: 'Grading & staffing',
    stepIds: [
      'sections',
      'subject-weights',
      'advisers',
      'section-subjects',
      'grading-sheets',
    ],
  },
  { label: 'Branding & admissions', stepIds: ['virtue-themes', 'letterhead'] },
  { label: 'Optional', stepIds: ['app-window'] },
];

export function groupStepsForPopover(
  steps: ReadinessStep[]
): Array<{ label: string; steps: ReadinessStep[] }> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  return POPOVER_CLUSTERS.map((cluster) => ({
    label: cluster.label,
    steps: cluster.stepIds
      .map((id) => byId.get(id))
      .filter((s): s is ReadinessStep => !!s),
  })).filter((g) => g.steps.length > 0);
}
