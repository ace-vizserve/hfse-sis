/**
 * An editing sheet must be able to satisfy its own schema.
 *
 * THE RULE, and there are exactly two legal ways to meet it:
 *
 *   1. The schema is PARTIAL, so the sheet may send a subset. This is what the
 *      profile sheet does — it renders about 60 of ~96 fields and deliberately
 *      never draws the medical block, because parents supply that on the
 *      application form.
 *   2. The sheet RENDERS EVERY FIELD the schema requires. This is what the
 *      family sheets do.
 *
 * Meet neither and the form cannot ever save: a required key the sheet never
 * renders is never in the payload, `z.boolean().nullable()` rejects
 * `undefined`, and validation fails on a field nobody can see. That is not
 * hypothetical — the profile sheet was in exactly that state until 2026-08-14,
 * failing on 24 invisible fields, and because React Hook Form is silent when
 * validation fails the button simply appeared dead.
 *
 * WHY THE FAMILY SHEETS NEED A TEST RATHER THAN A COMMENT. They are correct
 * today by coincidence of maintenance: their schemas are NOT partial, so they
 * stay correct only while every single field keeps being rendered. Adding one
 * field to `FatherUpdateSchema` without adding it to `FATHER_FIELDS` silently
 * breaks every family save — and the failure looks like a dead button, not
 * like a validation error.
 *
 * Source-scanning, in the idiom of
 * `__tests__/data/no-unpaginated-high-volume-reads.test.ts`: the field lists
 * are module-private consts inside a `'use client'` component, and exporting
 * them purely to be tested would widen that component's surface for no other
 * reason.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildFatherUpdateSchema,
  buildGuardianUpdateSchema,
  buildMotherUpdateSchema,
  buildProfileUpdateSchema,
  FatherUpdateSchema,
  GuardianUpdateSchema,
  MotherUpdateSchema,
} from '@/lib/schemas/sis';

const REPO_ROOT = join(__dirname, '..', '..');

const FAMILY_SHEET = readFileSync(
  join(REPO_ROOT, 'components', 'sis', 'edit-family-sheet.tsx'),
  'utf8'
);

/**
 * Field names the family sheet renders. Only the FATHER list is written out;
 * mother and guardian are derived from it at runtime by prefix replacement, so
 * every key is checked against its father-prefixed spelling.
 */
const RENDERED = new Set(
  [...FAMILY_SHEET.matchAll(/name:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1])
);

function asFatherKey(key: string): string {
  return key.replace(/^(mother|guardian)/, 'father');
}

describe('editing sheets can satisfy their own schemas', () => {
  describe('family — not partial, so every field must be rendered', () => {
    for (const [label, schema] of [
      ['father', FatherUpdateSchema],
      ['mother', MotherUpdateSchema],
      ['guardian', GuardianUpdateSchema],
    ] as const) {
      it(`renders every ${label} field`, () => {
        const missing = Object.keys(schema.shape).filter(
          (key) => !RENDERED.has(asFatherKey(key))
        );

        expect(
          missing,
          missing.length
            ? `\n\nedit-family-sheet.tsx does not render these ${label} fields:\n\n  ${missing.join(
                '\n  '
              )}\n\nThe sheet cannot put them in the payload, so every save will ` +
                `fail validation on them — silently, as a button that does ` +
                `nothing. Either render them, or make the ${label} update ` +
                `schema partial the way the profile one is.\n`
            : undefined
        ).toEqual([]);
      });
    }

    it('still rejects a family payload that omits a required field', () => {
      // Guards the premise: these schemas really are strict, so the coverage
      // test above is load-bearing rather than decorative.
      const result = buildFatherUpdateSchema(new Set()).safeParse({
        fatherFullName: 'Test',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('profile — partial, so a subset is allowed', () => {
    it('accepts an empty payload', () => {
      expect(buildProfileUpdateSchema(new Set()).safeParse({}).success).toBe(
        true
      );
    });
  });

  it('the mother and guardian schemas really are father-shaped', () => {
    // If the derivation ever stops holding, `asFatherKey` above would map keys
    // onto names that do not exist and the coverage test would fail for the
    // wrong reason. Assert the relationship directly.
    for (const key of Object.keys(MotherUpdateSchema.shape)) {
      expect(key.startsWith('mother')).toBe(true);
    }
    for (const key of Object.keys(GuardianUpdateSchema.shape)) {
      expect(key.startsWith('guardian')).toBe(true);
    }
    expect(Object.keys(buildMotherUpdateSchema(new Set()).shape).length).toBe(
      Object.keys(MotherUpdateSchema.shape).length
    );
    expect(Object.keys(buildGuardianUpdateSchema(new Set()).shape).length).toBe(
      Object.keys(GuardianUpdateSchema.shape).length
    );
  });
});
