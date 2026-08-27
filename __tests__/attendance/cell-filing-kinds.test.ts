import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REGISTER_WRITING_TYPES } from '@/lib/declarations/register';

// "Which filings can explain a mark on the attendance sheet?" must be the same
// question as "which filings write marks", and it must have ONE answer.
//
// It did not, and the gap was silent. `REGISTER_WRITING_TYPES` gained `travel`
// when KD #199 shipped, while `loadCellFilingsForSection` kept its own
// `.eq('declaration_type', 'absence')` filter and a comment explaining that
// travel "marks nothing until Phase 4" — Phase 4 having landed the same day.
//
// The consequence was not cosmetic. With no filing on the cell:
//   * the sheet showed a day marked Excused / Vacation leave with nothing
//     saying who excused it, which is the guessing KD #195 exists to stop; and
//   * the override confirmation (KD #198) never fired, so a teacher could
//     overwrite a holiday two people had approved with no warning at all.
//
// Nothing caught it because `cell-filings.ts` had no test of any kind.

const CELL_FILINGS = readFileSync(
  join(process.cwd(), 'lib/declarations/cell-filings.ts'),
  'utf8'
);

describe('a filing that marks the register can explain the mark', () => {
  it('counts both kinds as register-writing', () => {
    // If a third kind is ever added, this fails and points whoever added it at
    // the sheet — which is the surface most likely to be forgotten.
    expect([...REGISTER_WRITING_TYPES].sort()).toEqual(['absence', 'travel']);
  });

  it('reads the kinds from the register rather than restating them', () => {
    // ⚠ The real guard. A hardcoded equality here is precisely the drift that
    // shipped: correct on the day it was written, wrong hours later, and
    // invisible because it lives in a different file from the rule it copies.
    expect(
      CELL_FILINGS.includes('REGISTER_WRITING_TYPES'),
      'cell-filings.ts must filter on the shared set, not its own list.'
    ).toBe(true);
    expect(
      /\.eq\(\s*['"]declaration_type['"]/.test(CELL_FILINGS),
      'cell-filings.ts must not pin declaration_type to one literal kind.'
    ).toBe(false);
  });

  it('proves the guard can fail', () => {
    // The regex above is the whole assertion, and a regex that never matches
    // anything passes forever. The CORS guard in this repo shipped exactly that
    // mistake (KD #195), so this checks the pattern actually catches the shape
    // it is meant to ban.
    expect(
      /\.eq\(\s*['"]declaration_type['"]/.test(
        `.eq('declaration_type', 'absence')`
      )
    ).toBe(true);
  });
});
