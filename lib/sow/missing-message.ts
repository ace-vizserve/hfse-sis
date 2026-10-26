import { toast } from 'sonner';

/** One class the create run found without an approved scheme of work. */
export type SowMissing = { sectionName: string; subjectName: string };

/** The sentence shown after sheets are made; capped so it stays a toast. */
export function sowMissingMessage(
  missing: readonly SowMissing[],
  cap = 10
): string | null {
  if (missing.length === 0) return null;
  const shown = missing
    .slice(0, cap)
    .map((m) => `${m.sectionName} · ${m.subjectName}`)
    .join(', ');
  const more = missing.length > cap ? ` and ${missing.length - cap} more` : '';
  return `These classes have no approved scheme of work for this term: ${shown}${more}.`;
}

/**
 * Non-blocking notice after a create. The sheets already exist; this only
 * tells the coordinator which classes still need a scheme of work.
 */
export function warnSowMissing(missing: readonly SowMissing[] | undefined) {
  const message = sowMissingMessage(missing ?? []);
  if (message) toast.warning(message, { duration: 12000 });
}
