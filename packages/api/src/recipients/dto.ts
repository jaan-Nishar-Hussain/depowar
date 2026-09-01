import { z } from 'zod';

export const CreateRecipientSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.coerce.number().int().positive(),
  token: z.string().min(1),
  settlementType: z.enum(['EOA', 'CONTRACT']).default('EOA'),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  minAmount: z.string().regex(/^\d+$/).optional(),
  maxAmount: z.string().regex(/^\d+$/).optional(),
});

export type CreateRecipientDto = z.infer<typeof CreateRecipientSchema>;

export const SettlementUpdateSchema = z.object({
  chainId: z.coerce.number().int().positive(),
  token: z.string().min(1),
  settlementType: z.enum(['EOA', 'CONTRACT']).default('EOA'),
  contractAddress: z.string().min(1).optional(),
  minAmount: z.string().regex(/^\d+$/).optional(),
  maxAmount: z.string().regex(/^\d+$/).optional(),
});

export type SettlementUpdateDto = z.infer<typeof SettlementUpdateSchema>;
