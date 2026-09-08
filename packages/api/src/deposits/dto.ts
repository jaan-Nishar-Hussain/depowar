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

/** Query params for the dashboard deposit-intent list (PRD §API). */
export const ListDepositIntentsQuery = z.object({
  status: z.string().optional(),
  toChainId: z.coerce.number().int().positive().optional(),
  search: z.string().max(128).optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type ListDepositIntentsQueryDto = z.infer<typeof ListDepositIntentsQuery>;