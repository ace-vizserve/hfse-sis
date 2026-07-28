import { describe, expect, it } from 'vitest';

import { isWriteupComplete } from '@/lib/classroom/writeups';

describe('isWriteupComplete', () => {
  it('is complete when submitted with real content', () => {
    expect(isWriteupComplete({ submitted: true, writeup: 'Great term.' })).toBe(
      true
    );
  });

  it('is NOT complete when submitted but emptied (KD #120/#126)', () => {
    expect(isWriteupComplete({ submitted: true, writeup: '' })).toBe(false);
  });

  it('is NOT complete when submitted but whitespace-only', () => {
    expect(isWriteupComplete({ submitted: true, writeup: '   ' })).toBe(false);
  });

  it('is NOT complete when submitted but writeup is null', () => {
    expect(isWriteupComplete({ submitted: true, writeup: null })).toBe(false);
  });

  it('is NOT complete when drafted (has content) but not submitted', () => {
    expect(
      isWriteupComplete({ submitted: false, writeup: 'Draft in progress.' })
    ).toBe(false);
  });

  it('is NOT complete when neither submitted nor drafted', () => {
    expect(isWriteupComplete({ submitted: false, writeup: null })).toBe(false);
  });
});
