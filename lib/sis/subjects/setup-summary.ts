// What a catalog subject's Delete takes with it, in plain words — pure and
// client-safe, so the catalog's confirm (components/sis/unused-subject-
// actions.tsx) and the server loader (lib/sis/subjects/usage.ts) share it.

/** Plain facts for the confirm dialog, serialisable to the client. */
export type SubjectSetupSummary = {
  /** AY codes it has weights for, sorted. */
  weightYears: string[];
  /** Distinct levels it is offered at, across years. */
  levelCount: number;
  /** Names of the subjects that report under it today. */
  reportedUnder: string[];
};

/** "A", "A and B", "A, B and C". */
export function joinList(items: string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The confirm's wording. `removed` lists what is deleted with the subject;
 * `repointed` is the sentence about subjects reporting under it (null when
 * there are none).
 */
export function describeSubjectSetup(summary: SubjectSetupSummary): {
  removed: string[];
  repointed: string | null;
} {
  const removed: string[] = [];
  if (summary.weightYears.length > 0) {
    removed.push(`Its weights for ${joinList(summary.weightYears)}`);
  }
  if (summary.levelCount === 1) {
    removed.push('The level it’s offered at');
  } else if (summary.levelCount > 1) {
    removed.push(`The ${summary.levelCount} levels it’s offered at`);
  }
  const n = summary.reportedUnder.length;
  const repointed =
    n === 0
      ? null
      : n === 1
        ? `${summary.reportedUnder[0]} reports under it on the report card today — it will report as itself instead.`
        : `${joinList(summary.reportedUnder)} report under it on the report card today — each will report as itself instead.`;
  return { removed, repointed };
}
