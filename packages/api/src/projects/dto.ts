import { z } from 'zod';

export const UpdateProjectSchema = z.object({ name: z.string().trim().min(1).max(120) });
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
