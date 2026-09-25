import { describe, expect, it } from 'vitest';

import { isLevelLocked } from '@/lib/sis/level-lock';

describe('isLevelLocked', () => {
  it('leaves an application that is neither enrolled nor in a class open', () => {
    expect(
      isLevelLocked({ applicationStatus: 'Submitted', inClass: false })
    ).toBe(false);
    expect(isLevelLocked({ applicationStatus: null, inClass: false })).toBe(
      false
    );
  });

  it('locks once the application reads Enrolled, conditional included', () => {
    expect(
      isLevelLocked({ applicationStatus: 'Enrolled', inClass: false })
    ).toBe(true);
    expect(
      isLevelLocked({
        applicationStatus: 'Enrolled (Conditional)',
        inClass: false,
      })
    ).toBe(true);
  });

  it('locks a child placed in a class before their status reads Enrolled', () => {
    expect(
      isLevelLocked({ applicationStatus: 'Submitted', inClass: true })
    ).toBe(true);
  });
});
