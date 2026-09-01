import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from '@paymesh/config';
import { EnvModule } from './env/env.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ApiKeyGuard } from './auth/api-key.guard';
import { ScreeningModule } from './screening/screening.module';
import { AuditModule } from './audit/audit.module';
import { QueueModule } from './queue/queue.module';
import { DepositIntentsModule } from './deposits/deposit-intents.module';
import { QuoteModule } from './quote/quote.module';
import { StatusModule } from './status/status.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ChainsTokensModule } from './chains-tokens/chains-tokens.module';
import { RecipientsModule } from './recipients/recipients.module';
import { ProjectsModule } from './projects/projects.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { HealthController } from './health.controller';
import { ENV } from './common/tokens';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    EnvModule,
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv();
        return [{ ttl: env.RATE_LIMIT_TTL_MS, limit: env.RATE_LIMIT_LIMIT }];
      },
    }),
    PrismaModule,
    AuthModule,
    ScreeningModule,
    AuditModule,
    QueueModule,
    DepositIntentsModule,
    QuoteModule,
    StatusModule,
    WebhooksModule,
    ChainsTokensModule,
    RecipientsModule,
    ProjectsModule,
    ApiKeysModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
