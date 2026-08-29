import { Controller, Get, Inject, Query } from '@nestjs/common';
import { stringifyBigInts } from '../common/serialize';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { StatusService } from './status.service';

@Controller('status')
export class StatusController {
  constructor(@Inject(StatusService) private readonly service: StatusService) {}

  @Get()
  @Scopes('quote', 'deposits')
  async get(@Client() client: ClientContext, @Query('depositId') depositId: string) {
    return stringifyBigInts(await this.service.get(client.id, depositId));
  }
}