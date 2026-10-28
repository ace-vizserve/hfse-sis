import { z } from 'zod';

// The Book list page's writes (plan 2026-10-28-books-supplies-tracker.md,
// Phase 4): add, change or remove one item on a year's list, and copy a whole
// list from another year. Shared by the routes under app/api/sis/supplies/ and
// the forms in components/admissions/book-list-item-sheet.tsx.

const AY = z
  .string()
  .trim()
  .regex(/^AY\d{4}$/i, 'Invalid academic year')
  .transform((s) => s.toUpperCase());

// Blank → null, so an emptied publisher or ISBN is stored as "none", not "".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((s) => (s ? s : null));

const title = z
  .string()
  .trim()
  .min(1, 'Enter the title.')
  .max(300, 'Keep the title under 300 characters.');

/** A book's fields. `classType` null = both tracks. */
export const SupplyBookFieldsSchema = z.object({
  subject: optionalText(120),
  title,
  publisher: optionalText(200),
  isbn: optionalText(40),
  classType: z.enum(['Global', 'Standard']).nullable(),
});

/** A supply's fields. `youngstartersOnly` false = every level. */
export const SupplySupplyFieldsSchema = z.object({
  title,
  youngstartersOnly: z.boolean(),
});

export const SupplyItemCreateSchema = z.discriminatedUnion('kind', [
  SupplyBookFieldsSchema.extend({
    kind: z.literal('book'),
    ay: AY,
    levelId: z.string().uuid(),
  }),
  SupplySupplyFieldsSchema.extend({
    kind: z.literal('supply'),
    ay: AY,
  }),
]);
export type SupplyItemCreateInput = z.input<typeof SupplyItemCreateSchema>;

// The item's kind and (for a book) level never change — the PATCH says which
// kind it expects so a book's form cannot rewrite a supply.
export const SupplyItemUpdateSchema = z.discriminatedUnion('kind', [
  SupplyBookFieldsSchema.extend({ kind: z.literal('book') }),
  SupplySupplyFieldsSchema.extend({ kind: z.literal('supply') }),
]);
export type SupplyItemUpdateInput = z.input<typeof SupplyItemUpdateSchema>;

export const SupplyCopyYearSchema = z
  .object({ from: AY, to: AY })
  .refine((v) => v.from !== v.to, {
    message: 'Pick a different year to copy from.',
    path: ['from'],
  });
