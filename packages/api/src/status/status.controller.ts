import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { stringifyBigInts } from '../common/serialize';
import { Project, Scopes, type ProjectContext } from '../auth/decorators';
import { StatusService } from './status.service';

@Controller()
export class StatusController {
  constructor(@Inject(StatusService) private readonly service: StatusService) {}

  @Get('status')
  @Scopes('quote', 'deposits')
  async get(@Project() client: ProjectContext, @Query('depositId') depositId: string) {
    return stringifyBigInts(await this.service.get(client.id, depositId));
  }

  @Get('transactions/:id')
  @Scopes('quote', 'deposits')
  async getTransaction(@Project() client: ProjectContext, @Param('id') transactionId: string) {
    return stringifyBigInts(await this.service.getTransactionById(client.id, transactionId));
  }

  @Get('transactions')
  @Scopes('quote', 'deposits')
  async listTransactions(
    @Project() client: ProjectContext,
    @Query('intentId') intentId?: string,
    @Query('depositId') depositId?: string,
  ) {
    const targetId = intentId ?? depositId ?? '';
    return stringifyBigInts(await this.service.listTransactionsByIntent(client.id, targetId));
  }
}