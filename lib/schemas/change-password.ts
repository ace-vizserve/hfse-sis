import { z } from 'zod';

export const ChangePasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    confirm: z.string().min(8, 'Password must be at least 8 characters.'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match.',
    path: ['confirm'],
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
