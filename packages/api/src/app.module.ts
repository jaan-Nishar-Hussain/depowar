import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from '@paymesh/config';
import { EnvModule } from './env/env.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ApiKeyGuard } from './auth/api-key.guard';
import { ApiKeyThrottlerGuard } from './auth/api-key-throttler.guard';
import { ScreeningModule } from './screening/screening.module';
import { AuditModule } from './audit/audit.module';
import { QueueModule } from './queue/queue.module';
import { DepositIntentsModule } from './deposits/deposit-intents.module';
import { QuoteModule } from './quote/quote.module';
import { StatusModule } from './status/status.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ChainsTokensModule } from './chains-tokens/chains-tokens.module';
import { RecipientsModule } from './recipients/recipients.module';
import { ProjectsModule as ProjectManagementModule } from './projects/projects.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { MetricsModule } from './metrics/metrics.module';
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
    ProjectManagementModule,
    ApiKeysModule,
    AnalyticsModule,
    WorkspacesModule,
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Order matters: ApiKeyGuard runs first and attaches request.client, so
    // ApiKeyThrottlerGuard can rate-limit per API key instead of per IP.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: ApiKeyThrottlerGuard },
  ],
})
export class AppModule {}
