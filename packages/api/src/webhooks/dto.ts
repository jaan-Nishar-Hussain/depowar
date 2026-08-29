import { z } from 'zod';

export const CreateWebhookSchema = z.object({
  url: z.string().url(),
  events: z
    .array(
      z.enum(['quote.ready', 'tx.submitted', 'tx.confirmed', 'deposit.settled', 'deposit.failed']),
    )
    .min(1),
  secret: z.string().min(16).optional(),
});

export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;