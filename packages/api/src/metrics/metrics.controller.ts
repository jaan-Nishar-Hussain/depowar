import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { RoutingMetricsService } from './routing-metrics.service';

/** Prometheus exposition of routing KPIs (PRD §Monitoring & Observability). */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly routingMetrics: RoutingMetricsService) {}

  @Get()
  @Public()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics(): string {
    return this.routingMetrics.prometheus();
  }
}