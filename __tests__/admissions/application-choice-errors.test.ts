import { describe, expect, it } from 'vitest';

import {
  applicationChoiceErrors,
  type DerivedLevel,
} from '@/lib/admissions/options';

const OPTIONS: DerivedLevel[] = [
  {
    levelLabel: 'Primary Three',
    classTypes: [
      {
        classTypeLabel: 'Standard Class (ENGLISH + FILIPINO)',
        schedules: ['Morning', 'Afternoon'],
      },
      {
        classTypeLabel: 'GLOBAL (ENGLISH + FRENCH)',
        schedules: ['Morning', 'Afternoon'],
      },
    ],
  },
  {
    levelLabel: 'Secondary One',
    classTypes: [
      {
        classTypeLabel: 'Standard Class (ENGLISH + FILIPINO)',
        schedules: ['Whole Day'],
      },
    ],
  },
];
const STD = 'Standard Class (ENGLISH + FILIPINO)';
const EMPTY = { levelApplied: null, classType: null, preferredSchedule: null };

describe('applicationChoiceErrors', () => {
  it('accepts a combination the options hold', () => {
    expect(
      applicationChoiceErrors(
        OPTIONS,
        {
          levelApplied: 'Secondary One',
          classType: STD,
          preferredSchedule: 'Whole Day',
        },
        EMPTY
      )
    ).toEqual({});
  });

  it('refuses Whole Day at a primary level', () => {
    const e = applicationChoiceErrors(
      OPTIONS,
      {
        levelApplied: 'Primary Three',
        classType: STD,
        preferredSchedule: 'Whole Day',
      },
      EMPTY
    );
    expect(Object.keys(e)).toEqual(['preferredSchedule']);
    expect(e.preferredSchedule).toMatch(/Morning or Afternoon/);
  });

  it('refuses a class type the level does not offer', () => {
    const e = applicationChoiceErrors(
      OPTIONS,
      {
        levelApplied: 'Secondary One',
        classType: 'GLOBAL (ENGLISH + FRENCH)',
        preferredSchedule: null,
      },
      EMPTY
    );
    expect(Object.keys(e)).toEqual(['classType']);
  });

  it('refuses a level that is not on the options', () => {
    const e = applicationChoiceErrors(
      OPTIONS,
      { levelApplied: 'Year 8', classType: null, preferredSchedule: null },
      EMPTY
    );
    expect(Object.keys(e)).toEqual(['levelApplied']);
  });

  it('flags the schedule when only the level changed under it', () => {
    const before = {
      levelApplied: 'Secondary One',
      classType: STD,
      preferredSchedule: 'Whole Day',
    };
    const e = applicationChoiceErrors(
      OPTIONS,
      { ...before, levelApplied: 'Primary Three' },
      before
    );
    expect(Object.keys(e)).toEqual(['preferredSchedule']);
  });

  it('does not judge untouched values', () => {
    const legacy = {
      levelApplied: 'Primary Three',
      classType: STD,
      preferredSchedule: 'Whole Day',
    };
    expect(applicationChoiceErrors(OPTIONS, legacy, legacy)).toEqual({});
  });

  it('does not judge below a legacy level that is not on the options', () => {
    const before = {
      levelApplied: 'Grade 3',
      classType: STD,
      preferredSchedule: 'Morning',
    };
    expect(
      applicationChoiceErrors(
        OPTIONS,
        { ...before, preferredSchedule: 'Whole Day' },
        before
      )
    ).toEqual({});
  });

  it('lets blanks and an unconfigured year through, and forgives schedule case', () => {
    expect(
      applicationChoiceErrors(
        OPTIONS,
        {
          levelApplied: 'Primary Three',
          classType: null,
          preferredSchedule: null,
        },
        EMPTY
      )
    ).toEqual({});
    expect(
      applicationChoiceErrors(
        [],
        { levelApplied: 'Anything', classType: 'X', preferredSchedule: 'Y' },
        EMPTY
      )
    ).toEqual({});
    expect(
      applicationChoiceErrors(
        OPTIONS,
        {
          levelApplied: 'Secondary One',
          classType: STD,
          preferredSchedule: 'whole  day',
        },
        EMPTY
      )
    ).toEqual({});
  });
});
