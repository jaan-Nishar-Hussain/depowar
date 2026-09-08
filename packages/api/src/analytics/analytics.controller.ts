import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Project, Scopes, type ProjectContext } from '../auth/decorators';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}

  @Get('overview')
  @Scopes('management')
  overview(@Project() client: ProjectContext, @Query('days') days?: string): Promise<unknown> {
    return this.service.overview(client.id, days ? Number(days) : 30);
  }

  @Get('timeseries')
  @Scopes('management')
  timeseries(@Project() client: ProjectContext, @Query('days') days?: string): Promise<unknown> {
    return this.service.timeseries(client.id, days ? Number(days) : 30);
  }
}
