import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { RoutingMetricsService } from './routing-metrics.service';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [PrismaModule, QueueModule],
  providers: [RoutingMetricsService],
  controllers: [MetricsController],
  exports: [RoutingMetricsService],
})
export class MetricsModule {}