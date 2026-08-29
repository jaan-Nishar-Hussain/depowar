import { Global, Module } from '@nestjs/common';
import { loadEnv } from '@paymesh/config';
import { ENV } from '../common/tokens';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
export class EnvModule {}