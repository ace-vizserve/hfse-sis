import { z } from 'zod';

// Virtue-only term update — decoupled from the combined AY-Setup term-dates
// route so it never touches start/end dates. Empty string / explicit null clears.
export const VirtueThemeSchema = z.object({
  termId: z.string().uuid(),
  virtueTheme: z.string().trim().max(200).nullable().optional(),
});

export type VirtueThemeInput = z.infer<typeof VirtueThemeSchema>;
