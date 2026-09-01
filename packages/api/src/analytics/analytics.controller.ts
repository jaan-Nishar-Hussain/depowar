import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Client, Scopes, type ClientContext } from '../auth/decorators';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}

  @Get('overview')
  @Scopes('management')
  overview(@Client() client: ClientContext, @Query('days') days?: string): Promise<unknown> {
    return this.service.overview(client.id, days ? Number(days) : 30);
  }
}
