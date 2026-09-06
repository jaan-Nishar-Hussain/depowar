import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { StatusService } from './status.service';

@Controller()
export class StatusController {
  constructor(@Inject(StatusService) private readonly service: StatusService) {}

  @Get('status')
  @Scopes('quote', 'deposits')
  async get(@Client() client: ClientContext, @Query('depositId') depositId: string) {
    return stringifyBigInts(await this.service.get(client.id, depositId));
  }

  @Get('transactions/:id')
  @Scopes('quote', 'deposits')
  async getTransaction(@Client() client: ClientContext, @Param('id') transactionId: string) {
    return stringifyBigInts(await this.service.getTransactionById(client.id, transactionId));
  }

  @Get('transactions')
  @Scopes('quote', 'deposits')
  async listTransactions(
    @Client() client: ClientContext,
    @Query('intentId') intentId?: string,
    @Query('depositId') depositId?: string,
  ) {
    const targetId = intentId ?? depositId ?? '';
    return stringifyBigInts(await this.service.listTransactionsByIntent(client.id, targetId));
  }
}