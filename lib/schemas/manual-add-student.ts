import { z } from 'zod';

const optionalShortText = (max: number) =>
  z.string().trim().max(max).optional();

// Identity (student_number + name) is no longer accepted as free-text input
// — the registrar must pick a real admissions record from the search picker
// per project memory `feedback_no_freetext_staff_pickers.md` (the same rule
// that applies to staff/teacher pickers). The server route then guards
// against orphan students, status mismatches, level mismatches, and dual-
// section enrolment per KD #51 + KD #67. This schema only validates the
// section-row metadata that lives on `section_students`.
export const ManualAddStudentSchema = z.object({
  student_number: z
    .string()
    .trim()
    .min(1, 'Student number is required'),
  late_enrollee: z.boolean(),
  bus_no: optionalShortText(40),
  classroom_officer_role: optionalShortText(80),
});

export type ManualAddStudentInput = z.infer<typeof ManualAddStudentSchema>;
