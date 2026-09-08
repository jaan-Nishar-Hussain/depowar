import { Body, Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { Project, Scopes, type ProjectContext } from '../auth/decorators';
import { CreateWebhookSchema, type CreateWebhookDto } from './dto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly service: WebhooksService) {}

  @Post()
  @Scopes('webhooks')
  create(@Project() client: ProjectContext, @Body(new ZodPipe(CreateWebhookSchema)) dto: CreateWebhookDto) {
    return this.service.create(client.id, dto);
  }

  @Get()
  @Scopes('webhooks')
  list(@Project() client: ProjectContext) {
    return this.service.list(client.id);
  }

  @Get(':id/deliveries')
  @Scopes('webhooks')
  async deliveries(@Project() client: ProjectContext, @Param('id') id: string) {
    return this.service.deliveries(client.id, id);
  }

  @Delete(':id')
  @Scopes('webhooks')
  remove(@Project() client: ProjectContext, @Param('id') id: string) {
    return this.service.remove(client.id, id);
  }
}