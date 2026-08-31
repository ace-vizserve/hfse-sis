import { describe, it, expect } from 'vitest';

import {
  subjectDisplayName,
  subjectReportName,
} from '@/lib/sis/subjects/display-name';

/**
 * The school renamed MAPEH to STAR for AY2026 and AY2025 keeps the old name,
 * so the name belongs to the (subject, year) pair. Every surface in the app has
 * to agree on the order these resolve in, which is why it is pinned here rather
 * than left to each caller.
 *
 * ⚠ THE TWO FUNCTIONS ARE THE POINT. They were one chain
 * (`display_name -> report_label -> name`) until the read sweep gave that chain
 * callers, at which point MAPEH's report label of 'STAR' started answering for
 * AY2025 markbook screens — the year that is supposed to keep saying MAPEH. A
 * report label is narrower than a name, so it may only widen the answer for the
 * one surface it names. Migration 138 split the column; this splits the rule.
 */
describe('subjectDisplayName — what every screen calls it', () => {
  const mapeh = { name: 'MAPEH' };

  it('falls back to the catalogue name when the year set nothing', () => {
    expect(subjectDisplayName(mapeh)).toBe('MAPEH');
    expect(subjectDisplayName(mapeh, null)).toBe('MAPEH');
    expect(subjectDisplayName(mapeh, { display_name: null })).toBe('MAPEH');
  });

  it("uses the year's own name when one is set", () => {
    expect(subjectDisplayName(mapeh, { display_name: 'STAR' })).toBe('STAR');
  });

  it('leaves a year with no override on the old name', () => {
    // The whole point: AY2026 renames, AY2025 does not.
    expect(subjectDisplayName(mapeh, { display_name: 'STAR' })).toBe('STAR');
    expect(subjectDisplayName(mapeh, { display_name: null })).toBe('MAPEH');
  });

  it('IGNORES a report label entirely — that is the other function', () => {
    // Pinned because this exact fallback is what leaked STAR onto AY2025
    // markbook screens. A report label must never reach a non-report-card
    // surface, and the structural guarantee is that this function cannot see
    // one even when the caller passes it.
    expect(
      subjectDisplayName(mapeh, {
        display_name: null,
        report_label: 'Should never appear here',
      } as { display_name: string | null })
    ).toBe('MAPEH');
  });

  // Migration 137's CHECK refuses to STORE a blank, but an unsaved form can
  // still hand one over, and an empty subject heading is worse than a stale
  // name.
  it('treats blank and whitespace-only overrides as absent', () => {
    expect(subjectDisplayName(mapeh, { display_name: '' })).toBe('MAPEH');
    expect(subjectDisplayName(mapeh, { display_name: '   ' })).toBe('MAPEH');
  });

  it('trims a stored name rather than rendering its padding', () => {
    expect(subjectDisplayName(mapeh, { display_name: ' STAR ' })).toBe('STAR');
  });
});

describe('subjectReportName — what the report card calls it', () => {
  const mapeh = { name: 'MAPEH' };

  it('uses the report label when the year set one', () => {
    expect(
      subjectReportName(mapeh, { display_name: 'STAR', report_label: 'MAPEH' })
    ).toBe('MAPEH');
  });

  it('falls through to the year name when there is no report label', () => {
    // The card should never disagree with the rest of the app by accident,
    // only on purpose.
    expect(
      subjectReportName(mapeh, { display_name: 'STAR', report_label: null })
    ).toBe('STAR');
  });

  it('falls all the way through to the catalogue name', () => {
    expect(subjectReportName(mapeh)).toBe('MAPEH');
    expect(subjectReportName(mapeh, null)).toBe('MAPEH');
    expect(
      subjectReportName(mapeh, { display_name: null, report_label: null })
    ).toBe('MAPEH');
  });

  it('treats a blank report label as absent', () => {
    expect(
      subjectReportName(mapeh, { display_name: 'STAR', report_label: '  ' })
    ).toBe('STAR');
  });

  it('trims a stored report label', () => {
    expect(
      subjectReportName(mapeh, {
        display_name: null,
        report_label: ' MAPEH (Combined) ',
      })
    ).toBe('MAPEH (Combined)');
  });
});
