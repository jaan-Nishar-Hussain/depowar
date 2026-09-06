import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { QuoteQuerySchema, ReportTransactionSchema, type QuoteQueryDto, type ReportTransactionDto } from './dto';
import { QuoteService } from './quote.service';

@Controller()
export class QuoteController {
  constructor(@Inject(QuoteService) private readonly service: QuoteService) {}

  @Get('quote')
  @Scopes('quote')
  async quote(@Client() client: ClientContext, @Query(new ZodPipe(QuoteQuerySchema)) query: QuoteQueryDto) {
    return stringifyBigInts(await this.service.quote(client.id, query));
  }

  @Get(['quotes/:id', 'quote/:id'])
  @Scopes('quote')
  async getById(@Client() client: ClientContext, @Param('id') quoteId: string) {
    return stringifyBigInts(await this.service.getQuoteById(client.id, quoteId));
  }

  @Get('deposit-intents/:id/quote')
  @Scopes('quote')
  async getDepositIntentQuote(@Client() client: ClientContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.getQuoteByDepositIntentId(client.id, id));
  }

  @Post('deposit-intents/:id/execute')
  @Scopes('quote')
  async executeDepositIntent(@Client() client: ClientContext, @Param('id') id: string) {
    return stringifyBigInts(await this.service.executeDepositIntent(client.id, id));
  }

  @Post('quote/:id/execute')
  @Scopes('quote')
  async execute(@Client() client: ClientContext, @Param('id') quoteId: string) {
    return stringifyBigInts(await this.service.executeServerCustody(client.id, quoteId));
  }

  @Post('quote/:id/transactions')
  @Scopes('quote')
  async report(
    @Client() client: ClientContext,
    @Param('id') quoteId: string,
    @Body(new ZodPipe(ReportTransactionSchema)) dto: ReportTransactionDto,
  ) {
    return stringifyBigInts(await this.service.reportSubmission(client.id, quoteId, dto));
  }
}