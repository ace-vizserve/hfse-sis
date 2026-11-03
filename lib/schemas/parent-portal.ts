import { z } from 'zod';

// Parent Portal admin in SIS Admin. Superadmin only; the routes check that.

const Email = z.string().trim().toLowerCase().email('Enter a valid email.');

// 72 is where the login system stops accepting a password. Without the cap a
// long one comes back as a server failure rather than a sentence.
const Password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be 72 characters or fewer.');

export const RELATIONSHIPS = ['mother', 'father'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mother',
  father: 'Father',
};

export const ResetParentPasswordSchema = z.object({
  email: Email,
  password: Password,
});
export type ResetParentPasswordInput = z.infer<
  typeof ResetParentPasswordSchema
>;

export const CreateParentAccountSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name.'),
  lastName: z.string().trim().min(1, 'Enter a last name.'),
  relationship: z.enum(RELATIONSHIPS, {
    message: 'Choose mother or father.',
  }),
  email: Email,
  password: Password,
});
export type CreateParentAccountInput = z.infer<
  typeof CreateParentAccountSchema
>;

// The screen's version. Confirming the password is the form's job and is never
// sent to the server.
export const CreateParentAccountFormSchema = CreateParentAccountSchema.extend({
  confirmPassword: z.string(),
}).refine((v) => v.password === v.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});
export type CreateParentAccountFormInput = z.infer<
  typeof CreateParentAccountFormSchema
>;

// Transfer records. Year codes as `academic_years` holds them (`AY2027`); the
// route checks each is a real year before it becomes part of a table name.
export const TransferRequestSchema = z.object({
  sourceAy: z.string().trim().min(1, 'Choose the year to move from.'),
  targetAy: z.string().trim().min(1, 'Choose the year to move to.'),
  enroleeNumbers: z
    .array(z.string().trim().min(1))
    .min(1, 'Choose at least one student.'),
});

// Recovery link. The section keys are the portal's, stored on the token and read
// by its `/complete-enrolment` form. They live here so the screen can use them:
// `lib/parent-portal/recovery.ts` sends email and is server-only.
export const RECOVERY_SECTIONS = [
  'studentInfo',
  'familyInfo',
  'enrollmentInfo',
  'uploads',
] as const;
export type RecoverySection = (typeof RECOVERY_SECTIONS)[number];

export const RECOVERY_SECTION_LABEL: Record<RecoverySection, string> = {
  studentInfo: 'Student information',
  familyInfo: 'Family information',
  enrollmentInfo: 'Enrolment information',
  uploads: 'Documents',
};

const RECIPIENT_ERROR = 'Enter a valid email address for every recipient.';

function splitRecipients(value: string): string[] {
  return value
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

function everyEmailValid(emails: string[]): boolean {
  return emails.every((email) => z.string().email().safeParse(email).success);
}

// One box, commas between addresses, as on the portal. The screen asks for at
// least one; the route takes none, which makes a link to copy and send by hand.
export const RecoveryRecipientsSchema = z
  .string()
  .transform(splitRecipients)
  .refine((emails) => emails.length > 0, 'Enter at least one email address.')
  .refine(everyEmailValid, RECIPIENT_ERROR);

const RecoveryEnroleeNumber = z
  .string()
  .trim()
  .min(1, 'Enter an enrolee number.')
  .toUpperCase();

export const RecoveryRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('check'),
    enroleeNumber: RecoveryEnroleeNumber,
  }),
  z.object({
    action: z.literal('generate'),
    enroleeNumber: RecoveryEnroleeNumber,
    sections: z
      .array(z.enum(RECOVERY_SECTIONS))
      .min(1, 'Choose at least one section.')
      .optional(),
    recipientEmails: z
      .string()
      .transform(splitRecipients)
      .refine(everyEmailValid, RECIPIENT_ERROR)
      .optional(),
  }),
]);
