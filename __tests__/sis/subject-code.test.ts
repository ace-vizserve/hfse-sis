import { describe, expect, it } from 'vitest';

import {
  baseSubjectCode,
  generateSubjectCode,
} from '@/lib/sis/subjects/subject-code';

describe('baseSubjectCode', () => {
  it('takes the first 4 letters of a one-word name', () => {
    expect(baseSubjectCode('Economics')).toBe('ECON');
    expect(baseSubjectCode('History')).toBe('HIST');
    expect(baseSubjectCode('  art  ')).toBe('ART');
  });

  it('takes the initials of several words, skipping and / & / of / the', () => {
    expect(baseSubjectCode('Global Perspectives')).toBe('GP');
    expect(baseSubjectCode('Christian Living')).toBe('CL');
    expect(baseSubjectCode('Music and Arts')).toBe('MA');
    expect(baseSubjectCode('Music & Arts')).toBe('MA');
    expect(baseSubjectCode('History of the Philippines')).toBe('HP');
  });

  it('a name that is one significant word plus stop words is one word', () => {
    expect(baseSubjectCode('The Arts')).toBe('ARTS');
  });

  it('keeps letters only and folds accents', () => {
    expect(baseSubjectCode('Économie')).toBe('ECON');
    expect(baseSubjectCode('Español Básico')).toBe('EB');
    expect(baseSubjectCode('Math 2')).toBe('MATH');
    expect(baseSubjectCode('P.E.')).toBe('PE');
  });

  it('falls back when there are no letters', () => {
    expect(baseSubjectCode('123')).toBe('SUBJ');
    expect(baseSubjectCode('')).toBe('SUBJ');
  });

  it('uses stop words when the name is only stop words', () => {
    expect(baseSubjectCode('The And')).toBe('TA');
  });
});

describe('generateSubjectCode', () => {
  it('returns the base code when it is free', () => {
    expect(generateSubjectCode('Economics', ['MATH', 'ENG'])).toBe('ECON');
  });

  it('appends 2, 3, … when the code is taken', () => {
    expect(generateSubjectCode('Economics', ['ECON'])).toBe('ECON2');
    expect(generateSubjectCode('Economics', ['ECON', 'ECON2'])).toBe('ECON3');
  });

  it('compares case-insensitively', () => {
    expect(generateSubjectCode('Christian Living', ['cl', 'Cl2'])).toBe('CL3');
  });
});
