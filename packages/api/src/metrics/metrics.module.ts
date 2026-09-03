import { Module } from '@nestjs/common';
import { RoutingMetricsService } from './routing-metrics.service';
import { MetricsController } from './metrics.controller';

@Module({
  providers: [RoutingMetricsService],
  controllers: [MetricsController],
  exports: [RoutingMetricsService],
})
export class MetricsModule {}