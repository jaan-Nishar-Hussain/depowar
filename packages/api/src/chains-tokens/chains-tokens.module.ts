import { Module } from '@nestjs/common';
import { ChainsTokensController } from './chains-tokens.controller';

@Module({
  controllers: [ChainsTokensController],
})
export class ChainsTokensModule {}