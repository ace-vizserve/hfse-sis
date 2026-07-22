/**
 * Tests for lib/evaluation/roster-rules.ts — the three predicates
 * lib/evaluation/dashboard.ts (rollup KPIs) and lib/evaluation/drill.ts
 * (display rows) both consume, extracted so they can't drift apart:
 *
 *   1. T4 exclusion (KD #49) — no FCA write-up ever exists for Term 4.
 *   2. Active-roster gate (KD #120) — only non-withdrawn students count.
 *   3. Submitted + non-empty derivation (KD #120) — submitted=true AND
 *      non-empty content after trim.
 */

import { describe, it, expect } from 'vitest';
import {
  FCA_EXCLUDED_TERM_NUMBER,
  WITHDRAWN_ENROLLMENT_STATUS,
  hasWriteupContent,
  isActiveRosterStatus,
  isFcaEligibleTermNumber,
  isSubmittedWriteup,
} from '@/lib/evaluation/roster-rules';

describe('isFcaEligibleTermNumber (KD #49 — T4 exclusion)', () => {
  it('excludes Term 4', () => {
    expect(isFcaEligibleTermNumber(4)).toBe(false);
  });

  it('includes Term 1, 2, 3', () => {
    expect(isFcaEligibleTermNumber(1)).toBe(true);
    expect(isFcaEligibleTermNumber(2)).toBe(true);
    expect(isFcaEligibleTermNumber(3)).toBe(true);
  });

  it('the excluded constant is 4', () => {
    expect(FCA_EXCLUDED_TERM_NUMBER).toBe(4);
  });
});

describe('isActiveRosterStatus (KD #120 — active-roster gate)', () => {
  it('active counts', () => {
    expect(isActiveRosterStatus('active')).toBe(true);
  });

  it('late_enrollee counts (still owes a write-up)', () => {
    expect(isActiveRosterStatus('late_enrollee')).toBe(true);
  });

  it('withdrawn does NOT count', () => {
    expect(isActiveRosterStatus('withdrawn')).toBe(false);
  });

  it('the withdrawn constant matches the DB enum value', () => {
    expect(WITHDRAWN_ENROLLMENT_STATUS).toBe('withdrawn');
    expect(isActiveRosterStatus(WITHDRAWN_ENROLLMENT_STATUS)).toBe(false);
  });
});

describe('hasWriteupContent', () => {
  it('true for non-empty text', () => {
    expect(hasWriteupContent('Great progress this term.')).toBe(true);
  });

  it('false for null', () => {
    expect(hasWriteupContent(null)).toBe(false);
  });

  it('false for undefined', () => {
    expect(hasWriteupContent(undefined)).toBe(false);
  });

  it('false for empty string', () => {
    expect(hasWriteupContent('')).toBe(false);
  });

  it('false for whitespace-only string (trims before checking)', () => {
    expect(hasWriteupContent('   \n\t  ')).toBe(false);
  });

  it('true for text with surrounding whitespace', () => {
    expect(hasWriteupContent('  hello  ')).toBe(true);
  });
});

describe('isSubmittedWriteup (KD #120 — submitted AND non-empty)', () => {
  it('submitted + content → true', () => {
    expect(isSubmittedWriteup({ submitted: true, hasContent: true })).toBe(
      true
    );
  });

  it('submitted + emptied content → false (the KD #120 case)', () => {
    expect(isSubmittedWriteup({ submitted: true, hasContent: false })).toBe(
      false
    );
  });

  it('not submitted + content (a draft) → false', () => {
    expect(isSubmittedWriteup({ submitted: false, hasContent: true })).toBe(
      false
    );
  });

  it('not submitted + no content → false', () => {
    expect(isSubmittedWriteup({ submitted: false, hasContent: false })).toBe(
      false
    );
  });

  it('composes with hasWriteupContent for raw writeup text', () => {
    const raw = '   ';
    expect(
      isSubmittedWriteup({
        submitted: true,
        hasContent: hasWriteupContent(raw),
      })
    ).toBe(false);

    const real = 'Did well this term.';
    expect(
      isSubmittedWriteup({
        submitted: true,
        hasContent: hasWriteupContent(real),
      })
    ).toBe(true);
  });
});
