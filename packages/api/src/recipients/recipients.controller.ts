import { Body, Controller, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { CreateRecipientSchema, SettlementUpdateSchema, type CreateRecipientDto, type SettlementUpdateDto } from './dto';
import { RecipientsService } from './recipients.service';

@Controller('recipients')
export class RecipientsController {
  constructor(@Inject(RecipientsService) private readonly service: RecipientsService) {}

  @Get()
  @Scopes('management')
  async list(@Client() client: ClientContext) {
    return stringifyBigInts(await this.service.list(client.id));
  }

  @Post()
  @Scopes('management')
  async create(@Client() client: ClientContext, @Body(new ZodPipe(CreateRecipientSchema)) dto: CreateRecipientDto) {
    return stringifyBigInts(await this.service.create(client.id, dto));
  }

  @Get(':id')
  @Scopes('recipients')
  async get(@Client() client: ClientContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.get(client.id, id));
  }

  @Put(':id/settlement')
  @Scopes('recipients')
  async updateSettlement(
    @Client() client: ClientContext,
    @Param('id') id: string,
    @Body(new ZodPipe(SettlementUpdateSchema)) dto: SettlementUpdateDto,
  ) {
    return stringifyBigInts(await this.service.updateSettlement(client.id, id, dto));
  }
}
