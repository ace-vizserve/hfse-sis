import { describe, expect, it } from 'vitest';
import {
  LevelCreateSchema,
  LevelRemapSchema,
  LEVEL_TYPE_VALUES,
} from '@/lib/schemas/level';

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('LevelCreateSchema', () => {
  describe('valid inputs', () => {
    it('accepts a valid create input with canonical level', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P1',
        level_type: 'primary',
      });
      expect(r.success).toBe(true);
    });

    it('accepts secondary level', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Secondary Three',
        code: 'S3',
        level_type: 'secondary',
      });
      expect(r.success).toBe(true);
    });

    it('accepts preschool level', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Youngstarters | Little Stars',
        code: 'YS-L',
        level_type: 'preschool',
      });
      expect(r.success).toBe(true);
    });

    it('accepts code with digits', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Cambridge Secondary One',
        code: 'CS1',
        level_type: 'secondary',
      });
      expect(r.success).toBe(true);
    });

    it('accepts code with dashes', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Youngstarters | Senior Stars',
        code: 'YS-S',
        level_type: 'preschool',
      });
      expect(r.success).toBe(true);
    });

    it('accepts label with maximum length (120 chars)', () => {
      const longLabel = 'A'.repeat(120);
      const r = LevelCreateSchema.safeParse({
        label: longLabel,
        code: 'TEST',
        level_type: 'primary',
      });
      expect(r.success).toBe(true);
    });

    it('accepts code with maximum length (10 chars)', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Test Level',
        code: 'ABCDE-1234',
        level_type: 'primary',
      });
      expect(r.success).toBe(true);
    });

    it('trims whitespace from label and code', () => {
      const r = LevelCreateSchema.safeParse({
        label: '  Primary One  ',
        code: '  P1  ',
        level_type: 'primary',
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.label).toBe('Primary One');
        expect(r.data.code).toBe('P1');
      }
    });
  });

  describe('invalid label', () => {
    it('rejects empty label', () => {
      const r = LevelCreateSchema.safeParse({
        label: '',
        code: 'P1',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects whitespace-only label', () => {
      const r = LevelCreateSchema.safeParse({
        label: '   ',
        code: 'P1',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects label exceeding max length (121 chars)', () => {
      const longLabel = 'A'.repeat(121);
      const r = LevelCreateSchema.safeParse({
        label: longLabel,
        code: 'P1',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('invalid code', () => {
    it('rejects empty code', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: '',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects whitespace-only code', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: '   ',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects code with lowercase letters', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'p1',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects code with mixed case', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P1a',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects code with spaces', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P 1',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects code with underscore', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P_1',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects code with special characters', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P@1',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects code exceeding max length (11 chars)', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'ABCDE-12345',
        level_type: 'primary',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('invalid level_type', () => {
    it('rejects invalid level_type value', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P1',
        level_type: 'invalid',
      });
      expect(r.success).toBe(false);
    });

    it('rejects level_type with wrong case', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P1',
        level_type: 'Primary',
      });
      expect(r.success).toBe(false);
    });

    it('rejects missing level_type', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Primary One',
        code: 'P1',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts all valid level_type values', () => {
      for (const type of LEVEL_TYPE_VALUES) {
        const r = LevelCreateSchema.safeParse({
          label: 'Test',
          code: 'TST',
          level_type: type,
        });
        expect(r.success).toBe(true);
      }
    });

    it('accepts code with single character', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Test',
        code: 'A',
        level_type: 'primary',
      });
      expect(r.success).toBe(true);
    });

    it('accepts code with all digits', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Test',
        code: '12345',
        level_type: 'primary',
      });
      expect(r.success).toBe(true);
    });

    it('accepts label with special characters', () => {
      const r = LevelCreateSchema.safeParse({
        label: 'Youngstarters | Little Stars (Test)',
        code: 'TEST',
        level_type: 'primary',
      });
      expect(r.success).toBe(true);
    });
  });
});

describe('LevelRemapSchema', () => {
  describe('valid inputs', () => {
    it('accepts a valid remap input', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: 'Form 3',
        toLevelId: VALID_UUID,
      });
      expect(r.success).toBe(true);
    });

    it('accepts various label formats', () => {
      const labels = [
        'Primary One',
        'Secondary Three',
        'Form 3',
        'Year 8',
        'Grade 5',
        'Custom Level Name',
      ];
      for (const label of labels) {
        const r = LevelRemapSchema.safeParse({
          fromLabel: label,
          toLevelId: VALID_UUID,
        });
        expect(r.success).toBe(true);
      }
    });

    it('trims whitespace from fromLabel', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: '  Form 3  ',
        toLevelId: VALID_UUID,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.fromLabel).toBe('Form 3');
      }
    });
  });

  describe('invalid fromLabel', () => {
    it('rejects empty fromLabel', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: '',
        toLevelId: VALID_UUID,
      });
      expect(r.success).toBe(false);
    });

    it('rejects whitespace-only fromLabel', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: '   ',
        toLevelId: VALID_UUID,
      });
      expect(r.success).toBe(false);
    });

    it('rejects missing fromLabel', () => {
      const r = LevelRemapSchema.safeParse({
        toLevelId: VALID_UUID,
      });
      expect(r.success).toBe(false);
    });
  });

  describe('invalid toLevelId', () => {
    it('rejects invalid UUID', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: 'Form 3',
        toLevelId: 'not-a-uuid',
      });
      expect(r.success).toBe(false);
    });

    it('rejects malformed UUID', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: 'Form 3',
        toLevelId: 'a0eebc99-9c0b-4ef8-bb6d',
      });
      expect(r.success).toBe(false);
    });

    it('rejects empty toLevelId', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: 'Form 3',
        toLevelId: '',
      });
      expect(r.success).toBe(false);
    });

    it('rejects missing toLevelId', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: 'Form 3',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('accepts long fromLabel', () => {
      const longLabel = 'A'.repeat(500);
      const r = LevelRemapSchema.safeParse({
        fromLabel: longLabel,
        toLevelId: VALID_UUID,
      });
      expect(r.success).toBe(true);
    });

    it('accepts fromLabel with special characters', () => {
      const r = LevelRemapSchema.safeParse({
        fromLabel: 'Form 3 (2024) - Advanced',
        toLevelId: VALID_UUID,
      });
      expect(r.success).toBe(true);
    });

    it('accepts different valid UUID formats', () => {
      const uuids = [
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        '550e8400-e29b-41d4-a716-446655440000',
      ];
      for (const uuid of uuids) {
        const r = LevelRemapSchema.safeParse({
          fromLabel: 'Form 3',
          toLevelId: uuid,
        });
        expect(r.success).toBe(true);
      }
    });
  });
});
