import { z } from 'zod';
import { DOCUMENT_SLOTS } from '@/lib/p-files/document-config';
import { MODULE_VALUES } from '@/lib/p-files/_shared';
import { proseLength } from '@/lib/rich-text';

const SlotKeyEnum = z.enum(
  DOCUMENT_SLOTS.map((s) => s.key) as [string, ...string[]]
);

export const NotifySchema = z.object({
  slotKey: SlotKeyEnum,
  module: z.enum(MODULE_VALUES).optional(),
});

export const PromiseSchema = z.object({
  slotKey: SlotKeyEnum,
  promisedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // 500 characters of WRITING. The note is typed in a formatting editor, so
  // measuring the stored string would let `<strong><em>` eat a note that is
  // well short of the limit on screen.
  note: z
    .string()
    .refine((value) => proseLength(value) <= 500, {
      message: 'Keep the note under 500 characters.',
    })
    .optional(),
  module: z.enum(MODULE_VALUES).optional(),
});

export const BulkNotifySchema = z.object({
  items: z
    .array(
      z.object({
        enroleeNumber: z.string().min(1).max(20),
        slotKey: SlotKeyEnum,
      })
    )
    .min(1)
    .max(50),
  module: z.enum(MODULE_VALUES).optional(),
});
