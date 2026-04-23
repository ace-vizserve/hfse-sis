import { z } from 'zod';

// PATCH /api/sis/admin/school-config
//
// Singleton settings row (id=1). Superadmin only. All fields optional so
// registrar can update one at a time; empty strings are valid (cleared).
export const SchoolConfigUpdateSchema = z.object({
  principalName: z
    .string()
    .trim()
    .max(120, 'Keep it under 120 chars')
    .optional(),
  ceoName: z
    .string()
    .trim()
    .max(120, 'Keep it under 120 chars')
    .optional(),
  peiRegistrationNumber: z
    .string()
    .trim()
    .max(64, 'Keep it under 64 chars')
    .optional(),
  defaultPublishWindowDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional(),
});

export type SchoolConfigUpdateInput = z.infer<typeof SchoolConfigUpdateSchema>;
