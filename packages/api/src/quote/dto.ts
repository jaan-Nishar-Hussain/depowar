import { z } from 'zod';

export const QuoteQuerySchema = z.object({
  depositId: z.string().min(1),
  fromChain: z.coerce.number().int().positive(),
  fromToken: z.string().min(1),
  fromAmount: z.string().regex(/^\d+$/, 'fromAmount must be a base-unit integer string'),
  fromAddress: z.string().min(1).optional(),
  toAddress: z.string().min(1).optional(),
  slippageBps: z.coerce.number().int().min(0).max(1000).optional(),
});

export type QuoteQueryDto = z.infer<typeof QuoteQuerySchema>;

export const ReportTransactionSchema = z.object({
  hopIndex: z.coerce.number().int().min(0),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'txHash must be a 0x-prefixed 32-byte hash'),
});

export type ReportTransactionDto = z.infer<typeof ReportTransactionSchema>;