import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { CreateDepositIntentSchema, ListDepositIntentsQuery, type CreateDepositIntentDto, type ListDepositIntentsQueryDto } from './dto';
import { DepositIntentsService } from './deposit-intents.service';

@Controller('deposit-intents')
export class DepositIntentsController {
  constructor(@Inject(DepositIntentsService) private readonly service: DepositIntentsService) {}

  @Post()
  @Scopes('deposits')
  create(@Client() client: ClientContext, @Body(new ZodPipe(CreateDepositIntentSchema)) dto: CreateDepositIntentDto) {
    return this.service.create(client.id, dto);
  }

  @Get()
  @Scopes('deposits', 'quote')
  async list(@Client() client: ClientContext, @Query(new ZodPipe(ListDepositIntentsQuery)) query: ListDepositIntentsQueryDto) {
    return stringifyBigInts(await this.service.list(client.id, query));
  }

  @Get(':id')
  @Scopes('deposits')
  async findOne(@Client() client: ClientContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.findOne(client.id, id));
  }

  @Get(':id/recovery')
  @Scopes('deposits')
  async getRecovery(@Client() client: ClientContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.getRecoveryStatus(client.id, id));
  }

  @Post(':id/retry')
  @Scopes('deposits')
  async retry(@Client() client: ClientContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.retry(client.id, id));
  }
}