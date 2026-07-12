// Pure classifier for the sections-list index-completeness chip (Phase 3
// redesign) — surfaces what was previously invisible without opening each
// section (Joann's named misaligned-index-numbers pain point).

export type IndexStatus = { label: string; tone: 'mint' | 'amber' };

export function computeIndexStatus(
  activeCount: number,
  unnumberedCount: number
): IndexStatus {
  if (unnumberedCount === 0) {
    return { label: `Index #1–${activeCount} complete`, tone: 'mint' };
  }
  return {
    label: `${unnumberedCount} student${unnumberedCount === 1 ? '' : 's'} unnumbered`,
    tone: 'amber',
  };
}
