import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Scopes, type UserContext } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from '../auth/auth.service';
import { WorkspacesService } from './workspaces.service';

const WorkspaceSchema = z.object({ name: z.string().min(2).max(80) });
type WorkspaceDto = z.infer<typeof WorkspaceSchema>;

@Controller('workspaces')
export class WorkspacesController {
  constructor(@Inject(WorkspacesService) private readonly workspaces: WorkspacesService, @Inject(AuthService) private readonly auth: AuthService) {}
  @Get() @Scopes('management') list(@CurrentUser() user: UserContext) { return this.workspaces.list(user.id); }
  @Post() @Scopes('management') create(@CurrentUser() user: UserContext, @Body(new ZodPipe(WorkspaceSchema)) dto: WorkspaceDto) { return this.workspaces.create(user.id, dto.name); }
  @Post('switch') @Scopes('management') async switchWorkspace(@CurrentUser() user: UserContext, @Body(new ZodPipe(z.object({ organizationId: z.string().min(1) }))) dto: { organizationId: string }) { const selected = await this.workspaces.switch(user.id, dto.organizationId); return this.auth.sessionForClient(user.id, user.email, selected.clientId); }
}
