/**
 * Tests for lib/evaluation/term-short-labels.ts — the compact column-header
 * derivation for the per-term write-up progress columns on
 * /evaluation/sections (Phase 10).
 */

import { describe, it, expect } from 'vitest';
import { deriveTermShortLabels } from '@/lib/evaluation/term-short-labels';

describe('deriveTermShortLabels', () => {
  it("follows the AY's real terms — one T{n} label per term", () => {
    const result = deriveTermShortLabels([
      { id: 't1', label: 'Term 1', term_number: 1 },
      { id: 't2', label: 'Term 2', term_number: 2 },
      { id: 't3', label: 'Term 3', term_number: 3 },
    ]);
    expect(result).toEqual({ t1: 'T1', t2: 'T2', t3: 'T3' });
  });

  it('handles an AY with only two terms', () => {
    const result = deriveTermShortLabels([
      { id: 't1', label: 'Term 1', term_number: 1 },
      { id: 't2', label: 'Term 2', term_number: 2 },
    ]);
    expect(result).toEqual({ t1: 'T1', t2: 'T2' });
  });

  it('returns an empty map for no terms', () => {
    expect(deriveTermShortLabels([])).toEqual({});
  });

  it('falls back to the full label when two terms would collide on the short form', () => {
    const result = deriveTermShortLabels([
      { id: 't1', label: 'Term 1', term_number: 1 },
      { id: 't1-dup', label: 'Term 1 (make-up)', term_number: 1 },
      { id: 't2', label: 'Term 2', term_number: 2 },
    ]);
    // Both colliding rows fall back to their full label; the unambiguous
    // one keeps its short form.
    expect(result).toEqual({
      t1: 'Term 1',
      't1-dup': 'Term 1 (make-up)',
      t2: 'T2',
    });
  });
});
