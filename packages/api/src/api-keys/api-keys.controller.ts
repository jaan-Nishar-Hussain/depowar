import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeySchema, type CreateApiKeyDto } from './dto';

@Controller('api-keys')
export class ApiKeysController {
  constructor(@Inject(ApiKeysService) private readonly service: ApiKeysService) {}

  @Get()
  @Scopes('management')
  list(@Client() client: ClientContext) { return this.service.list(client.id); }

  @Post()
  @Scopes('management')
  create(@Client() client: ClientContext, @Body(new ZodPipe(CreateApiKeySchema)) dto: CreateApiKeyDto) { return this.service.create(client.id, dto); }

  @Delete(':id')
  @Scopes('management')
  revoke(@Client() client: ClientContext, @Param('id') id: string) { return this.service.revoke(client.id, id); }
}
