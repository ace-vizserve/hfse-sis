import { z } from 'zod';

// Classroom Settings (Phase 6) — the private per-teacher class note.
// Content is allowed to be an empty string (clearing the note is a valid
// save, not an error) and is trimmed server-side so whitespace-only input
// collapses to empty. `MAX_NOTE_LENGTH` is exported so the client-side
// character counter can never drift from what the server actually accepts.
export const MAX_NOTE_LENGTH = 4000;

export const ClassroomNoteSchema = z.object({
  content: z.string().trim().max(MAX_NOTE_LENGTH),
});

export type ClassroomNoteInput = z.infer<typeof ClassroomNoteSchema>;
