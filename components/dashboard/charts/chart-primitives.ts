/**
 * Shared primitives for the recharts chart wrappers under this folder.
 *
 * Every chart (trend line, multi-series line, grouped bar, AY-comparison
 * area) formats its Y axis / tooltip values the same way — this is the
 * single source so the four near-identical copies don't drift.
 */

export type YFormat = 'number' | 'percent' | 'days';

export function formatterFor(
  format: YFormat | undefined
): ((n: number) => string) | undefined {
  switch (format) {
    case 'percent':
      return (n) => `${Math.round(n)}%`;
    case 'days':
      return (n) => `${Math.round(n)}d`;
    case 'number':
      return (n) => n.toLocaleString('en-SG');
    default:
      return undefined;
  }
}
