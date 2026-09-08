import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { Project, Scopes, type ProjectContext } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeySchema, type CreateApiKeyDto } from './dto';

@Controller('api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly service: ApiKeysService) {}

  @Get()
  @Scopes('management')
  list(@Project() project: ProjectContext) { return this.service.list(project.id); }

  @Post()
  @Scopes('management')
  create(@Project() project: ProjectContext, @Body(new ZodPipe(CreateApiKeySchema)) dto: CreateApiKeyDto) { return this.service.create(project.id, dto); }

  @Delete(':id')
  @Scopes('management')
  revoke(@Project() project: ProjectContext, @Param('id') id: string) { return this.service.revoke(project.id, id); }
}