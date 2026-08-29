import { Module } from '@nestjs/common';
import { BlocklistScreeningProvider } from './screening.service';
import { SCREENING_PROVIDER } from '../common/tokens';

@Module({
  providers: [
    BlocklistScreeningProvider,
    {
      provide: SCREENING_PROVIDER,
      useExisting: BlocklistScreeningProvider,
    },
  ],
  exports: [SCREENING_PROVIDER],
})
export class ScreeningModule {}