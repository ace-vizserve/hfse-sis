import { describe, it, expect } from 'vitest';

import { subjectDisplayName } from '@/lib/sis/subjects/display-name';

// The school renamed MAPEH to STAR for AY2026 and AY2025 keeps the old name,
// so the name belongs to the (subject, year) pair. These pin the resolution
// order, because every surface in the app has to agree on it.
describe('subjectDisplayName', () => {
  const mapeh = { name: 'MAPEH', report_label: null };

  it('falls back to the catalogue name when nothing overrides it', () => {
    expect(subjectDisplayName(mapeh)).toBe('MAPEH');
    expect(subjectDisplayName(mapeh, null)).toBe('MAPEH');
    expect(subjectDisplayName(mapeh, { display_name: null })).toBe('MAPEH');
  });

  it("uses the year's own name when one is set", () => {
    expect(subjectDisplayName(mapeh, { display_name: 'STAR' })).toBe('STAR');
  });

  it('leaves a year with no override on the old name', () => {
    // The whole point: AY2026 renames, AY2025 does not.
    const ay2026 = { display_name: 'STAR' };
    const ay2025 = { display_name: null };
    expect(subjectDisplayName(mapeh, ay2026)).toBe('STAR');
    expect(subjectDisplayName(mapeh, ay2025)).toBe('MAPEH');
  });

  it('honours the global report label when the year says nothing', () => {
    const withLabel = { name: 'MAPEH', report_label: 'MAPEH (Combined)' };
    expect(subjectDisplayName(withLabel)).toBe('MAPEH (Combined)');
    expect(subjectDisplayName(withLabel, { display_name: null })).toBe(
      'MAPEH (Combined)'
    );
  });

  // A year-specific name is the more specific statement about the same thing,
  // so it wins over a global label rather than the other way round.
  it('prefers the year name over the report label', () => {
    const withLabel = { name: 'MAPEH', report_label: 'MAPEH (Combined)' };
    expect(subjectDisplayName(withLabel, { display_name: 'STAR' })).toBe(
      'STAR'
    );
  });

  // Migration 137's CHECK refuses to STORE a blank, but an unsaved form can
  // still hand one over, and an empty subject heading is worse than a stale
  // name.
  it('treats blank and whitespace-only overrides as absent', () => {
    expect(subjectDisplayName(mapeh, { display_name: '' })).toBe('MAPEH');
    expect(subjectDisplayName(mapeh, { display_name: '   ' })).toBe('MAPEH');
    expect(subjectDisplayName({ name: 'MAPEH', report_label: '  ' })).toBe(
      'MAPEH'
    );
  });

  it('trims a stored name rather than rendering its padding', () => {
    expect(subjectDisplayName(mapeh, { display_name: ' STAR ' })).toBe('STAR');
  });
});
