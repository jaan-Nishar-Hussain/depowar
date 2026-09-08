import { Body, Controller, Inject, Param, Put } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Project, Scopes, type ProjectContext } from '../auth/decorators';
import { SettlementUpdateSchema, type SettlementUpdateDto } from './dto';
import { RecipientsService } from './recipients.service';

/**
 * PRD-compatible receiver endpoint (`PUT /v1/receiver/:id`). The SDK-facing
 * resource is `/recipients`; this mirrors the Next-Gen Routing PRD's "update
 * receiver (creates a new SettlementConfig entry)" surface.
 */
@Controller('receiver')
export class ReceiverController {
  constructor(@Inject(RecipientsService) private readonly service: RecipientsService) {}

  @Put(':id')
  @Scopes('recipients')
  async updateReceiver(
    @Project() project: ProjectContext,
    @Param('id') id: string,
    @Body(new ZodPipe(SettlementUpdateSchema)) dto: SettlementUpdateDto,
  ) {
    return stringifyBigInts(await this.service.updateSettlement(project.id, id, dto));
  }
}