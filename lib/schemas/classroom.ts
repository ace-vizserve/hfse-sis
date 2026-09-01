import { z } from 'zod';

import { proseLength } from '@/lib/rich-text';

// Classroom Settings (Phase 6) — the private per-teacher class note.
// Content is allowed to be an empty string (clearing the note is a valid
// save, not an error) and is trimmed server-side so whitespace-only input
// collapses to empty. `MAX_NOTE_LENGTH` is exported so the client-side
// character counter can never drift from what the server actually accepts.
export const MAX_NOTE_LENGTH = 4000;

export const ClassroomNoteSchema = z.object({
  // Measured on the words, not on the markup — the note is written in a
  // formatting editor, so the stored string carries tags the teacher never
  // typed. The on-screen counter uses `MAX_NOTE_LENGTH` against the same prose
  // count, which is what keeps the two from drifting.
  content: z
    .string()
    .trim()
    .refine((value) => proseLength(value) <= MAX_NOTE_LENGTH, {
      message: `Keep the note under ${MAX_NOTE_LENGTH} characters.`,
    }),
});

export type ClassroomNoteInput = z.infer<typeof ClassroomNoteSchema>;
