import { describe, it, expect } from 'vitest';

import {
  deriveApplicationFit,
  scheduleFromPortal,
  sectionMatchesApplication,
  type AdmissionTrack,
} from '@/lib/admissions/options';

// The section picker's "Matches their application" hint (plan Phase 4).

const opt = (
  level_label: string,
  class_type_label: string,
  track: AdmissionTrack
) => ({ level_label, class_type_label, track });

describe('scheduleFromPortal', () => {
  it('maps the portal words to the SIS vocabulary', () => {
    expect(scheduleFromPortal('Morning')).toBe('morning');
    expect(scheduleFromPortal('Afternoon')).toBe('afternoon');
    expect(scheduleFromPortal('Whole Day')).toBe('whole_day');
  });

  it('forgives case and spacing', () => {
    expect(scheduleFromPortal('  MORNING ')).toBe('morning');
    expect(scheduleFromPortal('whole   day')).toBe('whole_day');
  });

  it('returns null for anything else', () => {
    expect(scheduleFromPortal(null)).toBeNull();
    expect(scheduleFromPortal(undefined)).toBeNull();
    expect(scheduleFromPortal('')).toBeNull();
    expect(scheduleFromPortal('Evening')).toBeNull();
    expect(scheduleFromPortal('whole_day')).toBeNull();
  });
});

describe('deriveApplicationFit', () => {
  const options = [
    opt('Primary One', 'Standard Class', 'Standard'),
    // A label whose words would guess wrong — the row must win.
    opt('Primary One', 'International Education Programme', 'Global'),
  ];

  it('takes the track from the matching options row', () => {
    expect(
      deriveApplicationFit(
        {
          levelApplied: 'Primary One',
          classType: 'International Education Programme',
          preferredSchedule: 'Morning',
        },
        options
      )
    ).toEqual({ track: 'Global', schedule: 'morning' });
  });

  it('falls back to the words when no row matches (a retired label)', () => {
    expect(
      deriveApplicationFit(
        {
          levelApplied: 'Primary One',
          classType: 'Global Class',
          preferredSchedule: 'Afternoon',
        },
        options
      )
    ).toEqual({ track: 'Global', schedule: 'afternoon' });
    expect(
      deriveApplicationFit(
        {
          levelApplied: 'Primary Two',
          classType: 'International Education Programme',
          preferredSchedule: null,
        },
        options
      )
    ).toEqual({ track: 'Standard', schedule: null });
  });

  it('gives no track for a blank class type', () => {
    expect(
      deriveApplicationFit(
        {
          levelApplied: 'Primary One',
          classType: '  ',
          preferredSchedule: 'Morning',
        },
        options
      )
    ).toEqual({ track: null, schedule: 'morning' });
    expect(
      deriveApplicationFit(
        { levelApplied: null, classType: null, preferredSchedule: null },
        []
      )
    ).toEqual({ track: null, schedule: null });
  });
});

describe('sectionMatchesApplication', () => {
  const fit = { track: 'Global' as const, schedule: 'morning' as const };

  it('matches when both track and schedule agree', () => {
    expect(
      sectionMatchesApplication(
        { classType: 'Global', schedule: 'morning' },
        fit
      )
    ).toBe(true);
  });

  it('does not match when either differs', () => {
    expect(
      sectionMatchesApplication(
        { classType: 'Standard', schedule: 'morning' },
        fit
      )
    ).toBe(false);
    expect(
      sectionMatchesApplication(
        { classType: 'Global', schedule: 'afternoon' },
        fit
      )
    ).toBe(false);
  });

  it('never matches a section missing its class type or schedule', () => {
    expect(
      sectionMatchesApplication({ classType: null, schedule: 'morning' }, fit)
    ).toBe(false);
    expect(
      sectionMatchesApplication({ classType: 'Global', schedule: null }, fit)
    ).toBe(false);
  });

  it('is strict: an application missing either fact matches nothing', () => {
    const section = { classType: 'Global', schedule: 'morning' };
    expect(
      sectionMatchesApplication(section, { track: 'Global', schedule: null })
    ).toBe(false);
    expect(
      sectionMatchesApplication(section, { track: null, schedule: 'morning' })
    ).toBe(false);
    expect(sectionMatchesApplication(section, null)).toBe(false);
    expect(sectionMatchesApplication(section, undefined)).toBe(false);
  });
});
