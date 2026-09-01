import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { UpdateProjectSchema, type UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

@Controller('project')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly service: ProjectsService) {}

  @Get()
  @Scopes('management')
  get(@Client() client: ClientContext): Promise<unknown> { return this.service.get(client.id); }

  @Put()
  @Scopes('management')
  update(@Client() client: ClientContext, @Body(new ZodPipe(UpdateProjectSchema)) dto: UpdateProjectDto): Promise<unknown> { return this.service.update(client.id, dto); }
}
