import { z } from 'zod';

export const ManualAddStudentSchema = z.object({
  student_number: z
    .string()
    .trim()
    .min(1, 'Student number is required'),
  last_name: z.string().trim().min(1, 'Last name is required'),
  first_name: z.string().trim().min(1, 'First name is required'),
  middle_name: z.string().trim().optional(),
  late_enrollee: z.boolean(),
});

export type ManualAddStudentInput = z.infer<typeof ManualAddStudentSchema>;
