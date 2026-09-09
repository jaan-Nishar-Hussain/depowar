import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Scopes, type UserContext } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from '../auth/auth.service';
import { OrganizationsService } from './organizations.service';

const OrganizationSchema = z.object({ name: z.string().min(2).max(80) });
type OrganizationDto = z.infer<typeof OrganizationSchema>;

@Controller('organizations')
export class OrganizationsController {
  constructor(@Inject(OrganizationsService) private readonly organizations: OrganizationsService, @Inject(AuthService) private readonly auth: AuthService) {}
  @Get() @Scopes('management') list(@CurrentUser() user: UserContext) { return this.organizations.list(user.id); }
  @Post() @Scopes('management') create(@CurrentUser() user: UserContext, @Body(new ZodPipe(OrganizationSchema)) dto: OrganizationDto) { return this.organizations.create(user.id, dto.name); }
  @Post('switch') @Scopes('management') async switchOrganization(@CurrentUser() user: UserContext, @Body(new ZodPipe(z.object({ organizationId: z.string().min(1) }))) dto: { organizationId: string }) { const selected = await this.organizations.switch(user.id, dto.organizationId); return this.auth.sessionForProject(user.id, user.email, selected.organizationId, selected.projectId); }
}
