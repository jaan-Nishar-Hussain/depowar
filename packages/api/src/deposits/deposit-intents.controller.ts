import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { CreateDepositIntentSchema, type CreateDepositIntentDto } from './dto';
import { DepositIntentsService } from './deposit-intents.service';

@Controller('deposit-intents')
export class DepositIntentsController {
  constructor(private readonly service: DepositIntentsService) {}

  @Post()
  @Scopes('deposits')
  create(@Client() client: ClientContext, @Body(new ZodPipe(CreateDepositIntentSchema)) dto: CreateDepositIntentDto) {
    return this.service.create(client.id, dto);
  }

  @Get(':id')
  @Scopes('deposits')
  async findOne(@Client() client: ClientContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.findOne(client.id, id));
  }
}