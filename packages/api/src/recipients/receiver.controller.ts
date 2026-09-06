import { Body, Controller, Inject, Param, Put } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { SettlementUpdateSchema, type SettlementUpdateDto } from './dto';
import { RecipientsService } from './recipients.service';

/**
 * PRD-compatible receiver endpoint (`PUT /v1/receiver/:id`). The SDK-facing
 * resource is `/recipients`; this mirrors the Next-Gen Routing PRD's "update
 * receiver (creates a new SettlementConfig entry)" surface so integrators
 * following the PRD API spec can update a receiver without learning a second
 * route name.
 */
@Controller('receiver')
export class ReceiverController {
  constructor(@Inject(RecipientsService) private readonly service: RecipientsService) {}

  @Put(':id')
  @Scopes('recipients')
  async updateReceiver(
    @Client() client: ClientContext,
    @Param('id') id: string,
    @Body(new ZodPipe(SettlementUpdateSchema)) dto: SettlementUpdateDto,
  ) {
    return stringifyBigInts(await this.service.updateSettlement(client.id, id, dto));
  }
}