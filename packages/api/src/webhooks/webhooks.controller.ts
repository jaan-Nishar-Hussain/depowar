import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { CreateWebhookSchema, type CreateWebhookDto } from './dto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @Scopes('webhooks')
  create(@Client() client: ClientContext, @Body(new ZodPipe(CreateWebhookSchema)) dto: CreateWebhookDto) {
    return this.service.create(client.id, dto);
  }

  @Get()
  @Scopes('webhooks')
  list(@Client() client: ClientContext) {
    return this.service.list(client.id);
  }

  @Delete(':id')
  @Scopes('webhooks')
  remove(@Client() client: ClientContext, @Param('id') id: string) {
    return this.service.remove(client.id, id);
  }
}