import { z } from 'zod';

// Virtue-only term update — decoupled from the combined AY-Setup term-dates
// route so it never touches start/end dates. Empty string / explicit null clears.
export const VirtueThemeSchema = z.object({
  termId: z.string().uuid(),
  // Empty string → null so the column clears consistently regardless of caller
  // (mirrors TermDatesSchema.virtueTheme; the route's `?? null` only catches
  // undefined/null, not '').
  virtueTheme: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((s) => (s == null || s.length === 0 ? null : s)),
});

export type VirtueThemeInput = z.infer<typeof VirtueThemeSchema>;
