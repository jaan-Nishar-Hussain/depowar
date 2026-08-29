import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { SettlementUpdateSchema, type SettlementUpdateDto } from './dto';
import { RecipientsService } from './recipients.service';

@Controller('recipients')
export class RecipientsController {
  constructor(@Inject(RecipientsService) private readonly service: RecipientsService) {}

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