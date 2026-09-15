/** Is the markbook drill's grade_entries read stable call-to-call? Live DB. */
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
  unstable_noStore: () => {},
}));
describe('markbook grade-entry read', () => {
  it('returns the same rows twice', async () => {
    const { buildMarkbookDrillRows } = await import('@/lib/markbook/drill');
    const call = async () =>
      (await buildMarkbookDrillRows({
        ayCode: 'AY2026',
        from: '2000-01-01',
        to: '2100-01-01',
        target: 'grade-bucket-entries',
        segment: null,
        allowedSectionIds: null,
      })) as Array<{ entryId?: string; gradeBucket: string | null }>;
    const a = await call();
    const b = await call();
    const ids = (xs: Array<{ entryId?: string }>) =>
      new Set(xs.map((x) => x.entryId ?? ''));
    const A = ids(a);
    const B = ids(b);
    const onlyA = [...A].filter((x) => !B.has(x));
    const onlyB = [...B].filter((x) => !A.has(x));
    const bandSum = async () => {
      let s = 0;
      for (const k of ['dnm', 'fs', 's', 'vs', 'o']) {
        s += (
          await buildMarkbookDrillRows({
            ayCode: 'AY2026',
            from: '2000-01-01',
            to: '2100-01-01',
            target: 'grade-bucket-entries',
            segment: k,
            allowedSectionIds: null,
          })
        ).length;
      }
      return s;
    };
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          firstCallRows: a.length,
          secondCallRows: b.length,
          distinctIdsFirst: A.size,
          distinctIdsSecond: B.size,
          inFirstOnly: onlyA.length,
          inSecondOnly: onlyB.length,
          sumOfFiveBandCalls: await bandSum(),
          thirdCallRows: (await call()).length,
        },
        null,
        2
      )
    );
    expect(a.length).toBeGreaterThan(0);
  });
});
