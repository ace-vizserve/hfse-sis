import { z } from 'zod';

export const EnvironmentSwitchSchema = z.object({
  target: z.enum(['production', 'test']),
});
export type EnvironmentSwitchInput = z.infer<typeof EnvironmentSwitchSchema>;
