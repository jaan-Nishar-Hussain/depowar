import { z } from 'zod';

export const CreateDepositIntentSchema = z.object({
  recipientId: z.string().min(1),
  toChain: z.coerce.number().int().positive(),
  toToken: z.string().min(1),
  minAmount: z.string().regex(/^\d+$/).optional(),
  maxAmount: z.string().regex(/^\d+$/).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export type CreateDepositIntentDto = z.infer<typeof CreateDepositIntentSchema>;