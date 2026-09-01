import { z } from 'zod';

const scopes = z.array(z.enum(['deposits', 'quote', 'webhooks', 'recipients', 'management'])).min(1).max(10).optional();
export const CreateApiKeySchema = z.object({ scopes });
export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;
