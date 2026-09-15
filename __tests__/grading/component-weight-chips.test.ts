/**
 * The chips preview what the server will save.
 *
 * Two implementations of the same arithmetic exist on purpose: the server's
 * (`lib/grading/resolve-sheet-weights.ts`) is what actually writes the row, and
 * the client's (`components/grading/component-weight-chips.tsx`) is what the
 * coordinator sees move as they untick a component. A screen that previews
 * 37/63 and saves 38/62 is worse than one that previews nothing at all, so the
 * two are pinned against each other here rather than trusted to stay in step.
 *
 * If this file fails, the fix is to make them agree — not to relax the test.
 */

import { describe, it, expect } from 'vitest';

import { redistributeWeights } from '@/lib/grading/resolve-sheet-weights';
import { redistributePercents } from '@/components/grading/component-weight-chips';

type Component = 'ww' | 'pt' | 'qa';

/** Every weight split in HFSE's DepEd table, plus the canonical test case. */
const SPLITS: { ww: number; pt: number; qa: number }[] = [
  { ww: 40, pt: 40, qa: 20 }, // Math / Science — Hard Rule #1's case
  { ww: 30, pt: 50, qa: 20 }, // Language / AP — Filipino, Global Perspectives
  { ww: 20, pt: 60, qa: 20 }, // MAPEH family
  { ww: 35, pt: 45, qa: 20 },
  { ww: 33, pt: 33, qa: 34 },
];

const SHAPES: Record<Component, boolean>[] = [
  { ww: true, pt: true, qa: true },
  { ww: true, pt: true, qa: false },
  { ww: false, pt: true, qa: true },
  { ww: true, pt: false, qa: true },
  { ww: false, pt: true, qa: false },
  { ww: true, pt: false, qa: false },
  { ww: false, pt: false, qa: true },
];

describe('client and server redistribution agree', () => {
  it('produces identical weights for every split and component shape', () => {
    for (const split of SPLITS) {
      for (const inUse of SHAPES) {
        const client = redistributePercents(split, inUse);

        const server = redistributeWeights(
          {
            ww_weight: split.ww / 100,
            pt_weight: split.pt / 100,
            qa_weight: split.qa / 100,
          },
          inUse
        );

        const label = `${split.ww}/${split.pt}/${split.qa} keeping ${
          (Object.keys(inUse) as Component[])
            .filter((c) => inUse[c])
            .join('+') || 'nothing'
        }`;

        expect(client.ww, label).toBe(Math.round(server.ww_weight * 100));
        expect(client.pt, label).toBe(Math.round(server.pt_weight * 100));
        expect(client.qa, label).toBe(Math.round(server.qa_weight * 100));
      }
    }
  });

  it('always sums to 100, so the sheet never grades out of 99', () => {
    for (const split of SPLITS) {
      for (const inUse of SHAPES) {
        const out = redistributePercents(split, inUse);
        expect(out.ww + out.pt + out.qa).toBe(100);
      }
    }
  });

  it('gives an unticked component exactly zero, never a rounding crumb', () => {
    for (const split of SPLITS) {
      for (const inUse of SHAPES) {
        const out = redistributePercents(split, inUse);
        for (const c of ['ww', 'pt', 'qa'] as Component[]) {
          if (!inUse[c]) expect(out[c]).toBe(0);
        }
      }
    }
  });

  it('leaves a full three-component split untouched', () => {
    for (const split of SPLITS) {
      expect(
        redistributePercents(split, { ww: true, pt: true, qa: true })
      ).toEqual(split);
    }
  });

  it('breaks the Filipino 37.5 tie toward performance tasks, on both sides', () => {
    // 30/80 and 50/80 are exactly 37.5 and 62.5 — a real tie. The spare point
    // goes to the component already carrying more. Pinned because the first
    // implementation resolved it by floating-point accident.
    expect(
      redistributePercents(
        { ww: 30, pt: 50, qa: 20 },
        { ww: true, pt: true, qa: false }
      )
    ).toEqual({ ww: 37, pt: 63, qa: 0 });
  });
});
