import { Module } from '@nestjs/common';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';
import { DefaultRoutingProvider } from './routing.provider';
import { ROUTING_PROVIDER } from '../common/tokens';
import { ScreeningModule } from '../screening/screening.module';
import { MetricsModule } from '../metrics/metrics.module';

@Module({
  imports: [ScreeningModule, MetricsModule],
  controllers: [QuoteController],
  providers: [QuoteService, { provide: ROUTING_PROVIDER, useClass: DefaultRoutingProvider }],
  exports: [QuoteService],
})
export class QuoteModule {}