import { Body, Controller, Get, Headers, Inject, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Project, Scopes, type ProjectContext, type UserContext } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ProjectsService } from './projects.service';

const CreateProjectSchema = z.object({ name: z.string().min(2).max(80), receiverAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/), destinationChainId: z.coerce.number().int().positive(), destinationToken: z.enum(['USDC', 'USDT']), environment: z.enum(['TEST', 'LIVE']).default('TEST') });
const SwitchProjectSchema = z.object({ projectId: z.string().min(1), environment: z.enum(['TEST', 'LIVE']).default('TEST') });
type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

@Controller()
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}
  @Get('projects') @Scopes('management') list(@CurrentUser() user: UserContext, @Project() project: ProjectContext) { return this.projects.list(user.id, project.id); }
  @Post('projects') @Scopes('management') create(@CurrentUser() user: UserContext, @Project() project: ProjectContext, @Headers('idempotency-key') idempotencyKey: string | undefined, @Body(new ZodPipe(CreateProjectSchema)) dto: CreateProjectDto): Promise<unknown> { return this.projects.create(user.id, project.id || null, dto.name, dto.environment, dto.receiverAddress, dto.destinationChainId, dto.destinationToken, idempotencyKey); }
  @Post('projects/switch') @Scopes('management') switchProject(@CurrentUser() user: UserContext, @Body(new ZodPipe(SwitchProjectSchema)) dto: z.infer<typeof SwitchProjectSchema>) { return this.projects.switch(user.id, user.email, dto.projectId, dto.environment); }
  @Get('project') @Scopes('management') get(@Project() project: ProjectContext): Promise<unknown> { return this.projects.get(project.id); }
  @Put('project') @Scopes('management') update(@Project() project: ProjectContext, @Body(new ZodPipe(z.object({ name: z.string().min(2).max(80) }))) dto: { name: string }) { return this.projects.update(project.id, dto.name); }
}