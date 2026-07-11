import { describe, expect, it } from 'vitest';
import {
  LevelAdminCreateSchema,
  LevelAdminUpdateSchema,
  LevelOfferingSchema,
} from '@/lib/schemas/level';

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('LevelAdminCreateSchema', () => {
  const base = {
    code: 'CS3',
    label: 'Cambridge Secondary Three',
    levelType: 'secondary' as const,
    sortOrder: 16,
    nextLevelId: null,
  };

  it('accepts a valid volatile-level create input', () => {
    const r = LevelAdminCreateSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('accepts a valid nextLevelId uuid', () => {
    const r = LevelAdminCreateSchema.safeParse({
      ...base,
      nextLevelId: VALID_UUID,
    });
    expect(r.success).toBe(true);
  });

  it('accepts each levelType', () => {
    for (const levelType of ['primary', 'secondary', 'preschool'] as const) {
      const r = LevelAdminCreateSchema.safeParse({ ...base, levelType });
      expect(r.success).toBe(true);
    }
  });

  it('trims label whitespace', () => {
    const r = LevelAdminCreateSchema.safeParse({
      ...base,
      label: '  Cambridge Secondary Three  ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.label).toBe('Cambridge Secondary Three');
  });

  describe('code', () => {
    it('rejects lowercase letters', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, code: 'cs3' });
      expect(r.success).toBe(false);
    });

    it('rejects mixed case', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, code: 'Cs3' });
      expect(r.success).toBe(false);
    });

    it('rejects underscore', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, code: 'CS_3' });
      expect(r.success).toBe(false);
    });

    it('rejects spaces', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, code: 'CS 3' });
      expect(r.success).toBe(false);
    });

    it('rejects empty code', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, code: '' });
      expect(r.success).toBe(false);
    });

    it('rejects code over 8 chars', () => {
      const r = LevelAdminCreateSchema.safeParse({
        ...base,
        code: 'ABCDEFGHI',
      });
      expect(r.success).toBe(false);
    });

    it('accepts code at the 8-char boundary', () => {
      const r = LevelAdminCreateSchema.safeParse({
        ...base,
        code: 'ABCDEFGH',
      });
      expect(r.success).toBe(true);
    });

    it('accepts a single-character code', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, code: 'A' });
      expect(r.success).toBe(true);
    });

    it('accepts digits and hyphens', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, code: 'YS-L2' });
      expect(r.success).toBe(true);
    });
  });

  describe('label', () => {
    it('rejects empty label', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, label: '' });
      expect(r.success).toBe(false);
    });

    it('rejects whitespace-only label', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, label: '   ' });
      expect(r.success).toBe(false);
    });

    it('accepts label at the 80-char boundary', () => {
      const r = LevelAdminCreateSchema.safeParse({
        ...base,
        label: 'A'.repeat(80),
      });
      expect(r.success).toBe(true);
    });

    it('rejects label over 80 chars', () => {
      const r = LevelAdminCreateSchema.safeParse({
        ...base,
        label: 'A'.repeat(81),
      });
      expect(r.success).toBe(false);
    });
  });

  describe('levelType', () => {
    it('rejects an unrecognised value', () => {
      const r = LevelAdminCreateSchema.safeParse({
        ...base,
        levelType: 'college',
      });
      expect(r.success).toBe(false);
    });

    it('rejects missing levelType', () => {
      const { levelType: _omit, ...rest } = base;
      const r = LevelAdminCreateSchema.safeParse(rest);
      expect(r.success).toBe(false);
    });
  });

  describe('sortOrder', () => {
    it('rejects 0 (below the 1-99 range)', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, sortOrder: 0 });
      expect(r.success).toBe(false);
    });

    it('accepts the lower boundary of 1', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, sortOrder: 1 });
      expect(r.success).toBe(true);
    });

    it('accepts the upper boundary of 99', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, sortOrder: 99 });
      expect(r.success).toBe(true);
    });

    it('rejects above 99', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, sortOrder: 100 });
      expect(r.success).toBe(false);
    });

    it('rejects a non-integer', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, sortOrder: 1.5 });
      expect(r.success).toBe(false);
    });

    it('rejects a negative value', () => {
      const r = LevelAdminCreateSchema.safeParse({ ...base, sortOrder: -1 });
      expect(r.success).toBe(false);
    });
  });

  describe('nextLevelId', () => {
    it('rejects a malformed uuid', () => {
      const r = LevelAdminCreateSchema.safeParse({
        ...base,
        nextLevelId: 'not-a-uuid',
      });
      expect(r.success).toBe(false);
    });

    it('rejects a missing nextLevelId key', () => {
      const { nextLevelId: _omit, ...rest } = base;
      const r = LevelAdminCreateSchema.safeParse(rest);
      expect(r.success).toBe(false);
    });
  });
});

describe('LevelAdminUpdateSchema', () => {
  it('accepts a label-only partial update', () => {
    const r = LevelAdminUpdateSchema.safeParse({ label: 'Primary Six' });
    expect(r.success).toBe(true);
  });

  it('accepts a sortOrder-only partial update', () => {
    const r = LevelAdminUpdateSchema.safeParse({ sortOrder: 9 });
    expect(r.success).toBe(true);
  });

  it('accepts a nextLevelId-only partial update with a uuid', () => {
    const r = LevelAdminUpdateSchema.safeParse({ nextLevelId: VALID_UUID });
    expect(r.success).toBe(true);
  });

  it('accepts nextLevelId: null (clearing the final-level pointer)', () => {
    const r = LevelAdminUpdateSchema.safeParse({ nextLevelId: null });
    expect(r.success).toBe(true);
  });

  it('accepts multiple fields at once', () => {
    const r = LevelAdminUpdateSchema.safeParse({
      label: 'Primary Six',
      sortOrder: 9,
      nextLevelId: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejects an empty object — at least one field required', () => {
    const r = LevelAdminUpdateSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects an invalid label when present', () => {
    const r = LevelAdminUpdateSchema.safeParse({ label: '' });
    expect(r.success).toBe(false);
  });

  it('rejects an out-of-range sortOrder when present', () => {
    const r = LevelAdminUpdateSchema.safeParse({ sortOrder: 100 });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed nextLevelId when present', () => {
    const r = LevelAdminUpdateSchema.safeParse({ nextLevelId: 'nope' });
    expect(r.success).toBe(false);
  });
});

describe('LevelOfferingSchema', () => {
  it('accepts a valid offer-on payload', () => {
    const r = LevelOfferingSchema.safeParse({
      academicYearId: VALID_UUID,
      offered: true,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a valid offer-off payload', () => {
    const r = LevelOfferingSchema.safeParse({
      academicYearId: VALID_UUID,
      offered: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a malformed academicYearId', () => {
    const r = LevelOfferingSchema.safeParse({
      academicYearId: 'not-a-uuid',
      offered: true,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing academicYearId', () => {
    const r = LevelOfferingSchema.safeParse({ offered: true });
    expect(r.success).toBe(false);
  });

  it('rejects a missing offered flag', () => {
    const r = LevelOfferingSchema.safeParse({ academicYearId: VALID_UUID });
    expect(r.success).toBe(false);
  });

  it('rejects a non-boolean offered value', () => {
    const r = LevelOfferingSchema.safeParse({
      academicYearId: VALID_UUID,
      offered: 'yes',
    });
    expect(r.success).toBe(false);
  });
});
