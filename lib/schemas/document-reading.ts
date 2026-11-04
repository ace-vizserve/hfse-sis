import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What the parent portal reports after uploading a document. */
export const DocumentReadingSchema = z.object({
  fileUrl: z.string().url().max(2000),
  status: z.enum(['read', 'unreadable', 'timed_out', 'failed', 'not_read']),
  // A file holds at most a handful of pages, so a handful of passports.
  passports: z
    .array(
      z.object({
        expiry: day.nullable(),
        number: z.string().max(20).nullable(),
        birthDate: day.nullish(),
        name: z.string().max(200).nullish(),
        nationality: z.string().max(3).nullish(),
        sex: z.string().max(1).nullish(),
      })
    )
    .max(8),
  quality: z
    .object({
      pages: z.number(),
      totalPages: z.number(),
      fileBytes: z.number(),
      hasText: z.boolean().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      sharpness: z.number(),
      inkRatio: z.number(),
      brightness: z.number(),
      contrast: z.number(),
    })
    .nullable(),
  enteredNumber: z.string().max(50).nullable(),
  enteredExpiry: day.nullable(),
});

export type DocumentReadingInput = z.infer<typeof DocumentReadingSchema>;
