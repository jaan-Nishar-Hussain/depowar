import { z } from 'zod';

export const SettlementUpdateSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  token: z.string().min(1),
  settlementType: z.enum(['EOA', 'CONTRACT']).default('EOA'),
  contractAddress: z.string().min(1).optional(),
  minAmount: z.string().regex(/^\d+$/).optional(),
  maxAmount: z.string().regex(/^\d+$/).optional(),
});

export type SettlementUpdateDto = z.infer<typeof SettlementUpdateSchema>;