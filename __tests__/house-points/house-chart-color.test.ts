import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { houseChartColor } from '@/lib/sis/houses';

// Tailwind v4 (`@theme inline`) emits a `--color-*` custom property only when
// the source names it literally. The house page once built
// `var(--color-house-N)` from a template, the property did not exist, and
// every bar drew black. Chart fills go through houseChartColor → `--av-*`.

describe('houseChartColor', () => {
  it('returns the raw --av-house token for each house', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(houseChartColor(`house-${n}`)).toBe(`var(--av-house-${n})`);
    }
  });

  it('falls back to muted ink for an unknown token', () => {
    expect(houseChartColor('house-9')).toBe('var(--av-ink-5)');
  });

  it('the house page builds no --color-* variable from a template', () => {
    const page = readFileSync(
      join(
        process.cwd(),
        'app/(records)/records/house-points/houses/[code]/page.tsx'
      ),
      'utf8'
    );
    expect(page).not.toMatch(/var\(--color-\$\{/);
    expect(page).not.toMatch(/--color-house-/);
  });
});
